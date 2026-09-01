# Google Sheets como panel de administración

Cada curso tiene su propio Google Sheet (privado). Las delegadas editan ahí;
un Apps Script pegado en el Sheet publica `data/<curso>/schedule.json` y
`data/<curso>/announcements.json` a este repo, y por separado manda
recordatorios de WhatsApp vía un webhook de Home Assistant. El sitio nunca
lee el Sheet directamente — solo lee los JSON ya publicados.

Este directorio tiene el código fuente, uno por curso porque cada Sheet
necesita su propio proyecto de Apps Script:

- `casa-de-ninos-1/Code.gs`, `casa-de-ninos-2/Code.gs`
- `Sidebar.html` (idéntico para ambos cursos, se pega tal cual)

`casa-de-ninos-2/Code.gs` se regenera desde `casa-de-ninos-1/Code.gs`:

```bash
sed -e 's#Casa de Niños 1#Casa de Niños 2#' -e 's#casa-de-ninos-1#casa-de-ninos-2#g' \
  casa-de-ninos-1/Code.gs > casa-de-ninos-2/Code.gs
```

Solo cambian el comentario de cabecera y las constantes `SCHEDULE_PATH` /
`ANNOUNCEMENTS_PATH`. Cualquier cambio de lógica se hace en el archivo de
CN1 y se regenera CN2 con ese comando — nunca al revés.

## Instalación en un Sheet nuevo

1. **Extensions → Apps Script** en el Google Sheet del curso.
2. Reemplaza el `Code.gs` por defecto con `casa-de-ninos-1/Code.gs` (o
   `casa-de-ninos-2/Code.gs` según el curso).
3. Crea un archivo HTML llamado `Sidebar` y pega `Sidebar.html`.
4. **Project Settings → Script Properties**, agrega:
   - `GITHUB_TOKEN` — Personal Access Token de GitHub, **fine-grained**,
     con acceso solo al repo `nsalazar/colaciones` y permiso *Contents:
     Read and write*. Nada más. (github.com → Settings → Developer settings
     → Fine-grained tokens).
   - `HA_WEBHOOK_URL` — la URL del webhook de Home Assistant (ver
     [../homeassistant/README.md](../homeassistant/README.md)). **Nunca se
     comitea a git**: vive solo acá.
5. Recarga el Sheet. Debe aparecer el menú **Colación**.
6. Desde el editor de Apps Script, ejecuta una vez la función
   `setupContactsAndNotificationsTabs`. Crea las pestañas Contactos y
   Notificaciones con los valores por defecto, agrega la fila "ID de Grupo
   WhatsApp" a Config si falta, y deja las pestañas en el orden y estilo
   estándar.
7. **Triggers** (ícono de reloj en el editor de Apps Script) → *Add
   Trigger* → función `checkReminders` → evento `Time-driven` → `Minutes
   timer` → `Every 15 minutes`. Esto es lo único que **no** se puede dejar
   en el código: hay que crearlo a mano una vez por Sheet.
8. Menú **Colación → Mostrar panel de publicación** para abrir el sidebar.

Sin el paso 7, los recordatorios automáticos (diario y semanal) nunca se
disparan — pero los botones de "Forzar Notificaciones" del sidebar sí
funcionan igual, porque llaman las mismas funciones directamente.

## Pestañas y columnas

Fila 1 = texto de ayuda (cursiva, gris), fila 2 = vacía, fila 3 = encabezado
(fondo teal), fila 4 en adelante = datos. El nombre de columna en fila 3
tiene que coincidir exactamente con lo que lee el script (`readTable()` lee
por nombre de columna, no por posición).

Estas pestañas **sí se publican** a GitHub (`publish()` las lee):

| Pestaña | Columnas | Va a |
|---|---|---|
| Config | `Campo` \| `Valor` | Filas `Curso` e `Inicio de rotación (rotationStart)` → `schedule.json`. Cualquier otra fila (ej. `ID de Grupo WhatsApp`) se ignora al publicar. |
| Rotacion | `Niño/a` | `kids[]`, en el orden de las filas. |
| Colaciones | `Día` \| `Colación` | `weekdays{}`. |
| Cierres | `Fecha inicio` \| `Fecha fin` \| `Motivo` \| `Tipo` | `closures[]`. `Fecha fin` vacía = un solo día. `Tipo` = `sinColacion` o cualquier otra cosa/vacío = `sinClases`. |
| Historial | `Fecha` \| `Niño/a` | `history[]`. |
| Eventos | `Fecha inicio` \| `Fecha fin` \| `Hora` \| `Título` \| `Audiencia` \| `Nota` \| `Lugar` | `events[]`. `Audiencia` = `Todos` o nombres separados por coma. |
| Adjuntos | `Fecha` \| `Tipo` \| `Valor` \| `Etiqueta` | `attachments[]`. `Tipo` = `Enlace` (URL en `Valor`) o cualquier otra cosa (archivo, en `Valor`). |
| Restricciones | `Restricción` \| `Niño/a` | `restrictions[]`. `Niño/a` vacío = aplica a todos. |
| Avisos | `Fecha` \| `Título` \| `Cuerpo` | `announcements.json`. |

Estas dos **nunca se publican** (no las toca `buildSchedule()` ni
`buildAnnouncements()` — los teléfonos jamás salen del Sheet):

| Pestaña | Columnas | Uso |
|---|---|---|
| Contactos | `Niño/a` \| `Apoderado 1` \| `Teléfono 1` \| `Apoderado 2` \| `Teléfono 2` | Teléfono en formato internacional, solo dígitos (ej. `56912345678`, sin `+` ni espacios). |
| Notificaciones | `Recordatorio` \| `Activo` \| `DíaSemana` \| `DíasAntes` \| `Hora` \| `Mensaje` | Una fila `Diario`, una fila `Semanal`. Ver placeholders abajo. |

## Cómo se sabe si hay "cambios sin publicar"

`onEdit` solo enciende el aviso (y habilita el botón **Publicar a GitHub**)
si la edición pudo afectar lo que se publica: cualquier edición en
Rotacion/Colaciones/Cierres/Historial/Eventos/Adjuntos/Restricciones/Avisos,
o en Config específicamente sobre las filas `Curso` / `Inicio de rotación
(rotationStart)`. Editar Contactos, Notificaciones, o cualquier otra fila de
Config (como `ID de Grupo WhatsApp`) no lo activa, porque esos datos nunca
viajan a GitHub.

## Botones del panel lateral

- **Publicar a GitHub** — corre `publish()`: arma los dos JSON desde las
  pestañas y hace commit al repo vía la API de contenidos de GitHub.
- **↩️ Deshacer cambios (volver a lo publicado)** — corre
  `revertFromGithub()`: trae el `schedule.json`/`announcements.json` que hay
  ahora mismo en GitHub y sobreescribe las pestañas publicables con eso,
  descartando cualquier edición sin publicar. Pide confirmación porque es
  destructivo. No toca Contactos, Notificaciones, ni las filas de Config que
  no se publican.
- **Forzar Notificaciones 📤** — tres botones que llaman
  `testWeekly('next')`, `testWeekly('this')` y `testDaily(fecha)`
  directamente, sin pasar por el trigger automático ni por el guard que
  evita reenviar el mismo día. Sirven para probar sin esperar a la hora
  configurada.

## Placeholders de los mensajes

**Diario** (`{nino} {fecha} {dia_semana} {colacion} {tags}`):

```
Hola! El día {dia_semana} {fecha} le toca a {nino} llevar la colación compartida: 
🍽️ {colacion} {tags}
```

**Semanal** (`{semana} {novedades} {primer_dia_semana}`):

```
Hola! La colación compartida de la semana del {primer_dia_semana} queda así:
{semana}{novedades}
```

- `{primer_dia_semana}`: el lunes de la semana que se está informando,
  formateado `08-Septiembre`. Sirve para que el mensaje tenga sentido aunque
  se reenvíe a mitad de semana (con "Forzar Notificaciones → de esta
  semana").
- `{semana}`: una línea por día hábil, con el día y el niño en **negrita**
  nativa de WhatsApp (`*así*`). Si el día es feriado/vacaciones, sale el
  motivo del cierre en vez de un niño; no hay lógica especial si *toda* la
  semana cae en cierre (igual se envía, con los 5 días marcados como
  cierre).
- `{novedades}`: bloque `📌 Novedades de la semana` con los eventos de
  `Eventos` que caen esa semana, en formato `[Martes 01-Septiembre] Título`.
  Viene vacío (sin salto de línea extra) si no hay eventos esa semana.
- `{tags}`: nombres de los apoderados del niño del recordatorio diario,
  como texto plano (`@María Pérez`) — **no** es una mención real de
  WhatsApp, el addon usado no lo soporta.

El disclaimer *"NOTA: Este es un mensaje automático 🤖"* que antecede a
**todo** mensaje se agrega en Home Assistant, no acá — así una edición en el
Sheet nunca puede hacerlo desaparecer. Ver
[../homeassistant/README.md](../homeassistant/README.md).

`Activo = FALSE` en una fila de Notificaciones desactiva ese recordatorio
sin borrar la fila. `Hora` es `HH:mm`, en punto o en cuartos (`:15`/`:30`/
`:45`), porque el chequeo automático corre cada 15 minutos.

## Agregar un curso nuevo

1. Duplica el Google Sheet de un curso existente (o crea uno con las mismas
   pestañas) y ajusta Config → `Curso`.
2. Repite la instalación de arriba con un `Code.gs` nuevo: copia
   `casa-de-ninos-1/Code.gs` a `casa-de-ninos-3/Code.gs`, cambia
   `SCHEDULE_PATH`/`ANNOUNCEMENTS_PATH` al nuevo curso.
3. Agrega la entrada en [`data/courses.json`](../data/courses.json) y crea
   `data/casa-de-ninos-3/` (puede quedar vacío hasta el primer *Publicar*).
4. Configura `GITHUB_TOKEN` y `HA_WEBHOOK_URL` en el Script Properties del
   Sheet nuevo — son por-Sheet, no se comparten.

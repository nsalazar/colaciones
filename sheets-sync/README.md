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
| Eventos | `Fecha inicio` \| `Fecha fin` \| `Hora` \| `Título` \| `Audiencia` \| `Nota` \| `Lugar` | `events[]`. `Audiencia` = `Todos` o nombres separados por coma. `Fecha fin` vacía = un solo día; con rango, el sitio lo muestra una sola vez ("del... al..."), no repetido por cada día. |
| Adjuntos | `Fecha` \| `Tipo` \| `Valor` \| `Etiqueta` | `attachments[]`. `Tipo` = `Enlace` (URL en `Valor`) o cualquier otra cosa (archivo, en `Valor`). |
| Restricciones | `Restricción` \| `Niño/a` | `restrictions[]`. `Niño/a` vacío = aplica a todos. |
| Avisos | `Fecha` \| `Título` \| `Cuerpo` | `announcements.json`. `Fecha` es para cuándo **aplica** el aviso (no cuándo se escribió) — el sitio oculta los avisos ya pasados. |

**Sobre `Hora` (Eventos y Notificaciones):** Sheets guarda las horas como
fecha "cero" (30-dic-1899). Cualquier lectura que pase por un objeto `Date`
—`String()`, `getHours()`, `Utilities.formatDate()` con zona horaria— puede
reinterpretar esa fecha con la hora local histórica de Santiago (LMT, antes
de que Chile estandarizara husos horarios) y mostrar una hora distinta a la
que se escribió. Por eso `Code.gs` lee el **texto tal como Sheets lo
muestra en la celda** (`getDisplayValues()`, funciones `readDisplayColumn()`
/ `parseDisplayTime()`) en vez de convertir a `Date` en algún punto. Si en
el futuro alguien "simplifica" esto usando `Utilities.formatDate()`, el bug
vuelve.

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

## Usar el panel desde el celular

La app de Google Sheets para Android/iOS **no soporta sidebars de Apps
Script** — el menú "Colación" ni siquiera aparece. Dos opciones:

1. **Sin configurar nada**: abre el Sheet en Chrome del celular (no en la
   app) y pide "Sitio de escritorio" desde el menú del navegador. A veces
   carga la versión completa de Sheets con el menú de Extensiones.
2. **Panel como página web** (más confiable): `doGet()` en `Code.gs` sirve
   el mismo `Sidebar.html` como página independiente, fuera del Sheet.
   - En el editor de Apps Script: **Deploy → New deployment → tipo "Web
     app"**. *Execute as*: `Me`. *Who has access*: `Only myself` (o
     `Anyone` si algún día otra persona necesita publicar sin tener su
     propio `GITHUB_TOKEN` — ejecuta con **tus** credenciales sin importar
     quién abra el link, así que trata esa URL como semi-secreta).
   - Copia la URL que termina en `/exec` y ábrela en el celular. Desde el
     menú del navegador, **"Agregar a pantalla de inicio"** — queda como un
     ícono más, sin distinguirse de una app nativa.
   - Cada vez que cambies `Code.gs` o `Sidebar.html` hay que crear un
     **New deployment** de nuevo (o editar el deployment existente) para
     que los cambios lleguen a esa URL — a diferencia del sidebar, que
     siempre usa la última versión guardada.

## Validación de datos

Dos capas, para atrapar typos antes de que rompan algo en silencio:

1. **Listas desplegables en el Sheet.** Menú **Colación → "Agregar
   validaciones de datos (una vez)"** corre `applyDataValidation()`: agrega
   dropdowns en los campos que el código compara por texto exacto —
   "Niño/a" en Historial/Contactos/Restricciones (tomado en vivo desde
   Rotacion, así que un niño nuevo aparece solo en la lista), "Día" en
   Colaciones, "Tipo" en Cierres/Adjuntos, "DíaSemana" en Notificaciones, y
   casillas de verdad para "Activo". Se puede correr de nuevo cuando
   quieras — no borra datos. Los campos de nombre de niño avisan pero no
   bloquean (hay excepciones legítimas, como un niño que ya no está en el
   curso pero sigue en Historial); los demás si bloquean escribir un valor
   fuera de la lista.
2. **`validateData()`**, botón **🔍 Validar** del panel — revisa todo el
   Sheet sin tocar GitHub y separa los problemas en dos grupos:
   - **Errores**: romperían el sitio (fecha inválida, rango de fechas al
     revés, un "Día" que no es un día de la semana, etc.). `publish()`
     corre esta misma validación primero y **se niega a publicar** si hay
     algún error — evita subir un JSON roto al repo público.
   - **Avisos**: probables typos o datos de WhatsApp incompletos (un
     nombre en Historial/Contactos/Restricciones/Audiencia que no coincide
     con ningún niño de Rotacion, un teléfono que no tiene pinta de celular
     chileno, un niño sin ningún teléfono cargado, un `DíaSemana` que no
     existe). No bloquean publicar, porque no rompen el sitio — solo un
     recordatorio de WhatsApp que capaz nadie note que falta.

## Avisos por correo si algo falla solo

`checkReminders()` (el trigger de 15 min) manda un correo — `MailApp`, sin
servicios externos — si el recordatorio diario o el semanal fallan (token de
GitHub vencido no aplica acá, pero sí un webhook de HA caído, una pestaña
mal armada, etc.). Cada recordatorio se prueba en su propio try/catch: si
falla el diario igual se intenta el semanal, y ninguno de los dos se marca
como "ya enviado" cuando falla, así que se reintenta solo en el próximo
chequeo de 15 minutos.

Por defecto manda el correo al dueño del script. Para usar otro correo,
agrega la Script Property `ALERT_EMAIL` con la dirección que prefieras.

## Botones del panel lateral

- **🔍 Validar** — corre `validateData()` y muestra errores/avisos sin
  tocar GitHub. Pensado para revisar antes de publicar, sin el riesgo de
  publicar por accidente.
- **Publicar a GitHub** — corre `publish()`: valida primero (ver arriba),
  y si no hay errores arma los dos JSON desde las pestañas y hace commit al
  repo vía la API de contenidos de GitHub.
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

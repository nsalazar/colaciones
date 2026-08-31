# La planilla como panel de administración

Los delegados editan una planilla de Google. Un script valida lo que escriben y,
unos minutos después, publica `data/schedule.json` y `data/announcements.json`
en el repo. El sitio no lee la planilla: lee los JSON ya generados.

Los teléfonos y correos **se quedan en la planilla**. Nunca salen al repo.

## Hojas y columnas

Los encabezados tienen que llamarse exactamente así. Si falta uno, el script no
publica y avisa: el sitio se queda con la última versión buena.

**Config** — `Clave` | `Valor`

| Clave | Valor |
|---|---|
| Curso | Kínder B |
| Inicio rotación | 2026-08-03 |
| Lunes | Fruta |
| Martes | Lácteo |
| Miércoles | Verdura |
| Jueves | Cereal o galletas |
| Viernes | Libre |
| Estado | *(lo escribe el script)* |

Un día sin valor queda sin colación para siempre. `Inicio rotación` es la fecha en
que le tocó al primer niño de la lista.

**Niños** — `Niño` | `Apoderado` | `Teléfono` | `Activo`

El orden de las filas es el orden de la rotación. `Activo` en `No` saca al niño sin
borrar el contacto. El teléfono es para el aviso por WhatsApp, no se publica.

**Cambios** — `Fecha` | `Niño` | `Nota`
Un canje son dos filas, una por fecha.

**Cierres** — `Desde` | `Hasta` | `Motivo` | `Tipo`
`Hasta` vacío es un solo día. `Tipo` es `Sin clases` (feriado, vacaciones) o
`Sin colación` (hay clases pero ese día no se manda comida).

**Actividades** — `Desde` | `Hasta` | `Hora` | `Título` | `Participantes` | `Lugar`
`Participantes` es `todos` o nombres separados por coma.

**Avisos** — `Fecha` | `Título` | `Texto`

## Instalación

1. Extensiones → Apps Script. Pega `Codigo.gs`, `Datos.gs` y `Github.gs`.
2. Crea un token de GitHub **fine-grained**, con acceso solo a este repositorio y
   permiso de lectura y escritura en *Contents*. Nada más.
3. En Configuración del proyecto → Propiedades del script, agrega:
   - `GH_TOKEN` — el token
   - `GH_REPO` — `tu-usuario/colacion-kinder`
   - `GH_RAMA` — `main` (opcional)
4. Ejecuta `probarConexion` desde el editor y revisa el registro. Debe decir OK.
5. Recarga la planilla y usa **Colación → Instalar automatizaciones**.

Los tokens fine-grained caducan. Anota la fecha: cuando expire, el script deja de
publicar y te llega un correo diciendo que GitHub respondió 401.

## Cómo queda funcionando

- **Al editar**: se valida al instante. La fila con problemas queda pintada y con
  una nota que explica qué pasa.
- **Cada 10 minutos**: si hay cambios y nadie está escribiendo hace dos minutos,
  publica. Varias ediciones seguidas terminan en un solo commit.
- **A las 3 AM**: republica igual, por si un trigger falló.
- **Si algo está mal**: no publica, escribe el motivo en `Config → Estado` y te
  manda un correo. El sitio sigue mostrando lo último que estaba bien.

## Menú

- **Revisar** — muestra los problemas y las próximas tres semanas de rotación ya
  calculadas. No publica nada. Es lo que conviene mirar antes de una semana cargada.
- **Publicar ahora** — se salta la espera de 10 minutos. Solo hace falta para un
  cambio de última hora antes del aviso de la tarde.

## Lo que la validación no puede atrapar

Que alguien escriba el nombre equivocado en `Cambios` es un dato válido: pasa todos
los controles y llega al sitio. El historial del repo es el "deshacer", pero lo vas a
usar tú, no los delegados. Por eso conviene que **Revisar** sea costumbre.

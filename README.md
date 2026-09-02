# Colación compartida — Colegio Huelquén

Sitio estático con el calendario de colación compartida de varios cursos
(Casa de Niños 1, Casa de Niños 2, …), publicado en GitHub Pages. Los
apoderados no editan nada aquí: el contenido lo administran las delegadas
desde Google Sheets, y un script lo publica a este repo.

```
Google Sheets (privado, un Sheet por curso)
      │  Apps Script: botón "Publicar a GitHub"
      ▼
data/<curso>/schedule.json + announcements.json  (este repo, público)
      │  GitHub Pages
      ▼
index.html / app.js / styles.css  (lo que ve el apoderado)

Google Sheets ──Apps Script: webhook──▶ Home Assistant ──ha-whatsapp──▶ WhatsApp
  (pestañas Contactos/Notificaciones, NUNCA salen del Sheet)
```

Dos sistemas comparten la misma lógica de rotación pero corren por separado:
el **sitio** (lee los JSON publicados, sin backend) y los **recordatorios de
WhatsApp** (Apps Script calcula el turno y llama a un webhook de Home
Assistant; no depende de que el sitio esté abierto).

## Estructura del repo

| Ruta | Qué es |
|---|---|
| `index.html`, `app.js`, `styles.css` | El sitio. Sin build, sin dependencias. |
| `data/courses.json` | Manifiesto: qué cursos existen y dónde está el JSON de cada uno. |
| `data/casa-de-ninos-1/`, `data/casa-de-ninos-2/` | `schedule.json` + `announcements.json` de cada curso. Los genera el Sheet — no editar a mano. |
| `attachments/` | Archivos adjuntos referenciados desde `schedule.json` (`attachments[].file`). |
| `sheets-sync/` | Apps Script (`Code.gs`) + panel lateral (`Sidebar.html`) que van pegados en cada Google Sheet. Ver [sheets-sync/README.md](sheets-sync/README.md). |
| `homeassistant/` | Cómo queda la automatización de Home Assistant que recibe el webhook y manda el WhatsApp. Ver [homeassistant/README.md](homeassistant/README.md). |
| `manifest.json`, `robots.txt`, `.nojekyll` | Config del sitio / GitHub Pages. `.nojekyll` es obligatorio para que Pages sirva `data/` tal cual. |

## Publicar en GitHub Pages (si hay que rehacerlo desde cero)

```bash
gh repo create nsalazar/colaciones --public --source=. --push
gh api -X POST repos/nsalazar/colaciones/pages -f build_type=legacy \
  -f 'source[branch]=main' -f 'source[path]=/'
```

Queda en `https://nsalazar.github.io/colaciones/`. La primera vez tarda 1–2
minutos en propagarse.

## Ver el sitio localmente antes de publicar

```bash
python3 -m http.server 8000
```

Abrir `http://localhost:8000`. No sirve doble clic sobre `index.html`: el
navegador bloquea la lectura de los JSON con `file://`.

## Esquema de datos

### `data/courses.json`

```json
[
  {
    "id": "casa-de-ninos-1",
    "alias": "CN1",
    "name": "Casa de Niños 1",
    "schedule": "data/casa-de-ninos-1/schedule.json",
    "announcements": "data/casa-de-ninos-1/announcements.json"
  }
]
```

El sitio lee este manifiesto para poblar el selector de curso. Agregar un
curso nuevo es agregar una entrada aquí + crear su carpeta en `data/` (ver
[sheets-sync/README.md](sheets-sync/README.md#agregar-un-curso-nuevo)).

### `data/<curso>/schedule.json`

```json
{
  "curso": "Casa de Niños 1",
  "rotationStart": "2026-10-01",
  "weekdays": { "1": "Yogurt con cereal o granola", "2": "Pan…", "5": "Queque casero" },
  "kids": ["Clemente A", "Sebastián", "…"],
  "closures": [
    { "date": "2026-09-21", "reason": "Feriado" },
    { "from": "2026-09-14", "to": "2026-09-18", "reason": "Vacaciones" },
    { "date": "2026-11-05", "type": "sinColacion", "reason": "Aniversario, hay catering" }
  ],
  "history": [ { "date": "2026-07-07", "kid": "Noelle" } ],
  "events": [
    { "date": "2026-09-11", "title": "Acto de Fiestas Patrias", "audience": "todos", "note": "…" }
  ],
  "attachments": [
    { "date": "2026-09-11", "file": "attachments/Casa de Niños.docx", "label": "Vestimenta" }
  ],
  "restrictions": []
}
```

- **`rotationStart`**: fecha en la que le tocó al primer niño de `kids`. Desde
  ahí el sitio recorre días hábiles y asigna en orden, saltándose `closures`.
  `history` son asignaciones fijas para fechas pasadas (no se recalculan).
- **`weekdays`**: `"1"`=lunes … `"5"`=viernes. Un día ausente = sin colación
  ese día de la semana.
- **`closures`**: un día suelto (`date`) o un rango (`from`/`to`). Sin `type`
  (o `"sinClases"`) es feriado/vacaciones — el turno se salta y se corre al
  siguiente día hábil. `"type": "sinColacion"` es día con clases pero sin
  colación (ej. hay catering) — también corre el turno.
- **`events`**: independiente de la rotación. `audience` es `"todos"` o una
  lista de nombres. En el sitio, un evento con `from`/`to` aparece **una
  sola vez** en "Próximos eventos" (no repetido por cada día), con la fecha
  como "Miércoles 9 de septiembre al 10 de septiembre".
- **`attachments`**: `file` (ruta dentro del repo, bajo `attachments/`) o
  `link` (URL externa).
- **`restrictions`**: `{ restriction, kid }`, `kid` vacío = aplica a todos.

### `data/<curso>/announcements.json`

Lista de `{ date, title, body }`. `date` es la fecha **para la que aplica**
el aviso (igual que en `events`), no la fecha en que se escribió: el sitio
oculta los avisos ya pasados y esconde la sección entera si no queda
ninguno vigente.

### Íconos en el calendario

Cada día con algo especial muestra un ícono pequeño (con tooltip al pasar el
mouse):

| Ícono | Significa |
|---|---|
| 📅 (naranjo) | Hay un evento ese día (`events`). |
| 📣 (gris oscuro) | Hay un aviso vigente para ese día (`announcements.json`). |
| 📎 (verde) | Hay un adjunto ese día (`attachments`), clickeable. |

## Links directos y compartir

La URL refleja el curso y el niño/a elegidos, ej.
`https://nsalazar.github.io/colaciones/#class=CN2&kid=Diego` — cambiar los
selectores actualiza la URL sola (sin recargar), así que copiar la barra de
direcciones en cualquier momento comparte exactamente esa vista. Links
viejos con `?class=&kid=` (formato usado antes) se migran solos al abrir,
sin recargar la página.

El botón **Compartir imagen** genera una foto (PNG) del mes que se está
viendo — calendario + Próximos eventos + Avisos (si no está vacío) — sin el
resaltado de "hoy" ni el del niño/a seleccionado, para que sirva como una
imagen neutral para el grupo de WhatsApp. Usa `html2canvas` (cargado desde
un CDN solo al hacer clic en el botón) y el Web Share API cuando el
navegador lo soporta; si no, descarga el PNG.

## Recordatorios por WhatsApp

Los teléfonos **no viven en este repo** (es público). Viven en la pestaña
Contactos de cada Google Sheet, que nunca se publica. El flujo completo —
qué pestañas hay, cómo se instala el Apps Script, cómo se configuran los
recordatorios — está en [sheets-sync/README.md](sheets-sync/README.md); la
automatización de Home Assistant que efectivamente manda el mensaje está en
[homeassistant/README.md](homeassistant/README.md).

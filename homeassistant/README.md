# Recordatorios de WhatsApp vía Home Assistant

Google Sheets calcula a quién le toca colación y arma el texto del mensaje
(ver [../sheets-sync/README.md](../sheets-sync/README.md)); Home Assistant
solo recibe un webhook y lo reenvía por WhatsApp — como texto (recordatorio
diario) o como imagen con pie de foto (resumen semanal, ver
[más abajo](#imagen-del-resumen-semanal)). Home Assistant nunca toca el
Sheet ni sabe nada de la rotación — es un reenviador tonto, a propósito, así
toda la lógica de negocio vive en un solo lugar (Apps Script).

## Requisitos

- El addon/integración **[ha-whatsapp](https://github.com/FaserF/ha-whatsapp)**
  (de FaserF) instalado y vinculado a una cuenta de WhatsApp (se escanea un
  QR una vez). Expone los servicios `whatsapp.send_message` y
  `whatsapp.send_image`.
- Acceso remoto a Home Assistant para que el webhook sea alcanzable desde
  Apps Script (acá se usa **Nabu Casa**, así que la URL del webhook es del
  tipo `https://hooks.nabu.casa/...`; sirve cualquier otro método de
  exposición remota de HA).

## 1. Automatización

**Settings → Automations → Create → Add trigger → Webhook**. HA genera un
`webhook_id` único — esa es la parte "secreta" de la URL, no se comparte ni
se sube a ningún repo.

Automatización completa — reenvía como imagen (`send_image`) si el payload
trae `url`, o como texto (`send_message`) si no:

```yaml
alias: Huelquen - Whatsapp Colación Webhook
triggers:
  - webhook_id: TU_WEBHOOK_ID_AQUI
    allowed_methods: [POST]
    local_only: false
    trigger: webhook
actions:
  - choose:
      - conditions:
          - condition: template
            value_template: "{{ trigger.json.url is defined }}"
        sequence:
          - action: whatsapp.send_image
            data:
              target: "{{ trigger.json.target }}"
              url: "{{ trigger.json.url }}"
              caption: "_🤖 NOTA: Este es un mensaje automático 🤖_\n\n{{ trigger.json.message }}"
    default:
      - action: whatsapp.send_message
        data:
          target: "{{ trigger.json.target }}"
          message: "_🤖 NOTA: Este es un mensaje automático 🤖_\n\n{{ trigger.json.message }}"
```

Puntos importantes:

- `local_only: false` es necesario para que el webhook responda cuando
  llega desde fuera de la red local (Apps Script corre en los servidores de
  Google, no en tu LAN).
- El disclaimer `_🤖 NOTA: Este es un mensaje automático 🤖_` se agrega
  **acá**, no en la plantilla del Sheet — es la única forma de garantizar
  que nunca se pueda perder editando el mensaje desde Sheets. El `_..._` es
  cursiva nativa de WhatsApp. Está repetido en el `choose` y en el
  `default` porque son dos ramas de acciones distintas (`send_image` usa
  `caption`, `send_message` usa `message`) — si lo cambias, actualízalo en
  ambos lugares.
- Las comillas dobles en el YAML son necesarias: con comillas simples
  Jinja/YAML no interpreta `\n` como salto de línea real.

## 2. Contrato del webhook

Apps Script hace un POST con uno de estos dos formatos:

```json
{ "target": "56912345678@s.whatsapp.net", "message": "texto ya armado" }
```
```json
{ "target": "123456@g.us", "url": "https://raw.githubusercontent.com/.../weekly-preview.png?v=...", "message": "texto para el pie de foto" }
```

`target` llega **completo**, con el sufijo correcto según el tipo de
destinatario:

| Destinatario | Formato de `target` |
|---|---|
| Un apoderado (recordatorio diario) | `<telefono>@s.whatsapp.net` |
| El grupo del curso (resumen semanal) | `<idDeGrupo>@g.us` |

La automatización solo reenvía los campos del payload tal cual — no arma el
JID ni decide a quién va ni si corresponde imagen o texto (eso ya viene
decidido desde Apps Script; la automatización solo mira si `url` viene o no).

## 3. Cómo obtener el `idDeGrupo`

`ha-whatsapp` expone (según versión del addon) un servicio para listar
grupos, ej. `whatsapp.get_groups`, desde **Developer Tools → Actions** en
Home Assistant. El id viene sin el sufijo `@g.us` — agrégalo tú al pegarlo
en la fila "ID de Grupo WhatsApp" de la pestaña Config del Sheet (el script
ya le agrega `@g.us` al armar el `target`, no lo dupliques ahí).

## Formato de texto en WhatsApp

| Sintaxis | Resultado |
|---|---|
| `*texto*` | **negrita** |
| `_texto_` | _cursiva_ |
| `~texto~` | ~~tachado~~ |
| `` ```texto``` `` | monoespaciado |

No existe forma de mencionar (`@apoderado`) con notificación real desde
`whatsapp.send_message` — el addon no expone ningún parámetro de mención.
Por eso el mensaje semanal usa negrita en el día/niño en vez de tags, y el
mensaje diario, si quiere mostrar el nombre del apoderado, lo hace como
texto plano (`{tags}` en la plantilla del Sheet).

## Imagen del resumen semanal

El resumen semanal (viernes al grupo) va con una **imagen** en formato
retrato — una grilla de 7 días parecida al calendario del sitio, pero solo
de esa semana — además del texto, que queda como pie de foto (`caption`).

La imagen no se genera en el navegador (el "Compartir imagen" del sitio usa
`html2canvas`, que no existe en Apps Script): se genera **del lado del
servidor**, con Google Slides — es lo único con lo que Apps Script puede
"dibujar" algo sin depender de un servicio externo pago:

1. `buildWeeklyImageUrl()` en `Code.gs` redibuja siempre la **misma**
   diapositiva (una presentación en retrato de 600x820pt llamada "Colación
   — imagen semanal (uso interno, no borrar)", creada la primera vez y
   guardada por su id en Script Properties — no crea una nueva cada
   semana). El tamaño retrato se pide con el servicio avanzado "Slides API"
   (`Slides.Presentations.create({..., pageSize: {...}})`) porque
   `SlidesApp.create()` siempre crea horizontal y no permite cambiarlo
   después — hay que **activar ese servicio una vez** en el editor de Apps
   Script: ícono **"+"** junto a "Services" (columna izquierda) → **Slides
   API** → Add.
2. La exporta como PNG (`.../export/png`, autenticado con
   `ScriptApp.getOAuthToken()`) y la sube al repo en
   `data/<curso>/weekly-preview.png` (mismo mecanismo que ya usa `publish()`
   para el JSON).
3. Manda esa URL a Home Assistant como **raw.githubusercontent.com**, no la
   de GitHub Pages — Pages hace un build/deploy que puede tardar hasta un
   par de minutos en reflejar el commit nuevo, mientras que
   raw.githubusercontent.com sirve el archivo del commit casi al toque. Aun
   así lleva un `?v=<timestamp>` para evitar que WhatsApp cachee una versión
   vieja de la imagen entre una semana y la siguiente.

Si la generación o el envío de la imagen fallan por lo que sea (Slides,
export, o el webhook), el resumen semanal **igual sale como texto plano** —
la imagen es "mejor si se puede", nunca bloquea el envío. Se puede probar
sin esperar al viernes con **Forzar Notificaciones** en el panel: el
resultado muestra la imagen generada ahí mismo, además de mandarla.

La primera vez que corra `buildWeeklyImageUrl()` (desde el trigger
automático o desde "Forzar Notificaciones"), Apps Script va a pedir
autorizar permisos nuevos (Slides) — hay que aceptar el diálogo de
autorización una vez.

## Seguridad

- La URL del webhook (`HA_WEBHOOK_URL`) es un secreto: vive solo en las
  **Script Properties** del Apps Script de cada Sheet, nunca en este repo.
  Si se filtra, cualquiera puede mandar WhatsApps arbitrarios a través de
  esta automatización — regenerar el `webhook_id` si eso pasa.
- Los teléfonos y el `idDeGrupo` tampoco están en este repo: viven en las
  pestañas Contactos/Config de cada Sheet.

# Recordatorios de WhatsApp vía Home Assistant

Google Sheets calcula a quién le toca colación y arma el texto del mensaje
(ver [../sheets-sync/README.md](../sheets-sync/README.md)); Home Assistant
solo recibe un webhook con `{ target, message }` y lo reenvía por WhatsApp.
Home Assistant nunca toca el Sheet ni sabe nada de la rotación — es un
reenviador tonto, a propósito, así toda la lógica de negocio vive en un solo
lugar (Apps Script).

## Requisitos

- El addon/integración **[ha-whatsapp](https://github.com/FaserF/ha-whatsapp)**
  (de FaserF) instalado y vinculado a una cuenta de WhatsApp (se escanea un
  QR una vez). Expone el servicio `whatsapp.send_message`.
- Acceso remoto a Home Assistant para que el webhook sea alcanzable desde
  Apps Script (acá se usa **Nabu Casa**, así que la URL del webhook es del
  tipo `https://hooks.nabu.casa/...`; sirve cualquier otro método de
  exposición remota de HA).

## 1. Automatización

**Settings → Automations → Create → Add trigger → Webhook**. HA genera un
`webhook_id` único — esa es la parte "secreta" de la URL, no se comparte ni
se sube a ningún repo.

Automatización completa:

```yaml
alias: Huelquen - Whatsapp Colación Webhook
triggers:
  - webhook_id: TU_WEBHOOK_ID_AQUI
    allowed_methods: [POST]
    local_only: false
    trigger: webhook
actions:
  - data:
      target: "{{ trigger.json.target }}"
      message: "_NOTA: Este es un mensaje automático 🤖_\n\n{{ trigger.json.message }}"
    action: whatsapp.send_message
```

Puntos importantes:

- `local_only: false` es necesario para que el webhook responda cuando
  llega desde fuera de la red local (Apps Script corre en los servidores de
  Google, no en tu LAN).
- El disclaimer `_NOTA: Este es un mensaje automático 🤖_` se agrega **acá**,
  no en la plantilla del Sheet — es la única forma de garantizar que nunca
  se pueda perder editando el mensaje desde Sheets. El `_..._` es cursiva
  nativa de WhatsApp.
- Las comillas dobles en el YAML son necesarias: con comillas simples
  Jinja/YAML no interpreta `\n` como salto de línea real.

## 2. Contrato del webhook

Apps Script (`sendWhatsapp()` en `Code.gs`) hace un POST con:

```json
{ "target": "56912345678@s.whatsapp.net", "message": "texto ya armado" }
```

`target` llega **completo**, con el sufijo correcto según el tipo de
destinatario:

| Destinatario | Formato de `target` |
|---|---|
| Un apoderado (recordatorio diario) | `<telefono>@s.whatsapp.net` |
| El grupo del curso (resumen semanal) | `<idDeGrupo>@g.us` |

La automatización solo reenvía `trigger.json.target` y
`trigger.json.message` tal cual — no arma el JID ni decide a quién va.

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

## Pendiente: mandar la imagen del calendario

El addon expone `whatsapp.send_image` (`account, target, url, caption, ...`)
— manda una imagen desde una **URL pública HTTPS** con texto como pie de
foto. Todavía no se usa: el sitio ya sabe generar una imagen del mes
("Compartir imagen", ver [README.md](../README.md#links-directos-y-compartir))
pero corre en el navegador de quien lo aprieta (`html2canvas`), no sirve
para el envío automático semanal que corre en Apps Script sin navegador. Para
automatizarlo habría que generar la imagen del lado del servidor (ej. Google
Slides vía Apps Script, exportado como PNG y subido al repo para tener una
URL pública) y recién ahí llamar a `send_image` con esa URL + el texto del
resumen semanal como `caption`.

## Seguridad

- La URL del webhook (`HA_WEBHOOK_URL`) es un secreto: vive solo en las
  **Script Properties** del Apps Script de cada Sheet, nunca en este repo.
  Si se filtra, cualquiera puede mandar WhatsApps arbitrarios a través de
  esta automatización — regenerar el `webhook_id` si eso pasa.
- Los teléfonos y el `idDeGrupo` tampoco están en este repo: viven en las
  pestañas Contactos/Config de cada Sheet.

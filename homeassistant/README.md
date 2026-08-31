# Recordatorio por WhatsApp desde Home Assistant

Manda un mensaje al **grupo** de apoderados la tarde anterior al turno.
No guarda correos ni telefonos de nadie: el mensaje va al grupo, no a cada apoderado.

## 1. Copiar el script

Deja `colacion.py` en `/config/scripts/colacion.py` y edita la constante `URL`
con la direccion de tu sitio publicado.

Pruebalo primero desde el terminal del host:

```bash
python3 /config/scripts/colacion.py
```

Debe imprimir una linea de JSON con el proximo dia habil que tenga algo que avisar.

## 2. Sensor

En `configuration.yaml`:

```yaml
command_line:
  - sensor:
      name: Colacion proximo turno
      command: "python3 /config/scripts/colacion.py"
      value_template: "{{ value_json.estado }}"
      json_attributes:
        - fecha
        - dia
        - comida
        - nino
        - sin_colacion
        - eventos
        - mensaje
      scan_interval: 3600
```

El estado es el nombre del niño, o `sin_turno` / `nada`. El texto listo para mandar
queda en el atributo `mensaje`.

## 3. Automatizacion

Busca el ID del grupo una vez con el servicio `whatsapp.get_groups` y reemplazalo abajo.
Usar `group_id` y no `group` evita que la automatizacion se rompa si alguien
renombra el grupo.

```yaml
automation:
  - alias: Aviso de colacion al grupo
    triggers:
      - trigger: time
        at: "18:30:00"
    conditions:
      - condition: template
        value_template: >
          {{ state_attr('sensor.colacion_proximo_turno', 'fecha')
             == (now() + timedelta(days=1)).strftime('%Y-%m-%d') }}
    actions:
      - action: homeassistant.update_entity
        target:
          entity_id: sensor.colacion_proximo_turno
      - delay: "00:00:05"
      - action: whatsapp.send_message
        data:
          group_id: "120363012345678901"
          message: "{{ state_attr('sensor.colacion_proximo_turno', 'mensaje') }}"
```

La condicion hace que solo avise la vispera. Si el proximo turno es el lunes y hoy
es viernes, el aviso no sale: para eso, cambia la condicion a que el sensor tenga
`mensaje` y agrega una automatizacion de viernes. Es mas simple mandar el aviso el
mismo viernes en la tarde para el lunes; el script ya resuelve el salto de feriados
y fines de semana.

## 4. Encuestas para paseos y reuniones

Para las actividades de `events` sirve mas una encuesta que un mensaje:

```yaml
- action: whatsapp.send_poll
  data:
    group_id: "120363012345678901"
    message: "Paseo a Farellones — ¿van?"
    options: ["Sí, vamos", "No podemos", "Aviso despues"]
```

Los votos llegan de vuelta como evento `whatsapp_poll_vote_received`.

## Advertencias

- El puente usa `whatsapp-web.js`, que **no** es oficial. Se conecta como dispositivo
  vinculado a tu cuenta personal. WhatsApp no permite clientes no oficiales y el
  bloqueo de la cuenta es un riesgo real.
- Manda al grupo, no a cada apoderado por separado. Doce mensajes automaticos a
  numeros que quizas no te tienen agendado es justo el patron que gatilla bloqueos.
- Fija la version de la imagen en vez de usar `:latest`. Una actualizacion del puente
  puede romper la sesion.
- La sesion se cae de vez en cuando y hay que volver a escanear el QR. Agrega una
  automatizacion que te avise a ti si el sensor queda en `unavailable`, para no
  descubrirlo el dia que no llego la colacion.

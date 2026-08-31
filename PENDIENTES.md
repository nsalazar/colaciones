# Pendientes y decisiones

Notas para mí, no para los delegados.

## Antes de compartir el sitio

- [ ] Reemplazar los nombres de ejemplo en `data/schedule.json` por los reales,
      **en orden de rotación**.
- [ ] Fijar `rotationStart`: elegir el próximo lunes, averiguar a quién le toca ese
      día, rotar el arreglo `kids` para que esa persona quede primera, y usar esa
      fecha. No intentar reconstruir el historial hacia atrás.
- [ ] Cargar de una vez los `closures` del año: calendario del colegio + feriados.
- [ ] Nombrar el repo `colaciones`, **no** `colacion-kinder`. El nombre queda en la
      URL que los apoderados van a guardar en la pantalla de inicio, y un renombre
      posterior no siempre arrastra los accesos directos ya fijados.
- [ ] Probar en el teléfono: elegir un niño y confirmar que el banner verde muestra
      el turno correcto.
- [ ] Avisar al grupo con una línea: que cada uno toque su hijo una vez.

## Antes de entregar la planilla a los delegados

- [ ] Token de GitHub **fine-grained**, solo este repo, permiso Contents lectura y
      escritura. Nada más.
- [ ] Correr `probarConexion` antes de instalar los triggers.
- [ ] Dejar de editar `data/schedule.json` a mano: desde ese momento se genera.
- [ ] Explicar dos cosas y no más: editan normal, y usan **Revisar** antes de una
      semana cargada.

## Antes de conectar WhatsApp

- [ ] Fijar la versión de la imagen del puente, no `:latest`.
- [ ] Mandar al **grupo**, nunca mensajes individuales a cada apoderado. Ese patrón
      es el que gatilla bloqueos de cuenta.
- [ ] Automatización que me avise **a mí** si el sensor queda en `unavailable`.
- [ ] Decidir el aviso del viernes para el lunes (hoy la condición solo dispara la
      víspera; el script ya resuelve el salto de fin de semana y feriados).

## Diferido a propósito

**Varios cursos.** Un solo repo y un solo sitio. `data/cursos.json` como índice y un
archivo por curso; el curso se elige por URL (`?curso=kinder-b`) y queda en
localStorage. Cada curso con su planilla, sus delegados y su grupo de WhatsApp, así
una planilla rota no tumba a las demás. El selector de niño pasa a ser multi-selección
para ver los dos hijos en una pantalla.

Migrar es mover un archivo a una carpeta, cambiar una constante en `app.js`,
`colacion.py` y `Datos.gs`, y agregar una propiedad `CURSO` por planilla. Una hora.
No hacerlo hasta que exista un segundo curso real con un segundo voluntario real,
que además va a querer algo distinto.

El techo no es técnico sino de gobierno: o el otro apoderado tiene acceso de escritura
a mi repo y yo quedo de operador de un curso que no reviso, o hace un fork y quedan dos
bases de código divergiendo. Ser operador de dos o tres cursos como máximo; más allá de
eso, entregar el proyecto completo en vez de la mitad.

**Regla de rotación duplicada.** Hoy vive en tres lugares: `app.js`, `colacion.py` y
`Datos.gs`. Coinciden porque se probaron contra los mismos datos, pero el próximo
cambio a la regla hay que hacerlo tres veces. El arreglo es que Apps Script emita el
calendario fecha por fecha y que el sitio y HA solo lean asignaciones. Hacerlo antes
de cambiar la regla, no antes de publicar.

**Etiquetar apoderados en WhatsApp.** `ha-wa-bridge` no expone menciones reales:
escribir "@Fulano" queda como texto sin notificación. Y etiquetar a uno cada día
notifica a once familias por algo que no les toca, que es como se termina silenciando
el grupo. Reservarlo para reunión, paseo o un turno que alguien se saltó.

**CMS tipo Decap o Tina.** Descartado. La planilla es la única herramienta que los
delegados ya saben usar.

## Fallas silenciosas conocidas

- **El token fine-grained caduca.** Cuando pase, la publicación se detiene y los
  delegados siguen editando sin saberlo. El único aviso es el correo que me llega.
  Anotar la fecha de vencimiento en el calendario.
- **La sesión de WhatsApp se cae** y hay que volver a escanear el QR. Sin la alerta
  del sensor, me entero el día que nadie llevó la colación.
- **La validación no atrapa datos válidos pero equivocados.** Un nombre mal escrito en
  `Cambios` pasa todos los controles y llega al sitio. El historial de git es el
  "deshacer", pero lo uso yo, no los delegados.

## Contexto que conviene no olvidar

- Los teléfonos y correos viven **solo** en la planilla. Nunca en el repo, que es
  público. Ley 21.719 entra en vigencia el 1 de diciembre de 2026 y correo y teléfono
  son datos personales bajo esa ley.
- El sitio lleva `noindex` y `robots.txt`, pero la URL es pública: cualquiera que la
  tenga entra. Se decidió usar nombres completos sabiendo eso.
- El sitio **no** lee la planilla en vivo. Lee JSON ya generado y validado, para que
  una celda rota no rompa la página a las 7 de la mañana.

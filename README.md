# Colación compartida

Sitio estático para el calendario de colación de un curso. Sin servidor, sin build.
Toda la información vive en `data/schedule.json` y `data/announcements.json`.

## Publicar en GitHub Pages

```bash
cd lonchera
git init -b main
git add .
git commit -m "Calendario de colación"
gh repo create colacion-kinder --public --source=. --push
gh api -X POST repos/:owner/colacion-kinder/pages -f build_type=legacy \
  -f 'source[branch]=main' -f 'source[path]=/'
```

Queda en `https://<tu-usuario>.github.io/colacion-kinder/`. Tarda 1–2 minutos la primera vez.

## Ver antes de publicar

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000`. No sirve abrir `index.html` con doble clic: el navegador
bloquea la lectura de los JSON con `file://`.

## Cómo funciona la rotación

`rotationStart` es el primer día del turno del primer niño de la lista `kids`.
Desde ahí el sitio recorre los días hábiles y va asignando en orden, saltándose
todo lo que esté en `skipDates`. Nadie tiene que editar nada semana a semana.

`weekdays` define el tipo de comida por día (`1` = lunes … `5` = viernes).
Si un día no aparece en `weekdays`, ese día no hay colación.

### Cambios entre apoderados

Un cambio son dos entradas en `overrides`, una por cada fecha:

```json
"overrides": [
  { "date": "2026-09-02", "kid": "Joaquín Bravo",  "note": "cambio con Catalina" },
  { "date": "2026-09-10", "kid": "Catalina Muñoz", "note": "cambio con Joaquín" }
]
```

El `note` se muestra como etiqueta naranja al lado de la comida. Los `overrides`
no alteran la rotación de fondo: solo reemplazan al niño de esa fecha puntual.

### Días sin colación

Los sábados y domingos ya están fuera: la rotación solo recorre lunes a viernes.
Todo lo demás va en `closures`, que acepta un día suelto o un rango:

```json
"closures": [
  { "from": "2026-07-13", "to": "2026-07-24", "reason": "Vacaciones de invierno" },
  { "date": "2026-09-18", "reason": "Fiestas Patrias" },
  { "date": "2026-09-30", "type": "sinColacion", "reason": "Aniversario, hay catering" }
]
```

Hay dos tipos, y la diferencia importa:

- **Sin `type`** (por defecto, `sinClases`): feriado o vacaciones. El día aparece
  apagado y nadie tiene que hacer nada.
- **`"type": "sinColacion"`**: hay clases pero ese día no se manda comida. Aparece
  destacado en naranjo con el motivo, para que nadie mande colación por costumbre.

En los dos casos el turno **no se pierde**: se corre al siguiente día hábil, así que
la rotación sigue pareja. Los rangos largos, como vacaciones de verano, funcionan igual.

Los feriados chilenos cambian poco: conviene cargar los del año de una vez en marzo
(están en feriados.cl o en la API de feriados del gobierno) en vez de automatizarlo.
Son unas 15 fechas al año.

## Avisos

`data/announcements.json` es una lista de `{ date, title, body }`. Se ordenan solos
por fecha, del más nuevo al más antiguo. Borra los viejos cuando quieras.

## Actividades de curso

`events` es independiente de la rotación: son cosas que involucran a varios o a todos
los apoderados. Se muestran pegadas al día que corresponde, sin alterar el turno de colación.

```json
"events": [
  { "date": "2026-10-08", "time": "19:00", "title": "Reunión de apoderados",
    "audience": "todos", "place": "Sala Kínder B" },
  { "from": "2026-11-05", "to": "2026-11-06", "title": "Paseo a Farellones",
    "audience": "todos", "note": "Llevar parka y almuerzo" },
  { "date": "2026-10-20", "title": "Turno de decoración",
    "audience": ["Diego Fuentes", "Emilia Cortés"] }
]
```

`audience` es `"todos"` o una lista de niños. Si el apoderado eligió su hijo abajo,
las actividades que le tocan se destacan en naranjo.

## Recordatorios (opcional)

Los contactos **no van en este repo**: es público. La forma más simple es una planilla
de Google privada con `niño | apoderado | correo`, y un Apps Script con trigger diario
que lee `data/schedule.json` desde el sitio publicado, busca el turno de pasado mañana
y manda el correo. Sin llaves de API, sin servidor, y la directiva puede editar la
planilla sin tocar git.

## Notas

- Cada apoderado elige su hijo o hija una vez; queda en `localStorage` de su teléfono
  y el sitio le muestra arriba cuándo le toca. No hay cuentas ni backend.
- El botón de compartir arma el texto de la semana y abre el menú nativo del teléfono
  (o lo copia al portapapeles en desktop).
- El sitio incluye `robots.txt` y `noindex` para que no aparezca en Google. Aun así
  la URL es pública: cualquiera que la tenga puede entrar.

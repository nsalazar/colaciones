/**
 * Lectura, validación y armado del JSON.
 * Los teléfonos se leen pero NUNCA se publican: quedan solo en la planilla.
 */

const HOJAS = {
  config: { nombre: 'Config', columnas: ['Clave', 'Valor'] },
  ninos: { nombre: 'Niños', columnas: ['Niño', 'Apoderado', 'Teléfono', 'Activo'] },
  cambios: { nombre: 'Cambios', columnas: ['Fecha', 'Niño', 'Nota'] },
  cierres: { nombre: 'Cierres', columnas: ['Desde', 'Hasta', 'Motivo', 'Tipo'] },
  actividades: { nombre: 'Actividades', columnas: ['Desde', 'Hasta', 'Hora', 'Título', 'Participantes', 'Lugar'] },
  avisos: { nombre: 'Avisos', columnas: ['Fecha', 'Título', 'Texto'] }
};

const DIAS_CLAVE = { 'Lunes': '1', 'Martes': '2', 'Miércoles': '3', 'Jueves': '4', 'Viernes': '5' };

function tz() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone();
}

function iso(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, tz(), 'yyyy-MM-dd');
  const t = String(valor || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}

/** Lee una hoja como lista de objetos. Lanza error si falta la hoja o un encabezado. */
function leerHoja(def) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(def.nombre);
  if (!hoja) throw new Error('falta la hoja "' + def.nombre + '"');

  const valores = hoja.getDataRange().getValues();
  if (!valores.length) throw new Error('la hoja "' + def.nombre + '" está vacía');

  const encabezados = valores[0].map(function (h) { return String(h).trim(); });
  const indices = {};
  def.columnas.forEach(function (col) {
    const i = encabezados.indexOf(col);
    if (i === -1) throw new Error('falta la columna "' + col + '" en "' + def.nombre + '"');
    indices[col] = i;
  });

  const filas = [];
  for (let f = 1; f < valores.length; f++) {
    const fila = valores[f];
    if (fila.every(function (c) { return String(c).trim() === ''; })) continue;
    const obj = { _fila: f + 1, _hoja: def.nombre };
    def.columnas.forEach(function (col) { obj[col] = fila[indices[col]]; });
    filas.push(obj);
  }
  return filas;
}

function leerPlanilla() {
  const config = {};
  leerHoja(HOJAS.config).forEach(function (f) {
    config[String(f['Clave']).trim()] = f['Valor'];
  });

  return {
    config: config,
    ninos: leerHoja(HOJAS.ninos),
    cambios: leerHoja(HOJAS.cambios),
    cierres: leerHoja(HOJAS.cierres),
    actividades: leerHoja(HOJAS.actividades),
    avisos: leerHoja(HOJAS.avisos)
  };
}

function leerPlanillaSilencioso() {
  try { return leerPlanilla(); } catch (err) { return null; }
}

function activos(datos) {
  return datos.ninos.filter(function (n) {
    const v = String(n['Activo']).trim().toLowerCase();
    return v !== 'no' && v !== 'false' && v !== '0';
  });
}

/* ---------------- validación ---------------- */

function validar(datos) {
  const p = [];
  const add = function (hoja, fila, mensaje) { p.push({ hoja: hoja, fila: fila, mensaje: mensaje }); };

  if (!String(datos.config['Curso'] || '').trim()) {
    add(HOJAS.config.nombre, 1, 'falta el valor de "Curso"');
  }
  if (!iso(datos.config['Inicio rotación'])) {
    add(HOJAS.config.nombre, 1, '"Inicio rotación" tiene que ser una fecha');
  }
  const conComida = Object.keys(DIAS_CLAVE).filter(function (d) {
    return String(datos.config[d] || '').trim();
  });
  if (!conComida.length) {
    add(HOJAS.config.nombre, 1, 'ningún día tiene tipo de colación asignado');
  }

  const lista = activos(datos);
  if (lista.length < 2) {
    add(HOJAS.ninos.nombre, 2, 'se necesitan al menos dos niños activos');
  }
  const vistos = {};
  lista.forEach(function (n) {
    const nombre = String(n['Niño']).trim();
    if (!nombre) return add(n._hoja, n._fila, 'la fila tiene datos pero el nombre está vacío');
    if (vistos[nombre]) add(n._hoja, n._fila, 'el nombre "' + nombre + '" está repetido');
    vistos[nombre] = true;
  });

  datos.cambios.forEach(function (c) {
    if (!iso(c['Fecha'])) add(c._hoja, c._fila, 'la fecha no es válida');
    const nombre = String(c['Niño']).trim();
    if (!vistos[nombre]) add(c._hoja, c._fila, '"' + nombre + '" no está en la hoja Niños');
  });

  datos.cierres.forEach(function (c) {
    const d = iso(c['Desde']), h = iso(c['Hasta']) || iso(c['Desde']);
    if (!d) return add(c._hoja, c._fila, '"Desde" no es una fecha válida');
    if (h < d) add(c._hoja, c._fila, '"Hasta" es anterior a "Desde"');
    const tipo = String(c['Tipo'] || '').trim().toLowerCase();
    if (tipo && tipo !== 'sin clases' && tipo !== 'sin colación' && tipo !== 'sin colacion') {
      add(c._hoja, c._fila, 'Tipo debe ser "Sin clases" o "Sin colación"');
    }
    if (!String(c['Motivo'] || '').trim()) add(c._hoja, c._fila, 'falta el motivo');
  });

  datos.actividades.forEach(function (a) {
    if (!iso(a['Desde'])) return add(a._hoja, a._fila, '"Desde" no es una fecha válida');
    if (!String(a['Título'] || '').trim()) add(a._hoja, a._fila, 'falta el título');
    const quienes = String(a['Participantes'] || '').trim();
    if (quienes && quienes.toLowerCase() !== 'todos') {
      quienes.split(',').forEach(function (q) {
        const nombre = q.trim();
        if (nombre && !vistos[nombre]) {
          add(a._hoja, a._fila, '"' + nombre + '" no está en la hoja Niños');
        }
      });
    }
  });

  datos.avisos.forEach(function (a) {
    if (!iso(a['Fecha'])) add(a._hoja, a._fila, 'la fecha no es válida');
    if (!String(a['Título'] || '').trim()) add(a._hoja, a._fila, 'falta el título');
  });

  return p;
}

/** Pinta de rojo las filas con problemas y limpia las que ya están bien. */
function pintarProblemas(problemas) {
  const ss = SpreadsheetApp.getActive();
  const porHoja = {};
  problemas.forEach(function (p) {
    if (!porHoja[p.hoja]) porHoja[p.hoja] = {};
    porHoja[p.hoja][p.fila] = (porHoja[p.hoja][p.fila] || []).concat(p.mensaje);
  });

  Object.keys(HOJAS).forEach(function (k) {
    const def = HOJAS[k];
    const hoja = ss.getSheetByName(def.nombre);
    if (!hoja) return;
    const filas = hoja.getLastRow();
    if (filas < 2) return;

    const rango = hoja.getRange(2, 1, filas - 1, def.columnas.length);
    rango.setBackground(null).clearNote();

    const malas = porHoja[def.nombre] || {};
    Object.keys(malas).forEach(function (f) {
      const n = Number(f);
      if (n < 2 || n > filas) return;
      hoja.getRange(n, 1, 1, def.columnas.length)
        .setBackground('#FBE9DA')
        .setNote(malas[f].join('\n'));
    });
  });
}

/* ---------------- armado del JSON ---------------- */

function construirSchedule(datos) {
  const weekdays = {};
  Object.keys(DIAS_CLAVE).forEach(function (dia) {
    const comida = String(datos.config[dia] || '').trim();
    if (comida) weekdays[DIAS_CLAVE[dia]] = comida;
  });

  const closures = datos.cierres.map(function (c) {
    const desde = iso(c['Desde']);
    const hasta = iso(c['Hasta']) || desde;
    const tipo = String(c['Tipo'] || '').trim().toLowerCase();
    const base = { reason: String(c['Motivo']).trim() };
    if (tipo.indexOf('colaci') !== -1) base.type = 'sinColacion';
    if (desde === hasta) base.date = desde;
    else { base.from = desde; base.to = hasta; }
    return base;
  });

  const events = datos.actividades.map(function (a) {
    const desde = iso(a['Desde']);
    const hasta = iso(a['Hasta']) || desde;
    const ev = { title: String(a['Título']).trim() };
    if (desde === hasta) ev.date = desde;
    else { ev.from = desde; ev.to = hasta; }

    const hora = a['Hora'];
    if (hora instanceof Date) ev.time = Utilities.formatDate(hora, tz(), 'HH:mm');
    else if (String(hora || '').trim()) ev.time = String(hora).trim();

    const quienes = String(a['Participantes'] || 'todos').trim();
    ev.audience = quienes.toLowerCase() === 'todos'
      ? 'todos'
      : quienes.split(',').map(function (q) { return q.trim(); }).filter(String);

    const lugar = String(a['Lugar'] || '').trim();
    if (lugar) ev.place = lugar;
    return ev;
  });

  return {
    curso: String(datos.config['Curso']).trim(),
    rotationStart: iso(datos.config['Inicio rotación']),
    weekdays: weekdays,
    kids: activos(datos).map(function (n) { return String(n['Niño']).trim(); }),
    closures: closures,
    overrides: datos.cambios.map(function (c) {
      return {
        date: iso(c['Fecha']),
        kid: String(c['Niño']).trim(),
        note: String(c['Nota'] || 'cambio').trim()
      };
    }),
    events: events
  };
}

function construirAnnouncements(datos) {
  return datos.avisos.map(function (a) {
    return {
      date: iso(a['Fecha']),
      title: String(a['Título']).trim(),
      body: String(a['Texto'] || '').trim()
    };
  });
}

/* ---------------- vista previa ---------------- */

function informeHtml(datos, problemas) {
  let html = '<div style="font:14px/1.5 system-ui;padding:4px 8px">';

  if (problemas.length) {
    html += '<h3 style="margin:0 0 6px;color:#8A3E06">Hay ' + problemas.length + ' problema(s)</h3><ul>';
    problemas.forEach(function (p) {
      html += '<li><b>' + p.hoja + '</b>, fila ' + p.fila + ': ' + p.mensaje + '</li>';
    });
    html += '</ul><p>Mientras no se arreglen, el sitio sigue mostrando la última versión buena.</p>';
  } else {
    html += '<h3 style="margin:0 0 6px;color:#2F7D4F">La planilla está correcta</h3>';
  }

  try {
    const s = construirSchedule(datos);
    const turnos = calcularTurnos(s, 21);
    html += '<h3 style="margin:14px 0 6px">Próximas tres semanas</h3><table style="border-collapse:collapse">';
    turnos.forEach(function (t) {
      html += '<tr><td style="padding:2px 10px 2px 0;color:#566356">' + t.fecha + '</td>' +
        '<td style="padding:2px 0">' + t.texto + '</td></tr>';
    });
    html += '</table>';
  } catch (err) {
    html += '<p>No se pudo calcular la rotación: ' + err.message + '</p>';
  }

  const estado = PROP.getProperty(CLAVE_SUCIA)
    ? 'Hay cambios sin publicar. Salen solos dentro de unos minutos.'
    : 'Todo lo de la planilla ya está publicado.';
  html += '<p style="margin-top:14px;color:#566356">' + estado + '</p></div>';
  return html;
}

/** Misma regla que el sitio: rota por día hábil, salta cierres, aplica cambios. */
function calcularTurnos(schedule, dias) {
  const cierres = {};
  (schedule.closures || []).forEach(function (c) {
    if (c.date) cierres[c.date] = c;
    else {
      let d = new Date(c.from + 'T00:00:00');
      const fin = new Date(c.to + 'T00:00:00');
      while (d <= fin) {
        cierres[Utilities.formatDate(d, tz(), 'yyyy-MM-dd')] = c;
        d = new Date(d.getTime() + 86400000);
      }
    }
  });

  const asignados = {};
  let cursor = new Date(schedule.rotationStart + 'T00:00:00');
  const limite = new Date(cursor.getTime() + 420 * 86400000);
  let i = 0;
  while (cursor <= limite) {
    const f = Utilities.formatDate(cursor, tz(), 'yyyy-MM-dd');
    const dow = cursor.getDay();
    const comida = schedule.weekdays[String(dow)];
    if (comida && !cierres[f]) {
      asignados[f] = { comida: comida, nino: schedule.kids[i % schedule.kids.length] };
      i++;
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  (schedule.overrides || []).forEach(function (o) {
    if (asignados[o.date]) { asignados[o.date].nino = o.kid; asignados[o.date].nota = o.note; }
  });

  const salida = [];
  let d = new Date();
  for (let n = 0; n < dias; n++) {
    const f = Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      const a = asignados[f];
      const c = cierres[f];
      let texto;
      if (a) texto = a.comida + ' — ' + a.nino + (a.nota ? ' (' + a.nota + ')' : '');
      else if (c && c.type === 'sinColacion') texto = 'No enviar colación: ' + c.reason;
      else if (c) texto = 'Sin clases: ' + c.reason;
      else texto = '—';
      salida.push({ fecha: f, texto: texto });
    }
    d = new Date(d.getTime() + 86400000);
  }
  return salida;
}

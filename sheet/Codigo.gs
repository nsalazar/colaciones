/**
 * Colación compartida — publicación desde la planilla al sitio.
 *
 * Flujo normal: el delegado edita y no hace nada más. Cada edición marca la
 * planilla como "sucia"; un trigger cada 10 minutos valida y publica.
 * El menú existe para revisar y para saltarse la espera.
 */

const PROP = PropertiesService.getScriptProperties();
const CLAVE_SUCIA = 'sucia_desde';
const CLAVE_HASH = 'hash_publicado';
const CLAVE_ULTIMO_ERROR = 'ultimo_error';
const ESPERA_MS = 2 * 60 * 1000; // no publicar si alguien editó hace menos de 2 min

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Colación')
    .addItem('Revisar', 'revisar')
    .addItem('Publicar ahora', 'publicarAhora')
    .addSeparator()
    .addItem('Instalar automatizaciones', 'instalarTriggers')
    .addToUi();
}

/** Muestra qué produce la planilla hoy, sin publicar nada. */
function revisar() {
  const ui = SpreadsheetApp.getUi();
  let datos;
  try {
    datos = leerPlanilla();
  } catch (err) {
    ui.alert('No se pudo leer la planilla', String(err.message), ui.ButtonSet.OK);
    return;
  }

  const problemas = validar(datos);
  pintarProblemas(problemas);

  const html = HtmlService.createHtmlOutput(informeHtml(datos, problemas))
    .setWidth(520)
    .setHeight(560);
  ui.showModalDialog(html, 'Revisión');
}

/** Publica sin esperar el debounce. Para cambios de última hora. */
function publicarAhora() {
  const ui = SpreadsheetApp.getUi();
  const r = intentarPublicar(true);
  if (r.ok && r.cambios) ui.alert('Publicado', 'El sitio se actualiza en un minuto.', ui.ButtonSet.OK);
  else if (r.ok) ui.alert('Sin cambios', 'La planilla ya estaba publicada tal cual.', ui.ButtonSet.OK);
  else ui.alert('No se publicó', r.mensaje, ui.ButtonSet.OK);
}

/* ---------------- triggers ---------------- */

function alEditar(e) {
  PROP.setProperty(CLAVE_SUCIA, String(Date.now()));
  const datos = leerPlanillaSilencioso();
  if (!datos) return;
  const problemas = validar(datos);
  pintarProblemas(problemas);
  const aqui = problemas.filter(function (p) {
    return e && e.range && p.hoja === e.range.getSheet().getName() && p.fila === e.range.getRow();
  });
  if (aqui.length) SpreadsheetApp.getActive().toast(aqui[0].mensaje, 'Revisar esta fila', 8);
}

/** Cambios estructurales: filas o columnas borradas, hojas renombradas. */
function alCambiar(e) {
  PROP.setProperty(CLAVE_SUCIA, String(Date.now()));
  const datos = leerPlanillaSilencioso();
  if (!datos) {
    SpreadsheetApp.getActive().toast(
      'Falta una hoja o una columna. El sitio no se va a actualizar hasta arreglarlo.',
      'Planilla incompleta', 15);
    avisarPorCorreo('La planilla quedó incompleta',
      'Se borró una hoja o una columna con encabezado. El sitio sigue mostrando la última versión buena.');
    return;
  }
  pintarProblemas(validar(datos));
}

/** Cada 10 minutos: publica si hay cambios y nadie está editando. */
function tareaPeriodica() {
  const sucia = PROP.getProperty(CLAVE_SUCIA);
  if (!sucia) return;
  if (Date.now() - Number(sucia) < ESPERA_MS) return; // sigue escribiendo, esperamos
  intentarPublicar(false);
}

/** Red de seguridad diaria: republica aunque nadie haya tocado nada. */
function tareaNocturna() {
  intentarPublicar(true);
}

function intentarPublicar(forzar) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, mensaje: 'Hay otra publicación en curso.' };
  try {
    let datos;
    try {
      datos = leerPlanilla();
    } catch (err) {
      return fallo('Falta una hoja o una columna: ' + err.message);
    }

    const problemas = validar(datos);
    pintarProblemas(problemas);
    if (problemas.length) {
      const lista = problemas.slice(0, 5).map(function (p) {
        return '• ' + p.hoja + ' fila ' + p.fila + ': ' + p.mensaje;
      }).join('\n');
      return fallo('La planilla tiene ' + problemas.length + ' problema(s):\n' + lista);
    }

    const schedule = construirSchedule(datos);
    const announcements = construirAnnouncements(datos);
    const payload = JSON.stringify([schedule, announcements]);
    const hash = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload, Utilities.Charset.UTF_8));

    if (!forzar && hash === PROP.getProperty(CLAVE_HASH)) {
      PROP.deleteProperty(CLAVE_SUCIA);
      return { ok: true, cambios: false };
    }

    subirAGithub('data/schedule.json', JSON.stringify(schedule, null, 2));
    subirAGithub('data/announcements.json', JSON.stringify(announcements, null, 2));

    PROP.setProperty(CLAVE_HASH, hash);
    PROP.deleteProperty(CLAVE_SUCIA);
    escribirEstado('Publicado ' + ahoraTexto());
    if (PROP.getProperty(CLAVE_ULTIMO_ERROR)) {
      PROP.deleteProperty(CLAVE_ULTIMO_ERROR);
    }
    return { ok: true, cambios: true };
  } catch (err) {
    return fallo(String(err.message));
  } finally {
    lock.releaseLock();
  }
}

function fallo(mensaje) {
  escribirEstado('Sin publicar ' + ahoraTexto() + ' — ' + mensaje.split('\n')[0]);
  if (PROP.getProperty(CLAVE_ULTIMO_ERROR) !== mensaje) {
    PROP.setProperty(CLAVE_ULTIMO_ERROR, mensaje);
    avisarPorCorreo('La colación no se publicó', mensaje);
  }
  return { ok: false, mensaje: mensaje };
}

function avisarPorCorreo(asunto, cuerpo) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), asunto,
      cuerpo + '\n\nEl sitio sigue mostrando la última versión válida.\n' +
      SpreadsheetApp.getActive().getUrl());
  } catch (err) {
    // sin cuota de correo: el estado en la hoja Config basta
  }
}

function ahoraTexto() {
  return Utilities.formatDate(new Date(),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd/MM HH:mm');
}

/** Deja los triggers instalados. Se corre una sola vez, desde el menú. */
function instalarTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('alEditar').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('alCambiar').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('tareaPeriodica').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('tareaNocturna').timeBased().atHour(3).everyDays(1).create();

  SpreadsheetApp.getUi().alert('Listo',
    'Automatizaciones instaladas: validación al editar, publicación cada 10 minutos ' +
    'y republicación diaria a las 3 AM.', SpreadsheetApp.getUi().ButtonSet.OK);
}

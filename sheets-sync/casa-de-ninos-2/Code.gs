/**
 * Sync script for "Casa de Niños 2" — publishes this Sheet's tabs to the
 * colaciones GitHub repo as data/casa-de-ninos-2/schedule.json and
 * data/casa-de-ninos-2/announcements.json.
 *
 * Setup:
 * 1. Extensions > Apps Script, paste this file as Code.gs.
 * 2. Create a second file "Sidebar" (HTML), paste sheets-sync/Sidebar.html.
 * 3. Project Settings > Script Properties > add GITHUB_TOKEN with your
 *    GitHub Personal Access Token (Contents: Read and write on this repo).
 * 4. Reload the Sheet, use the "Colación" menu > "Mostrar panel de publicación".
 */

const REPO = "nsalazar/colaciones";
const SCHEDULE_PATH = "data/casa-de-ninos-2/schedule.json";
const ANNOUNCEMENTS_PATH = "data/casa-de-ninos-2/announcements.json";

const DIRTY_KEY = "colacion_dirty";

/** Pestañas que sí viajan a GitHub vía publish()/buildSchedule()/buildAnnouncements(). */
const PUBLISHED_SHEETS = [
  "Config", "Rotacion", "Colaciones", "Cierres",
  "Historial", "Eventos", "Adjuntos", "Restricciones", "Avisos"
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Colación")
    .addItem("Mostrar panel de publicación", "showSidebar")
    .addToUi();
}

/**
 * Marca "cambios sin publicar" solo si la edición puede afectar lo que sale
 * a GitHub. Contactos y Notificaciones nunca se publican, así que editarlas
 * no debe encender el aviso. En Config, solo "Curso" e "Inicio de rotación"
 * se publican — Alias e "ID de Grupo WhatsApp" son de uso interno del Sheet.
 */
function onEdit(e) {
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (PUBLISHED_SHEETS.indexOf(sheetName) === -1) return;

  if (sheetName === "Config") {
    const headers = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0];
    const campoCol = headers.indexOf("Campo") + 1;
    if (campoCol < 1) return;
    const startRow = Math.max(e.range.getRow(), 4);
    const endRow = e.range.getLastRow();
    if (startRow > endRow) return;
    const campos = sheet.getRange(startRow, campoCol, endRow - startRow + 1, 1).getValues();
    const touchesPublished = campos.some(function (row) {
      return row[0] === "Curso" || row[0] === "Inicio de rotación (rotationStart)";
    });
    if (!touchesPublished) return;
  }

  PropertiesService.getDocumentProperties().setProperty(DIRTY_KEY, "true");
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("Publicar a GitHub");
  SpreadsheetApp.getUi().showSidebar(html);
}

function getStatus() {
  const dirty = PropertiesService.getDocumentProperties().getProperty(DIRTY_KEY) === "true";
  return { dirty: dirty };
}

function readTable(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error("No existe la pestaña: " + sheetName);
  const values = sheet.getDataRange().getValues();
  // Row 1 = legend text, Row 2 = blank, Row 3 = header, Row 4+ = data.
  const header = values[2];
  const dataRows = values.slice(3).filter(function (r) {
    return r.some(function (c) { return c !== "" && c !== null; });
  });
  return dataRows.map(function (r) {
    const obj = {};
    header.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
}

/**
 * Reemplaza las filas de datos (fila 4 en adelante) de una pestaña.
 * `records` es un arreglo de objetos { "Nombre de columna": valor }; el orden
 * real de las columnas se lee de la fila 3, igual que hace readTable().
 */
function writeTable(sheetName, records) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error("No existe la pestaña: " + sheetName);
  const headers = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0];
  const numCols = headers.filter(function (h) { return h !== "" && h !== null; }).length;
  const lastRow = sheet.getLastRow();
  if (lastRow >= 4) {
    sheet.getRange(4, 1, lastRow - 3, sheet.getLastColumn()).clearContent();
  }
  if (records.length) {
    const rows = records.map(function (rec) {
      return headers.slice(0, numCols).map(function (h) { return rec[h] !== undefined ? rec[h] : ""; });
    });
    sheet.getRange(4, 1, rows.length, numCols).setValues(rows);
  }
}

function fmtDate(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(v).trim();
}

function readConfigMap() {
  const cfg = {};
  readTable("Config").forEach(function (r) { cfg[r["Campo"]] = r["Valor"]; });
  return cfg;
}

function buildSchedule() {
  const cfg = readConfigMap();

  const dowMap = { "Lunes": "1", "Martes": "2", "Miércoles": "3", "Jueves": "4", "Viernes": "5" };
  const weekdays = {};
  readTable("Colaciones").forEach(function (r) {
    const key = dowMap[String(r["Día"]).trim()];
    if (key) weekdays[key] = r["Colación"];
  });

  const kids = readTable("Rotacion").map(function (r) { return r["Niño/a"]; }).filter(String);

  const closures = readTable("Cierres").map(function (r) {
    const entry = {};
    const from = fmtDate(r["Fecha inicio"]);
    const to = fmtDate(r["Fecha fin"]);
    if (to) { entry.from = from; entry.to = to; } else { entry.date = from; }
    entry.reason = r["Motivo"] || "";
    if (String(r["Tipo"]).trim() === "sinColacion") entry.type = "sinColacion";
    return entry;
  });

  const history = readTable("Historial").map(function (r) {
    return { date: fmtDate(r["Fecha"]), kid: r["Niño/a"] };
  });

  const events = readTable("Eventos").map(function (r) {
    const entry = {};
    const from = fmtDate(r["Fecha inicio"]);
    const to = fmtDate(r["Fecha fin"]);
    if (to) { entry.from = from; entry.to = to; } else { entry.date = from; }
    if (r["Hora"]) entry.time = String(r["Hora"]);
    entry.title = r["Título"] || "";
    const aud = String(r["Audiencia"] || "Todos").trim();
    entry.audience = aud.toLowerCase() === "todos"
      ? "todos"
      : aud.split(",").map(function (s) { return s.trim(); });
    if (r["Nota"]) entry.note = r["Nota"];
    if (r["Lugar"]) entry.place = r["Lugar"];
    return entry;
  });

  const attachments = readTable("Adjuntos").map(function (r) {
    const entry = { date: fmtDate(r["Fecha"]) };
    if (String(r["Tipo"]).trim() === "Enlace") entry.link = r["Valor"];
    else entry.file = r["Valor"];
    if (r["Etiqueta"]) entry.label = r["Etiqueta"];
    return entry;
  });

  const restrictions = readTable("Restricciones")
    .filter(function (r) { return r["Restricción"]; })
    .map(function (r) { return { restriction: r["Restricción"], kid: r["Niño/a"] || "" }; });

  return {
    curso: cfg["Curso"],
    rotationStart: fmtDate(cfg["Inicio de rotación (rotationStart)"]),
    weekdays: weekdays,
    kids: kids,
    closures: closures,
    history: history,
    events: events,
    attachments: attachments,
    restrictions: restrictions
  };
}

function buildAnnouncements() {
  return readTable("Avisos").map(function (r) {
    return { date: fmtDate(r["Fecha"]), title: r["Título"], body: r["Cuerpo"] };
  });
}

function githubRequest(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Falta configurar GITHUB_TOKEN en Script Properties.");
  const url = "https://api.github.com/repos/" + REPO + "/contents/" + path;
  const options = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json"
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, options);
  return { code: res.getResponseCode(), body: res.getContentText() };
}

function putFile(path, jsonObj, message) {
  const getRes = githubRequest("get", path);
  let sha;
  if (getRes.code === 200) sha = JSON.parse(getRes.body).sha;

  const content = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(jsonObj, null, 2) + "\n").getBytes()
  );
  const payload = { message: message, content: content };
  if (sha) payload.sha = sha;

  const putRes = githubRequest("put", path, payload);
  if (putRes.code !== 200 && putRes.code !== 201) {
    throw new Error("Error publicando " + path + ": " + putRes.code + " " + putRes.body);
  }
}

function publish() {
  const schedule = buildSchedule();
  const announcements = buildAnnouncements();

  putFile(SCHEDULE_PATH, schedule, "Actualizar " + schedule.curso + " desde Google Sheets");
  putFile(ANNOUNCEMENTS_PATH, announcements, "Actualizar avisos de " + schedule.curso + " desde Google Sheets");

  PropertiesService.getDocumentProperties().deleteProperty(DIRTY_KEY);
  return { ok: true, curso: schedule.curso };
}

/**
 * Deshace cambios sin publicar: trae lo que hay AHORA MISMO en GitHub y
 * sobreescribe las pestañas de datos con eso. No toca Contactos,
 * Notificaciones, ni las filas de Config que no se publican (Alias, ID de
 * Grupo WhatsApp), porque esas nunca salen hacia GitHub.
 */
function revertFromGithub() {
  const scheduleRes = githubRequest("get", SCHEDULE_PATH);
  const announcementsRes = githubRequest("get", ANNOUNCEMENTS_PATH);
  if (scheduleRes.code !== 200 || announcementsRes.code !== 200) {
    throw new Error("No se pudo leer desde GitHub (código " + scheduleRes.code + "/" + announcementsRes.code + ").");
  }
  const schedule = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(JSON.parse(scheduleRes.body).content)).getDataAsString()
  );
  const announcements = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(JSON.parse(announcementsRes.body).content)).getDataAsString()
  );

  const configSheet = SpreadsheetApp.getActive().getSheetByName("Config");
  const configHeaders = configSheet.getRange(3, 1, 1, configSheet.getLastColumn()).getValues()[0];
  const campoCol = configHeaders.indexOf("Campo") + 1;
  const valorCol = configHeaders.indexOf("Valor") + 1;
  const configValues = configSheet.getDataRange().getValues();
  for (let i = 3; i < configValues.length; i++) {
    const campo = configValues[i][campoCol - 1];
    if (campo === "Curso") configSheet.getRange(i + 1, valorCol).setValue(schedule.curso);
    if (campo === "Inicio de rotación (rotationStart)") configSheet.getRange(i + 1, valorCol).setValue(schedule.rotationStart);
  }

  writeTable("Rotacion", (schedule.kids || []).map(function (k) { return { "Niño/a": k }; }));

  const dowNames = { "1": "Lunes", "2": "Martes", "3": "Miércoles", "4": "Jueves", "5": "Viernes" };
  writeTable("Colaciones", ["1", "2", "3", "4", "5"]
    .filter(function (k) { return schedule.weekdays[k]; })
    .map(function (k) { return { "Día": dowNames[k], "Colación": schedule.weekdays[k] }; }));

  writeTable("Cierres", (schedule.closures || []).map(function (c) {
    return {
      "Fecha inicio": c.date || c.from,
      "Fecha fin": c.date ? "" : c.to,
      "Motivo": c.reason || "",
      "Tipo": c.type === "sinColacion" ? "sinColacion" : "sinClases"
    };
  }));

  writeTable("Historial", (schedule.history || []).map(function (h) {
    return { "Fecha": h.date, "Niño/a": h.kid };
  }));

  writeTable("Eventos", (schedule.events || []).map(function (e) {
    const audience = !e.audience || e.audience === "todos"
      ? "Todos"
      : (Array.isArray(e.audience) ? e.audience.join(", ") : e.audience);
    return {
      "Fecha inicio": e.date || e.from,
      "Fecha fin": e.date ? "" : e.to,
      "Hora": e.time || "",
      "Título": e.title || "",
      "Audiencia": audience,
      "Nota": e.note || "",
      "Lugar": e.place || ""
    };
  }));

  writeTable("Adjuntos", (schedule.attachments || []).map(function (a) {
    return {
      "Fecha": a.date,
      "Tipo": a.link ? "Enlace" : "Archivo",
      "Valor": a.link || a.file || "",
      "Etiqueta": a.label || ""
    };
  }));

  writeTable("Restricciones", (schedule.restrictions || []).map(function (r) {
    return { "Restricción": r.restriction, "Niño/a": r.kid || "" };
  }));

  writeTable("Avisos", announcements.map(function (a) {
    return { "Fecha": a.date, "Título": a.title, "Cuerpo": a.body };
  }));

  PropertiesService.getDocumentProperties().deleteProperty(DIRTY_KEY);
  return { ok: true, curso: schedule.curso };
}

/* ============================================================
 * WHATSAPP — recordatorios por Home Assistant
 *
 * IMPORTANTE: las pestañas "Contactos" y "Notificaciones" NUNCA se leen
 * desde publish()/buildSchedule(), así que los teléfonos jamás salen hacia
 * el repo público de GitHub. Solo viajan de aquí directo al webhook de
 * Home Assistant.
 * ============================================================ */

const TZ = "America/Santiago";
const DOW_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Crea las pestañas Contactos y Notificaciones si no existen. Ejecutar UNA VEZ. */
function setupContactsAndNotificationsTabs() {
  const ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName("Contactos")) {
    const sh = ss.insertSheet("Contactos");
    sh.getRange(1, 1).setValue(
      "Teléfono en formato internacional, solo dígitos (ej. 56912345678, sin +, sin espacios ni guiones)."
    );
    sh.getRange(3, 1, 1, 5).setValues([["Niño/a", "Apoderado 1", "Teléfono 1", "Apoderado 2", "Teléfono 2"]]);
    sh.getRange(4, 1, 1, 5).setValues([["Ej: Iñigo", "María Pérez", "56912345678", "Juan Soto", "56987654321"]]);
  }

  if (!ss.getSheetByName("Notificaciones")) {
    const sh = ss.insertSheet("Notificaciones");
    sh.getRange(1, 1).setValue(
      "Placeholders Diario: {nino} {fecha} {dia_semana} {colacion} {tags}. " +
      "Placeholders Semanal: {semana} {novedades} {primer_dia_semana} (novedades ya trae su propio salto de línea, solo úsalo pegado a {semana}; primer_dia_semana es el lunes de esa semana, ej. 08-Septiembre). " +
      "Hora en formato HH:mm, en punto o :15/:30/:45 (el chequeo corre cada 15 min). " +
      "Activo=FALSE desactiva ese recordatorio sin borrar la fila. " +
      "Todo mensaje sale con un aviso de \"mensaje automático\" agregado desde Home Assistant, no hace falta escribirlo aquí."
    );
    sh.getRange(3, 1, 1, 6).setValues([["Recordatorio", "Activo", "DíaSemana", "DíasAntes", "Hora", "Mensaje"]]);
    sh.getRange(4, 1, 1, 6).setValues([[
      "Diario", "TRUE", "", 1, "09:00",
      "Hola! El día {dia_semana} {fecha} le toca a {nino} llevar la colación compartida: \n🍽️ {colacion} {tags}"
    ]]);
    sh.getRange(5, 1, 1, 6).setValues([[
      "Semanal", "TRUE", "Viernes", "", "09:00",
      "Hola! La colación compartida de la semana del {primer_dia_semana} queda así:\n{semana}{novedades}"
    ]]);
    sh.setColumnWidth(6, 420);
  }

  const configSheet = ss.getSheetByName("Config");
  const configRows = readTable("Config");
  const hasGroupRow = configRows.some(function (r) { return r["Campo"] === "ID de Grupo WhatsApp"; });
  if (configSheet && !hasGroupRow) {
    configSheet.getRange(configSheet.getLastRow() + 1, 1, 1, 2).setValues([["ID de Grupo WhatsApp", ""]]);
  }

  styleWhatsappTabs();
  reorderTabs();

  SpreadsheetApp.getUi().alert(
    "Listo. Revisa las pestañas Contactos y Notificaciones, completa tus datos, y en Config " +
    "agrega el \"ID de Grupo WhatsApp\" si quieres que el resumen semanal se envíe al grupo del curso " +
    "(vacío = no se envía)."
  );
}

/** Aplica el mismo estilo (encabezado teal, leyenda en cursiva, fuente) que ya tienen las demás pestañas. */
function styleWhatsappTabs() {
  styleTable(SpreadsheetApp.getActive().getSheetByName("Contactos"), 5);
  styleTable(SpreadsheetApp.getActive().getSheetByName("Notificaciones"), 6);
}

function styleTable(sh, numCols) {
  if (!sh) return;

  sh.getRange(1, 1)
    .setFontFamily("Arial").setFontStyle("italic").setFontSize(9).setFontColor("#5C6860");
  sh.setRowHeight(1, 28);

  sh.getRange(3, 1, 1, numCols)
    .setBackground("#1C8E79").setFontColor("#FFFFFF")
    .setFontWeight("bold").setFontFamily("Arial").setFontSize(10);

  const lastRow = sh.getLastRow();
  if (lastRow >= 4) {
    sh.getRange(4, 1, lastRow - 3, numCols)
      .setFontFamily("Arial").setFontSize(10).setFontWeight("normal").setFontStyle("normal").setFontColor("#000000");
  }

  sh.setFrozenRows(3);
}

/** Deja las pestañas de ambos Sheets en el mismo orden: setup -> calendario -> extras -> notificaciones. */
function reorderTabs() {
  const ss = SpreadsheetApp.getActive();
  const order = [
    "Config", "Rotacion", "Colaciones", "Contactos",
    "Cierres", "Historial", "Eventos",
    "Adjuntos", "Restricciones", "Avisos",
    "Notificaciones"
  ];
  order.forEach(function (name, i) {
    const sh = ss.getSheetByName(name);
    if (sh) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    }
  });
}

/* ---------- fechas (mismo enfoque que el sitio, sin drift de UTC) ---------- */

function parseDateLocal(iso) {
  const p = String(iso).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function toISO(d) {
  const p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function longDateEs(d) {
  return d.getDate() + " de " + MESES_ES[d.getMonth()];
}

/** "Martes 01-Septiembre" — usado en el bloque de novedades del resumen semanal. */
function novedadFechaEs(d) {
  const dow = DOW_ES[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mes = MESES_ES[d.getMonth()];
  const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1);
  return dow + " " + dd + "-" + mesCap;
}

/** "01-Septiembre" — usado como {primer_dia_semana} en el resumen semanal. */
function soloFechaEs(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mes = MESES_ES[d.getMonth()];
  const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1);
  return dd + "-" + mesCap;
}

/* ---------- rotación (portado de app.js — misma lógica que usa el sitio) ---------- */

function expandClosuresMap(list) {
  const map = {};
  (list || []).forEach(function (c) {
    const entry = { type: c.type === "sinColacion" ? "sinColacion" : "sinClases", reason: c.reason || "" };
    if (c.date) {
      map[c.date] = entry;
    } else if (c.from && c.to) {
      let d = parseDateLocal(c.from);
      const end = parseDateLocal(c.to);
      while (d <= end) { map[toISO(d)] = entry; d = addDays(d, 1); }
    }
  });
  return map;
}

function buildIndexMap(cfg, closures) {
  const map = {};
  if (cfg.kids && cfg.kids.length) {
    let cursor = parseDateLocal(cfg.rotationStart);
    const last = addDays(cursor, 420);
    let turn = 0;
    while (cursor <= last) {
      const dow = cursor.getDay();
      const iso = toISO(cursor);
      const meal = cfg.weekdays[String(dow)];
      if (meal && !closures[iso]) {
        map[iso] = { meal: meal, kid: cfg.kids[turn % cfg.kids.length] };
        turn++;
      }
      cursor = addDays(cursor, 1);
    }
  }
  (cfg.history || []).forEach(function (h) {
    const meal = cfg.weekdays[String(parseDateLocal(h.date).getDay())];
    if (meal) map[h.date] = { meal: meal, kid: h.kid };
  });
  (cfg.overrides || []).forEach(function (o) {
    const entry = map[o.date];
    if (entry) {
      entry.kid = o.kid;
      if (o.note) { entry.note = o.note; entry.swapped = true; }
    }
  });
  return map;
}

/* ---------- contactos ---------- */

function normalizePhone(v) {
  return String(v).replace(/[^0-9]/g, "");
}

function readContacts() {
  const map = {};
  readTable("Contactos").forEach(function (r) {
    const kid = r["Niño/a"];
    if (!kid) return;
    const contacts = [];
    if (r["Teléfono 1"]) contacts.push({ name: r["Apoderado 1"] || "", phone: normalizePhone(r["Teléfono 1"]) });
    if (r["Teléfono 2"]) contacts.push({ name: r["Apoderado 2"] || "", phone: normalizePhone(r["Teléfono 2"]) });
    map[kid] = contacts;
  });
  return map;
}

function tagsFor(contacts) {
  return contacts
    .filter(function (c) { return c.name; })
    .map(function (c) { return "@" + c.name; })
    .join(" ");
}

/* ---------- configuración de notificaciones ---------- */

function fmtTime(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "HH:mm");
  return String(v || "").trim();
}

function readNotifConfig() {
  const byType = {};
  readTable("Notificaciones").forEach(function (r) {
    byType[r["Recordatorio"]] = {
      activo: String(r["Activo"]).trim().toUpperCase() !== "FALSE",
      diaSemana: r["DíaSemana"] ? String(r["DíaSemana"]).trim() : "",
      diasAntes: r["DíasAntes"] ? Number(r["DíasAntes"]) : 1,
      hora: fmtTime(r["Hora"]),
      mensaje: r["Mensaje"] || ""
    };
  });
  return byType;
}

function fillTemplate(tpl, data) {
  return tpl.replace(/\{(\w+)\}/g, function (_, key) {
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : "";
  });
}

/* ---------- envío ----------
 * `target` ya debe venir como JID completo:
 *   - número individual: "56912345678@s.whatsapp.net"
 *   - grupo:             "<idDeGrupo>@g.us"
 */

function sendWhatsapp(target, message) {
  const url = PropertiesService.getScriptProperties().getProperty("HA_WEBHOOK_URL");
  if (!url) throw new Error("Falta configurar HA_WEBHOOK_URL en Script Properties.");
  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ target: target, message: message }),
    muteHttpExceptions: true
  });
}

/* ---------- recordatorio diario (a cada apoderado, directo) ---------- */

/** Arma y envía el recordatorio diario para una fecha objetivo concreta. */
function buildDailyMessageAndSend(conf, target) {
  const cfg = buildSchedule();
  const closures = expandClosuresMap(cfg.closures);
  const index = buildIndexMap(cfg, closures);
  const contacts = readContacts();

  const iso = toISO(target);
  const entry = index[iso];
  if (!entry) {
    return { sent: false, reason: "No hay colación asignada ese día (feriado, vacaciones o sin datos)." };
  }

  const kidContacts = contacts[entry.kid] || [];
  const message = fillTemplate(conf.mensaje, {
    nino: entry.kid,
    fecha: longDateEs(target),
    dia_semana: DOW_ES[target.getDay()],
    colacion: entry.meal,
    tags: tagsFor(kidContacts)
  });

  if (!kidContacts.length) {
    return { sent: false, reason: "'" + entry.kid + "' no tiene contactos cargados en la pestaña Contactos.", message: message };
  }

  kidContacts.forEach(function (c) { sendWhatsapp(c.phone + "@s.whatsapp.net", message); });
  return { sent: true, message: message, kid: entry.kid, phones: kidContacts.map(function (c) { return c.phone; }) };
}

function runDailyReminder(conf) {
  buildDailyMessageAndSend(conf, addDays(new Date(), conf.diasAntes));
}

/* ---------- recordatorio semanal (al grupo del curso) ---------- */

function thisMonday(from) {
  const shift = (from.getDay() + 6) % 7; // días desde el lunes de ESTA semana
  return addDays(from, -shift);
}

function nextMonday(from) {
  return addDays(thisMonday(from), 7);
}

/** Arma y envía el resumen semanal para la semana que empieza en `monday`. */
function buildWeeklyMessageAndSend(conf, monday) {
  const groupId = String(readConfigMap()["ID de Grupo WhatsApp"] || "").trim();
  if (!groupId) {
    return { sent: false, reason: "No hay 'ID de Grupo WhatsApp' configurado en la pestaña Config." };
  }

  const cfg = buildSchedule();
  const closures = expandClosuresMap(cfg.closures);
  const index = buildIndexMap(cfg, closures);

  const sunday = addDays(monday, 7);
  const lines = [];

  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const iso = toISO(d);
    const dowName = DOW_ES[d.getDay()];
    const entry = index[iso];
    const closure = closures[iso];
    if (entry) {
      lines.push("- *" + dowName + " (" + entry.kid + ")*: " + entry.meal);
    } else if (closure) {
      lines.push("- *" + dowName + "*: " + closure.reason);
    } else {
      lines.push("- *" + dowName + "*: (sin información)");
    }
  }

  const eventLines = [];
  (cfg.events || []).forEach(function (e) {
    const dates = [];
    if (e.date) {
      dates.push(e.date);
    } else if (e.from && e.to) {
      let d = parseDateLocal(e.from);
      const end = parseDateLocal(e.to);
      while (d <= end) { dates.push(toISO(d)); d = addDays(d, 1); }
    }
    const inWeekDates = dates.filter(function (iso) {
      const d = parseDateLocal(iso);
      return d >= monday && d < sunday;
    });
    if (inWeekDates.length) {
      const first = parseDateLocal(inWeekDates[0]);
      eventLines.push("- [" + novedadFechaEs(first) + "] " + e.title + (e.time ? " (" + e.time + ")" : ""));
    }
  });

  const novedades = eventLines.length
    ? "\n\n📌 Novedades de la semana:\n" + eventLines.join("\n")
    : "";

  const message = fillTemplate(conf.mensaje, {
    semana: lines.join("\n"),
    novedades: novedades,
    primer_dia_semana: soloFechaEs(monday)
  });

  sendWhatsapp(groupId + "@g.us", message);
  return { sent: true, message: message };
}

function runWeeklyReminder(conf) {
  buildWeeklyMessageAndSend(conf, nextMonday(new Date()));
}

/* ---------- pruebas manuales (llamadas desde el panel lateral) ---------- */

function testWeekly(which) {
  const conf = readNotifConfig()["Semanal"];
  if (!conf) throw new Error("Falta la fila 'Semanal' en la pestaña Notificaciones.");
  const monday = which === "this" ? thisMonday(new Date()) : nextMonday(new Date());
  return buildWeeklyMessageAndSend(conf, monday);
}

function testDaily(dateStr) {
  const conf = readNotifConfig()["Diario"];
  if (!conf) throw new Error("Falta la fila 'Diario' en la pestaña Notificaciones.");
  if (!dateStr) throw new Error("Elige una fecha.");
  return buildDailyMessageAndSend(conf, parseDateLocal(dateStr));
}

/**
 * Trigger instalable (cada 15 min) que revisa si corresponde disparar
 * alguno de los dos recordatorios, según lo configurado en "Notificaciones".
 */
function checkReminders() {
  const now = new Date();
  const hhmm = Utilities.formatDate(now, TZ, "HH:mm");
  const today = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  const notif = readNotifConfig();

  const diario = notif["Diario"];
  if (diario && diario.activo && diario.hora === hhmm) {
    const key = "sent_diario_" + today;
    if (!props.getProperty(key)) {
      runDailyReminder(diario);
      props.setProperty(key, "1");
    }
  }

  const semanal = notif["Semanal"];
  if (semanal && semanal.activo && semanal.hora === hhmm && DOW_ES[now.getDay()] === semanal.diaSemana) {
    const key = "sent_semanal_" + today;
    if (!props.getProperty(key)) {
      runWeeklyReminder(semanal);
      props.setProperty(key, "1");
    }
  }
}

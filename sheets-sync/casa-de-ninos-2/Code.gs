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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Colación")
    .addItem("Mostrar panel de publicación", "showSidebar")
    .addToUi();
}

function onEdit(e) {
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
      "Placeholders Semanal: {semana} {novedades} (novedades ya trae su propio salto de línea, solo úsalo pegado a {semana}). " +
      "Hora en formato HH:mm, en punto o :15/:30/:45 (el chequeo corre cada 15 min). " +
      "Activo=FALSE desactiva ese recordatorio sin borrar la fila."
    );
    sh.getRange(3, 1, 1, 6).setValues([["Recordatorio", "Activo", "DíaSemana", "DíasAntes", "Hora", "Mensaje"]]);
    sh.getRange(4, 1, 1, 6).setValues([[
      "Diario", "TRUE", "", 1, "09:00",
      "Hola! Mañana {dia_semana} {fecha} le toca a {nino} llevar la colación 🍽️ {colacion} {tags}"
    ]]);
    sh.getRange(5, 1, 1, 6).setValues([[
      "Semanal", "TRUE", "Viernes", "", "09:00",
      "Hola! La colación compartida para la próxima semana queda así:\n{semana}{novedades}"
    ]]);
    sh.setColumnWidth(6, 420);
  }

  const configSheet = ss.getSheetByName("Config");
  const configRows = readTable("Config");
  const hasGroupRow = configRows.some(function (r) { return r["Campo"] === "ID de Grupo WhatsApp"; });
  if (configSheet && !hasGroupRow) {
    configSheet.getRange(configSheet.getLastRow() + 1, 1, 1, 2).setValues([["ID de Grupo WhatsApp", ""]]);
  }

  SpreadsheetApp.getUi().alert(
    "Listo. Revisa las pestañas Contactos y Notificaciones, completa tus datos, y en Config " +
    "agrega el \"ID de Grupo WhatsApp\" si quieres que el resumen semanal se envíe al grupo del curso " +
    "(vacío = no se envía)."
  );
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

function runDailyReminder(conf) {
  const cfg = buildSchedule();
  const closures = expandClosuresMap(cfg.closures);
  const index = buildIndexMap(cfg, closures);
  const contacts = readContacts();

  const target = addDays(new Date(), conf.diasAntes);
  const iso = toISO(target);
  const entry = index[iso];
  if (!entry) return; // feriado/vacaciones o sin datos ese día

  const kidContacts = contacts[entry.kid] || [];
  if (!kidContacts.length) return;

  const message = fillTemplate(conf.mensaje, {
    nino: entry.kid,
    fecha: longDateEs(target),
    dia_semana: DOW_ES[target.getDay()],
    colacion: entry.meal,
    tags: tagsFor(kidContacts)
  });

  kidContacts.forEach(function (c) { sendWhatsapp(c.phone + "@s.whatsapp.net", message); });
}

/* ---------- recordatorio semanal (al grupo del curso) ---------- */

function nextMonday(from) {
  const shift = (from.getDay() + 6) % 7; // días desde el lunes de ESTA semana
  const thisMonday = addDays(from, -shift);
  return addDays(thisMonday, 7);
}

function runWeeklyReminder(conf) {
  const groupId = String(readConfigMap()["ID de Grupo WhatsApp"] || "").trim();
  if (!groupId) return; // sin grupo configurado en Config -> no se envía

  const cfg = buildSchedule();
  const closures = expandClosuresMap(cfg.closures);
  const index = buildIndexMap(cfg, closures);

  const monday = nextMonday(new Date());
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
    const inWeek = dates.some(function (iso) {
      const d = parseDateLocal(iso);
      return d >= monday && d < sunday;
    });
    if (inWeek) eventLines.push("- " + e.title + (e.time ? " (" + e.time + ")" : ""));
  });

  const novedades = eventLines.length
    ? "\n\n📌 Novedades de la semana:\n" + eventLines.join("\n")
    : "";

  const message = fillTemplate(conf.mensaje, {
    semana: lines.join("\n"),
    novedades: novedades
  });

  sendWhatsapp(groupId + "@g.us", message);
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

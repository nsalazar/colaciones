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

function buildSchedule() {
  const cfgRows = readTable("Config");
  const cfg = {};
  cfgRows.forEach(function (r) { cfg[r["Campo"]] = r["Valor"]; });

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

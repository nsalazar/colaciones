/**
 * Sync script for "Casa de Niños 1" — publishes this Sheet's tabs to the
 * colaciones GitHub repo as data/casa-de-ninos-1/schedule.json and
 * data/casa-de-ninos-1/announcements.json.
 *
 * Setup:
 * 1. Extensions > Apps Script, paste this file as Code.gs.
 * 2. Create a second file "Sidebar" (HTML), paste sheets-sync/Sidebar.html.
 * 3. Project Settings > Script Properties > add GITHUB_TOKEN with your
 *    GitHub Personal Access Token (Contents: Read and write on this repo).
 * 4. Reload the Sheet, use the "Colación" menu > "Mostrar panel de publicación".
 */

const REPO = "nsalazar/colaciones";
const SCHEDULE_PATH = "data/casa-de-ninos-1/schedule.json";
const ANNOUNCEMENTS_PATH = "data/casa-de-ninos-1/announcements.json";
const WEEKLY_IMAGE_PATH = "data/casa-de-ninos-1/weekly-preview.png";
/** raw.githubusercontent.com en vez de la URL de Pages: se actualiza al toque
 *  con el commit, sin esperar el build/deploy de GitHub Pages (que puede
 *  tardar hasta un par de minutos). */
const RAW_BASE_URL = "https://raw.githubusercontent.com/" + REPO + "/main/";

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
    .addItem("Agregar validaciones de datos (una vez)", "applyDataValidation")
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
  const curso = readConfigMap()["Curso"] || "";
  const html = HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("Colación — " + curso);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Sirve el mismo panel como página web independiente (mismo Sidebar.html),
 * para cuando el sidebar de Apps Script no está disponible — la app de
 * Google Sheets en el celular no lo soporta, solo la versión de escritorio.
 * Deploy > New deployment > tipo "Web app" y guardar el enlace como acceso
 * directo en la pantalla de inicio del celular. Ver sheets-sync/README.md.
 */
function doGet() {
  const curso = readConfigMap()["Curso"] || "";
  return HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Colación — " + curso)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getStatus() {
  const dirty = PropertiesService.getDocumentProperties().getProperty(DIRTY_KEY) === "true";
  const curso = readConfigMap()["Curso"] || "";
  return { dirty: dirty, curso: curso };
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

  const eventosHora = readDisplayColumn("Eventos", "Hora");
  const events = readTable("Eventos").map(function (r, i) {
    const entry = {};
    const from = fmtDate(r["Fecha inicio"]);
    const to = fmtDate(r["Fecha fin"]);
    if (to) { entry.from = from; entry.to = to; } else { entry.date = from; }
    if (r["Hora"]) entry.time = parseDisplayTime(eventosHora[i]);
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

function putContentBytes(path, bytes, message) {
  const getRes = githubRequest("get", path);
  let sha;
  if (getRes.code === 200) sha = JSON.parse(getRes.body).sha;

  const payload = { message: message, content: Utilities.base64Encode(bytes) };
  if (sha) payload.sha = sha;

  const putRes = githubRequest("put", path, payload);
  if (putRes.code !== 200 && putRes.code !== 201) {
    throw new Error("Error publicando " + path + ": " + putRes.code + " " + putRes.body);
  }
}

function putFile(path, jsonObj, message) {
  putContentBytes(path, Utilities.newBlob(JSON.stringify(jsonObj, null, 2) + "\n").getBytes(), message);
}

/** Sube un archivo binario (ej. una imagen) al repo. */
function putBinaryFile(path, blob, message) {
  putContentBytes(path, blob.getBytes(), message);
}

/**
 * Revisa los datos del Sheet sin tocar GitHub. `errors` son problemas que
 * romperían el sitio o la rotación (publish() se detiene si hay alguno);
 * `warnings` son probables typos o datos de WhatsApp incompletos que no
 * rompen el sitio pero sí los recordatorios — no bloquean la publicación.
 */
function validateData() {
  const errors = [];
  const warnings = [];

  const cfg = readConfigMap();
  if (!cfg["Curso"]) errors.push("Config: falta \"Curso\".");

  const rotationStartRaw = cfg["Inicio de rotación (rotationStart)"];
  if (!rotationStartRaw) {
    errors.push("Config: falta \"Inicio de rotación (rotationStart)\".");
  } else if (isNaN(parseDateLocal(fmtDate(rotationStartRaw)).getTime())) {
    errors.push("Config: \"Inicio de rotación\" no es una fecha válida: " + rotationStartRaw);
  }

  const groupId = String(cfg["ID de Grupo WhatsApp"] || "").trim();
  if (groupId.indexOf("@") !== -1) {
    warnings.push("Config: \"ID de Grupo WhatsApp\" no debería incluir \"@...\" — el script agrega \"@g.us\" solo.");
  }

  function checkDate(raw, label) {
    if (!raw) return null;
    const d = parseDateLocal(fmtDate(raw));
    if (isNaN(d.getTime())) { errors.push(label + ": fecha inválida \"" + raw + "\"."); return null; }
    return d;
  }

  function checkRange(r, label) {
    const from = checkDate(r["Fecha inicio"], label);
    if (r["Fecha fin"]) {
      const to = checkDate(r["Fecha fin"], label);
      if (from && to && to < from) errors.push(label + ": \"Fecha fin\" es anterior a \"Fecha inicio\".");
    }
  }

  const dowMap = { "Lunes": "1", "Martes": "2", "Miércoles": "3", "Jueves": "4", "Viernes": "5" };
  readTable("Colaciones").forEach(function (r, i) {
    const dia = String(r["Día"] || "").trim();
    if (!dowMap[dia]) {
      errors.push("Colaciones fila " + (i + 4) + ": \"" + dia + "\" no es un día válido (Lunes..Viernes) — ese día queda sin colación definida.");
    }
  });

  const kids = readTable("Rotacion").map(function (r) { return r["Niño/a"]; }).filter(String);
  if (!kids.length) errors.push("Rotacion: no hay ningún niño cargado.");
  const kidsSet = {};
  kids.forEach(function (k) { kidsSet[k] = true; });
  const seenKids = {};
  kids.forEach(function (k) {
    if (seenKids[k]) warnings.push("Rotacion: \"" + k + "\" está repetido — puede desequilibrar la rotación.");
    seenKids[k] = true;
  });

  readTable("Cierres").forEach(function (r, i) {
    const label = "Cierres fila " + (i + 4);
    if (!r["Fecha inicio"]) { errors.push(label + ": falta \"Fecha inicio\"."); return; }
    checkRange(r, label);
    const tipo = String(r["Tipo"] || "").trim();
    if (tipo && tipo !== "sinColacion" && tipo !== "sinClases") {
      warnings.push(label + ": \"Tipo\" = \"" + tipo + "\" no se reconoce, se va a tratar como \"sinClases\".");
    }
  });

  readTable("Historial").forEach(function (r, i) {
    const label = "Historial fila " + (i + 4);
    if (!r["Fecha"]) errors.push(label + ": falta \"Fecha\".");
    else checkDate(r["Fecha"], label);
    const kid = r["Niño/a"];
    if (kid && !kidsSet[kid]) warnings.push(label + ": \"" + kid + "\" no está en Rotacion — revisa que no sea un typo.");
  });

  readTable("Eventos").forEach(function (r, i) {
    const label = "Eventos fila " + (i + 4);
    if (!r["Fecha inicio"]) { errors.push(label + ": falta \"Fecha inicio\"."); return; }
    checkRange(r, label);
    if (!r["Título"]) warnings.push(label + ": no tiene \"Título\".");
    const aud = String(r["Audiencia"] || "Todos").trim();
    if (aud.toLowerCase() !== "todos") {
      aud.split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (name) {
        if (!kidsSet[name]) warnings.push(label + ": \"" + name + "\" en Audiencia no está en Rotacion — revisa que no sea un typo.");
      });
    }
  });

  readTable("Adjuntos").forEach(function (r, i) {
    const label = "Adjuntos fila " + (i + 4);
    if (!r["Fecha"]) errors.push(label + ": falta \"Fecha\".");
    else checkDate(r["Fecha"], label);
    if (!r["Valor"]) errors.push(label + ": falta \"Valor\" (el archivo o el enlace).");
    const tipo = String(r["Tipo"] || "").trim();
    if (tipo && tipo !== "Enlace" && tipo !== "Archivo") {
      warnings.push(label + ": \"Tipo\" = \"" + tipo + "\" no se reconoce, se va a tratar como \"Archivo\".");
    }
  });

  readTable("Restricciones").forEach(function (r, i) {
    const kid = r["Niño/a"];
    if (kid && !kidsSet[kid]) {
      warnings.push("Restricciones fila " + (i + 4) + ": \"" + kid + "\" no está en Rotacion — revisa que no sea un typo.");
    }
  });

  readTable("Avisos").forEach(function (r, i) {
    const label = "Avisos fila " + (i + 4);
    if (!r["Fecha"]) errors.push(label + ": falta \"Fecha\".");
    else checkDate(r["Fecha"], label);
    if (!r["Título"]) warnings.push(label + ": no tiene \"Título\".");
  });

  // Contactos y Notificaciones nunca se publican, pero sí afectan WhatsApp.
  const contactedKids = {};
  readTable("Contactos").forEach(function (r) {
    const kid = r["Niño/a"];
    if (!kid) return;
    if (!kidsSet[kid]) warnings.push("Contactos: \"" + kid + "\" no está en Rotacion — revisa que no sea un typo.");
    [["Teléfono 1", r["Teléfono 1"]], ["Teléfono 2", r["Teléfono 2"]]].forEach(function (pair) {
      const campo = pair[0], val = pair[1];
      if (!val) return;
      contactedKids[kid] = true;
      if (!/^56\d{9}$/.test(normalizePhone(val))) {
        warnings.push("Contactos (" + kid + "): \"" + campo + "\" = \"" + val + "\" no parece un celular chileno válido (formato esperado: 56 + 9 dígitos, ej. 56912345678).");
      }
    });
  });
  kids.forEach(function (kid) {
    if (!contactedKids[kid]) {
      warnings.push("\"" + kid + "\" no tiene teléfono cargado en Contactos — no le va a llegar el recordatorio diario a nadie ese día.");
    }
  });

  const notifHoraDisplay = readDisplayColumn("Notificaciones", "Hora");
  readTable("Notificaciones").forEach(function (r, i) {
    const tipo = r["Recordatorio"];
    const diaSemana = String(r["DíaSemana"] || "").trim();
    if (tipo === "Semanal" && diaSemana && DOW_ES.indexOf(diaSemana) === -1) {
      warnings.push("Notificaciones (Semanal): \"DíaSemana\" = \"" + diaSemana + "\" no es un día válido — el recordatorio nunca se va a disparar solo.");
    }
    if (r["Hora"] && !/^\d{2}:\d{2}$/.test(parseDisplayTime(notifHoraDisplay[i]))) {
      warnings.push("Notificaciones (" + tipo + "): \"Hora\" = \"" + r["Hora"] + "\" no tiene formato HH:mm.");
    }
  });

  return { errors: errors, warnings: warnings };
}

function publish() {
  const validation = validateData();
  if (validation.errors.length) {
    throw new Error("No se publicó por estos problemas:\n- " + validation.errors.join("\n- "));
  }

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

/**
 * Agrega listas desplegables (validación de datos nativa de Sheets) en las
 * columnas que el código compara por texto exacto, para que un typo se note
 * al tipear en vez de romper algo en silencio. Se puede correr de nuevo
 * cuando quieras — no borra datos, solo aplica las reglas. Menú Colación >
 * "Agregar validaciones de datos".
 */
function applyDataValidation() {
  const rotacionSheet = SpreadsheetApp.getActive().getSheetByName("Rotacion");
  if (!rotacionSheet) throw new Error("No existe la pestaña Rotacion.");

  // Rango amplio y en vivo: si agregas niños nuevos en Rotacion, aparecen
  // solos en estas listas sin tener que volver a correr esta función.
  const kidsRange = rotacionSheet.getRange("A4:A500");
  const kidRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(kidsRange, true)
    .setAllowInvalid(true) // avisa, no bloquea: hay excepciones legítimas (niños que ya no están en el curso, en Historial)
    .setHelpText("Debería ser uno de los niños de Rotacion. Si no lo es, revisa que no sea un typo.")
    .build();
  applyValidationToColumn("Historial", "Niño/a", kidRule);
  applyValidationToColumn("Contactos", "Niño/a", kidRule);
  applyValidationToColumn("Restricciones", "Niño/a", kidRule);

  const diaRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"], true)
    .setAllowInvalid(false)
    .build();
  applyValidationToColumn("Colaciones", "Día", diaRule);

  const cierreTipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["", "sinClases", "sinColacion"], true)
    .setAllowInvalid(false)
    .build();
  applyValidationToColumn("Cierres", "Tipo", cierreTipoRule);

  const adjuntoTipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Archivo", "Enlace"], true)
    .setAllowInvalid(false)
    .build();
  applyValidationToColumn("Adjuntos", "Tipo", adjuntoTipoRule);

  const diaSemanaRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"], true)
    .setAllowInvalid(false)
    .build();
  applyValidationToColumn("Notificaciones", "DíaSemana", diaSemanaRule);

  applyCheckboxToColumn("Notificaciones", "Activo");

  SpreadsheetApp.getUi().alert(
    "Listo. Se agregaron listas desplegables en los campos que suelen romperse con un typo " +
    "(nombres de niños, Día, Tipo, DíaSemana). No se modificó ningún dato existente."
  );
}

/** Aplica una regla de validación a una columna (por nombre de encabezado), filas 4 a 500. */
function applyValidationToColumn(sheetName, headerName, rule) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) return;
  const headers = sh.getRange(3, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf(headerName) + 1;
  if (col < 1) return;
  sh.getRange(4, col, 497, 1).setDataValidation(rule);
}

/** Convierte una columna en casillas de verificación (TRUE/FALSE reales). */
function applyCheckboxToColumn(sheetName, headerName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) return;
  const headers = sh.getRange(3, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf(headerName) + 1;
  if (col < 1) return;
  sh.getRange(4, col, 497, 1).insertCheckboxes();
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

/** "Martes 01-Sep" — usado en el bloque de novedades del resumen semanal. */
function novedadFechaEs(d) {
  const dow = DOW_ES[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mes = MESES_ES[d.getMonth()];
  const mesAbr = mes.charAt(0).toUpperCase() + mes.slice(1, 3);
  return dow + " " + dd + "-" + mesAbr;
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

/**
 * Sheets guarda las horas como fecha "cero" (30-dic-1899). Cualquier
 * conversión vía objeto Date (String(), getHours(), Utilities.formatDate())
 * puede reinterpretar esa fecha con la hora local histórica de Santiago
 * (LMT, antes de que Chile estandarizara husos horarios) y desplazar la
 * hora varias horas. Para evitarlo del todo, se lee el TEXTO tal como
 * Sheets lo muestra en la celda (getDisplayValues()) — sin pasar por Date.
 */
function readDisplayColumn(sheetName, headerName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const display = sheet.getDataRange().getDisplayValues();
  const col = values[2].indexOf(headerName);
  if (col < 0) return [];
  const result = [];
  for (let i = 3; i < values.length; i++) {
    const hasData = values[i].some(function (c) { return c !== "" && c !== null; });
    if (hasData) result.push(display[i][col]);
  }
  return result;
}

/** "8:15", "08:15:00" o "8:15 AM" (como lo muestre la celda) → "HH:mm". */
function parseDisplayTime(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const ampm = m[3] ? m[3].toUpperCase() : null;
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return String(h).padStart(2, "0") + ":" + m[2];
}

function readNotifConfig() {
  const horaDisplay = readDisplayColumn("Notificaciones", "Hora");
  const byType = {};
  readTable("Notificaciones").forEach(function (r, i) {
    byType[r["Recordatorio"]] = {
      activo: String(r["Activo"]).trim().toUpperCase() !== "FALSE",
      diaSemana: r["DíaSemana"] ? String(r["DíaSemana"]).trim() : "",
      diasAntes: r["DíasAntes"] ? Number(r["DíasAntes"]) : 1,
      hora: parseDisplayTime(horaDisplay[i]),
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
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ target: target, message: message }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("El webhook de Home Assistant respondió " + code + ": " + res.getContentText());
  }
}

/**
 * Igual que sendWhatsapp() pero manda una imagen con pie de foto — la
 * automatización de HA tiene que revisar si llega "url" y llamar a
 * whatsapp.send_image en vez de whatsapp.send_message. Ver homeassistant/README.md.
 */
function sendWhatsappImage(target, imageUrl, caption) {
  const url = PropertiesService.getScriptProperties().getProperty("HA_WEBHOOK_URL");
  if (!url) throw new Error("Falta configurar HA_WEBHOOK_URL en Script Properties.");
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ target: target, url: imageUrl, message: caption }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("El webhook de Home Assistant respondió " + code + ": " + res.getContentText());
  }
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
  return buildDailyMessageAndSend(conf, addDays(new Date(), conf.diasAntes));
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
  const weekDays = [];

  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const iso = toISO(d);
    const dowName = DOW_ES[d.getDay()];
    const entry = index[iso];
    const closure = closures[iso];
    if (entry) {
      weekDays.push({ bold: dowName + " (" + entry.kid + ")", detail: entry.meal });
    } else if (closure) {
      weekDays.push({ bold: dowName, detail: closure.reason });
    } else {
      weekDays.push({ bold: dowName, detail: "(sin información)" });
    }
  }
  const lines = weekDays.map(function (w) { return "- *" + w.bold + "*: " + w.detail; });

  const eventEntries = [];
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
      const firstIso = inWeekDates[0];
      const first = parseDateLocal(firstIso);
      eventEntries.push({
        date: firstIso,
        line: "- [" + novedadFechaEs(first) + "] " + e.title + (e.time ? " (" + e.time + ")" : "")
      });
    }
  });
  eventEntries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  const eventLines = eventEntries.map(function (entry) { return entry.line; });

  const novedades = eventLines.length
    ? "\n\n*📌 Novedades de la semana:*\n" + eventLines.join("\n")
    : "";

  const primerDiaSemana = soloFechaEs(monday);
  const message = fillTemplate(conf.mensaje, {
    semana: lines.join("\n"),
    novedades: novedades,
    primer_dia_semana: primerDiaSemana
  });

  const target = groupId + "@g.us";
  let imageUrl = null;
  let imageError = null;
  try {
    imageUrl = buildWeeklyImageUrl(cfg.curso, primerDiaSemana, weekDays, eventEntries);
  } catch (err) {
    imageError = String(err);
    console.error("No se pudo generar/subir la imagen semanal, se manda solo texto: " + err);
  }

  if (imageUrl) {
    try {
      sendWhatsappImage(target, imageUrl, message);
      return { sent: true, message: message, image: imageUrl };
    } catch (err) {
      imageError = String(err);
      console.error("No se pudo mandar la imagen semanal, se manda solo texto: " + err);
    }
  }

  sendWhatsapp(target, message);
  return { sent: true, message: message, image: null, imageError: imageError || undefined };
}

/**
 * Genera una imagen (tarjeta simple) con el resumen de la semana usando
 * Google Slides — es lo único con lo que Apps Script puede "dibujar" algo
 * sin depender de un servicio externo pago (no hay Canvas/DOM en Apps
 * Script). Exporta la diapositiva como PNG y la sube al repo; devuelve la
 * URL pública (raw.githubusercontent.com, no la de Pages — se actualiza al
 * toque con el commit en vez de esperar el build/deploy de Pages).
 */
function buildWeeklyImageUrl(curso, primerDiaSemana, weekDays, eventEntries) {
  const deck = getOrCreateWeeklyDeck();
  const slide = deck.getSlides()[0];
  slide.getPageElements().forEach(function (el) { el.remove(); });
  slide.getBackground().setSolidFill("#F3F6F1");

  const W = deck.getPageWidth();

  const title = slide.insertTextBox(
    "Colación compartida\nSemana del " + primerDiaSemana,
    24, 20, W - 48, 66
  );
  title.getText().getTextStyle()
    .setFontFamily("Arial").setForegroundColor("#262F29").setBold(true).setFontSize(20);
  title.getText().getParagraphs()[1].getRange().getTextStyle().setFontSize(14).setBold(false);

  const body = slide.insertTextBox("", 24, 100, W - 48, 260);
  const textRange = body.getText();
  let cursor = 0;
  weekDays.forEach(function (w) {
    const bold = w.bold;
    const rest = ": " + w.detail + "\n";
    textRange.insertText(cursor, bold + rest);
    textRange.getRange(cursor, cursor + bold.length)
      .getTextStyle().setBold(true).setForegroundColor("#0F5347");
    textRange.getRange(cursor + bold.length, cursor + bold.length + rest.length)
      .getTextStyle().setForegroundColor("#262F29");
    cursor += bold.length + rest.length;
  });

  if (eventEntries && eventEntries.length) {
    const header = "\n📌 Novedades de la semana\n";
    textRange.insertText(cursor, header);
    textRange.getRange(cursor, cursor + header.length).getTextStyle().setBold(true);
    cursor += header.length;
    eventEntries.forEach(function (e) {
      const plain = e.line.replace(/^- /, "") + "\n";
      textRange.insertText(cursor, plain);
      cursor += plain.length;
    });
  }
  body.getText().getTextStyle().setFontFamily("Arial").setFontSize(13);

  // Sin flush(), Apps Script puede no haber terminado de aplicar los
  // cambios cuando se pide la exportación — la imagen sale en blanco
  // (capturó la diapositiva antes de que el texto/color llegaran a existir).
  SlidesApp.flush();

  const pageId = slide.getObjectId();
  const exportUrl = "https://docs.google.com/presentation/d/" + deck.getId() + "/export/png?id=" + deck.getId() + "&pageid=" + pageId;
  const res = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("No se pudo exportar la imagen de Slides: " + res.getResponseCode());
  }

  putBinaryFile(WEEKLY_IMAGE_PATH, res.getBlob(), "Actualizar imagen semanal de " + curso);
  return RAW_BASE_URL + WEEKLY_IMAGE_PATH + "?v=" + new Date().getTime();
}

/**
 * La imagen semanal se redibuja cada vez sobre la MISMA diapositiva (no se
 * crea una presentación nueva cada semana) — el id queda guardado en Script
 * Properties. Si la presentación fue borrada a mano, crea una nueva sola.
 */
function getOrCreateWeeklyDeck() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("WEEKLY_SLIDE_ID");
  if (id) {
    try {
      return SlidesApp.openById(id);
    } catch (err) {
      console.error("No se pudo abrir la presentación guardada (" + id + "), se crea una nueva: " + err);
    }
  }
  const deck = SlidesApp.create("Colación — imagen semanal (uso interno, no borrar)");
  props.setProperty("WEEKLY_SLIDE_ID", deck.getId());
  return deck;
}

function runWeeklyReminder(conf) {
  return buildWeeklyMessageAndSend(conf, nextMonday(new Date()));
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
 * Avisa por correo cuando algo falla en un proceso automático — sin esto,
 * un token vencido o el webhook de HA caído fallan en silencio y nadie se
 * entera hasta que un apoderado reclama que no le llegó el recordatorio.
 * Usa la Script Property ALERT_EMAIL si existe; si no, el correo del dueño
 * del script.
 */
function notifyOwnerOfError(context, err) {
  try {
    const email = PropertiesService.getScriptProperties().getProperty("ALERT_EMAIL") || Session.getEffectiveUser().getEmail();
    if (!email) return;
    MailApp.sendEmail({
      to: email,
      subject: "⚠️ Colación — error en " + context,
      body: "Ocurrió un error en " + context + ":\n\n" +
        (err && err.stack ? err.stack : String(err)) +
        "\n\nRevisa Apps Script > Ejecuciones para más detalle."
    });
  } catch (mailErr) {
    console.error("No se pudo enviar el correo de aviso: " + mailErr);
  }
}

/**
 * Borra el flag de "ya enviado hoy" (Diario o Semanal) para que el próximo
 * chequeo automático de checkReminders() pueda volver a intentarlo hoy
 * mismo. No envía nada por sí sola — solo destraba el guard. Útil cuando
 * ya se envió con una hora y después se cambió la hora en Notificaciones.
 */
function resetSentFlag(tipo) {
  const today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  const key = (tipo === "Semanal" ? "sent_semanal_" : "sent_diario_") + today;
  PropertiesService.getScriptProperties().deleteProperty(key);
  return { ok: true, tipo: tipo };
}

/**
 * Trigger instalable (cada 15 min) que revisa si corresponde disparar
 * alguno de los dos recordatorios, según lo configurado en "Notificaciones".
 * Cada recordatorio se aísla en su propio try/catch: si uno falla, el otro
 * igual se intenta, y no se marca como enviado para reintentar en 15 min.
 *
 * La hora configurada se trata como "a partir de esta hora", no como una
 * igualdad exacta: el trigger de 15 min de Apps Script no corre justo en
 * :00/:15/:30/:45 (corre cada 15 min desde el momento en que se creó, ej.
 * :04:48, :19:48...), así que comparar con === casi nunca calzaba y el
 * recordatorio nunca salía. Comparar con >= dispara en el primer chequeo
 * de 15 min que ya pasó la hora configurada — como mucho, unos minutos
 * tarde — y el guard de "ya enviado hoy" evita que se repita.
 */
function checkReminders() {
  let notif;
  try {
    notif = readNotifConfig();
  } catch (err) {
    notifyOwnerOfError("checkReminders (leer Notificaciones)", err);
    return;
  }

  const now = new Date();
  const hhmm = Utilities.formatDate(now, TZ, "HH:mm");
  const today = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();

  const diario = notif["Diario"];
  if (!diario) {
    console.log("Diario: no existe esa fila en Notificaciones.");
  } else if (!diario.activo) {
    console.log("Diario: Activo=FALSE, no se revisa.");
  } else if (hhmm < diario.hora) {
    console.log("Diario: hora configurada " + diario.hora + ", hora actual " + hhmm + " (" + TZ + ") — todavía no llega.");
  } else {
    const key = "sent_diario_" + today;
    if (props.getProperty(key)) {
      console.log("Diario: hora " + diario.hora + " ya pasó (" + hhmm + ") pero ya se había enviado hoy.");
    } else {
      console.log("Diario: hora " + diario.hora + " ya pasó (" + hhmm + "), enviando…");
      try {
        const r = runDailyReminder(diario);
        console.log("Diario: resultado " + JSON.stringify(r));
        if (r && r.sent) props.setProperty(key, "1");
      } catch (err) {
        console.error("Diario: error al enviar — " + err);
        notifyOwnerOfError("recordatorio diario", err);
      }
    }
  }

  const semanal = notif["Semanal"];
  if (!semanal) {
    console.log("Semanal: no existe esa fila en Notificaciones.");
  } else if (!semanal.activo) {
    console.log("Semanal: Activo=FALSE, no se revisa.");
  } else if (hhmm < semanal.hora) {
    console.log("Semanal: hora configurada " + semanal.hora + ", hora actual " + hhmm + " (" + TZ + ") — todavía no llega.");
  } else if (DOW_ES[now.getDay()] !== semanal.diaSemana) {
    console.log("Semanal: ya pasó la hora pero hoy es " + DOW_ES[now.getDay()] + ", configurado para " + semanal.diaSemana + ".");
  } else {
    const key = "sent_semanal_" + today;
    if (props.getProperty(key)) {
      console.log("Semanal: ya pasó la hora y es el día configurado, pero ya se había enviado hoy.");
    } else {
      console.log("Semanal: ya pasó la hora y es el día configurado, enviando…");
      try {
        const r = runWeeklyReminder(semanal);
        console.log("Semanal: resultado " + JSON.stringify(r));
        if (r && r.sent) props.setProperty(key, "1");
      } catch (err) {
        console.error("Semanal: error al enviar — " + err);
        notifyOwnerOfError("recordatorio semanal", err);
      }
    }
  }
}

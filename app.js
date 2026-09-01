"use strict";

const DOW = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DOW_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const STORE_COURSE_KEY = "colacion:course";
const HORIZON_DAYS = 420;

const state = {
  courses: [],
  courseId: null,
  cfg: null,
  avisos: [],
  index: new Map(),
  closures: new Map(),
  events: new Map(),
  attachments: new Map(),
  anchor: null, // first day of the displayed month
  myKid: null
};

function kidStoreKey() {
  return `colacion:kid:${state.courseId}`;
}

/* ---------- dates (local, no UTC drift) ---------- */

function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function mondayOf(d) {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (c.getDay() + 6) % 7;
  return addDays(c, -shift);
}

function firstOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function longDate(d) {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- rotation ---------- */

function expandClosures(list) {
  const map = new Map();
  for (const c of list || []) {
    const entry = {
      type: c.type === "sinColacion" ? "sinColacion" : "sinClases",
      reason: c.reason || ""
    };
    if (c.date) {
      map.set(c.date, entry);
    } else if (c.from && c.to) {
      let d = parseDate(c.from);
      const end = parseDate(c.to);
      while (d <= end) {
        map.set(toISO(d), entry);
        d = addDays(d, 1);
      }
    }
  }
  return map;
}

function expandEvents(list) {
  const map = new Map();
  const push = (iso, ev) => {
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(ev);
  };
  for (const e of list || []) {
    if (e.date) {
      push(e.date, e);
    } else if (e.from && e.to) {
      let d = parseDate(e.from);
      const end = parseDate(e.to);
      while (d <= end) { push(toISO(d), e); d = addDays(d, 1); }
    }
  }
  return map;
}

function expandAttachments(list) {
  const map = new Map();
  for (const a of list || []) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date).push(a);
  }
  return map;
}

function involves(ev, kid) {
  if (!kid) return false;
  if (ev.audience === "todos" || !ev.audience) return true;
  return Array.isArray(ev.audience) && ev.audience.includes(kid);
}

function buildIndex(cfg, closures) {
  const map = new Map();

  if (cfg.kids && cfg.kids.length) {
    let cursor = parseDate(cfg.rotationStart);
    const last = addDays(cursor, HORIZON_DAYS);
    let turn = 0;

    while (cursor <= last) {
      const dow = cursor.getDay();
      const iso = toISO(cursor);
      const meal = cfg.weekdays[String(dow)];
      if (meal && !closures.has(iso)) {
        map.set(iso, { meal, kid: cfg.kids[turn % cfg.kids.length] });
        turn++;
      }
      cursor = addDays(cursor, 1);
    }
  }

  for (const h of cfg.history || []) {
    const meal = cfg.weekdays[String(parseDate(h.date).getDay())];
    if (meal) map.set(h.date, { meal, kid: h.kid });
  }

  for (const o of cfg.overrides || []) {
    const entry = map.get(o.date);
    if (entry) {
      entry.kid = o.kid;
      if (o.note) {
        entry.note = o.note;
        entry.swapped = true;
      }
    }
  }
  return map;
}

function nextTurnFor(kid, from) {
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = addDays(from, i);
    const entry = state.index.get(toISO(d));
    if (entry && entry.kid === kid) return { date: d, entry };
  }
  return null;
}

/* ---------- render ---------- */

function shortMeal(text) {
  return text.split(" (")[0].trim();
}

function buildLegendRow() {
  const row = document.createElement("tr");
  for (let i = 1; i <= 7; i++) {
    const th = document.createElement("th");
    const isWeekend = i >= 6;
    const nativeDow = i === 7 ? 0 : i;
    const meal = state.cfg.weekdays[String(nativeDow)];
    if (isWeekend) th.classList.add("legend-weekend");

    const dowSpan = document.createElement("span");
    dowSpan.className = "legend-dow";
    dowSpan.textContent = DOW_SHORT[i];
    th.append(dowSpan);

    if (meal) {
      const mealSpan = document.createElement("span");
      mealSpan.className = "legend-meal";
      mealSpan.append(document.createTextNode(shortMeal(meal)));

      if (meal.includes(" (")) {
        const info = document.createElement("span");
        info.className = "legend-info";
        info.tabIndex = 0;
        info.append(svgIcon(
          '<circle cx="12" cy="12" r="10"></circle>' +
          '<line x1="12" y1="16" x2="12" y2="12"></line>' +
          '<line x1="12" y1="8" x2="12.01" y2="8"></line>'
        ));
        const tooltip = document.createElement("span");
        tooltip.className = "event-tooltip";
        tooltip.textContent = meal.slice(meal.indexOf("("));
        info.append(tooltip);
        mealSpan.append(" ", info);
      }

      th.append(mealSpan);
    }

    row.append(th);
  }
  return row;
}

function renderLegend() {
  const row = document.getElementById("legend");
  row.innerHTML = "";
  row.append(...buildLegendRow().children);
}

function svgIcon(innerPaths) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "cell-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = innerPaths;
  return icon;
}

function dayCellContent(d, inMonth, opts = {}) {
  const td = document.createElement("td");
  if (!inMonth) {
    td.className = "empty";
    return td;
  }

  const iso = toISO(d);
  const todayISO = toISO(new Date());
  const dow = d.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const entry = state.index.get(iso);
  const closure = state.closures.get(iso);
  const dayEvents = state.events.get(iso) || [];
  const dayAttachments = state.attachments.get(iso) || [];

  td.className = "cell";
  if (isWeekend) td.classList.add("weekend");
  if (!opts.hideToday && iso === todayISO) td.classList.add("today");
  else if (iso < todayISO) td.classList.add("past");
  if (!entry) td.classList.add("off");
  if (closure && closure.type === "sinColacion") td.classList.add("nofood");
  if (closure && closure.type === "sinClases") td.classList.add("closed");
  if (!opts.hideMine && entry && state.myKid && entry.kid === state.myKid) td.classList.add("mine-day");
  if (dayEvents.length) td.classList.add("has-event");

  const num = document.createElement("span");
  num.className = "cell-num";
  num.textContent = d.getDate();
  td.append(num);

  if (entry) {
    const kid = document.createElement("span");
    kid.className = "cell-kid";
    kid.textContent = entry.kid;
    td.append(kid);
    if (entry.swapped) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = entry.note;
      td.append(tag);
    }
  } else if (closure) {
    const label = document.createElement("span");
    label.className = "cell-closure";
    label.textContent = closure.type === "sinColacion" ? "Sin colación" : closure.reason || "Sin clases";
    td.append(label);
  }

  const icons = [];

  if (dayEvents.length) {
    const marker = document.createElement("span");
    marker.className = "event-marker";
    marker.tabIndex = 0;
    marker.append(svgIcon(
      '<rect x="3" y="4" width="18" height="18" rx="2"></rect>' +
      '<line x1="16" y1="2" x2="16" y2="6"></line>' +
      '<line x1="8" y1="2" x2="8" y2="6"></line>' +
      '<line x1="3" y1="10" x2="21" y2="10"></line>'
    ));

    const tooltip = document.createElement("span");
    tooltip.className = "event-tooltip";
    dayEvents.forEach((ev, i) => {
      if (i > 0) tooltip.append(document.createElement("br"));
      const bits = ["Evento: " + ev.title];
      if (ev.time) bits.push(ev.time);
      tooltip.append(document.createTextNode(bits.join(" · ")));
    });
    marker.append(tooltip);
    icons.push(marker);
  }

  for (const att of dayAttachments) {
    const link = document.createElement("a");
    link.className = "attachment-marker";
    let fallbackName;
    if (att.file) {
      link.href = encodeURI(att.file);
      fallbackName = att.file.split("/").pop();
      link.download = fallbackName;
    } else if (att.link) {
      link.href = att.link;
      link.target = "_blank";
      link.rel = "noopener";
      fallbackName = att.link;
    } else {
      continue;
    }
    link.append(svgIcon(
      '<path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>'
    ));

    const tooltip = document.createElement("span");
    tooltip.className = "event-tooltip";
    tooltip.textContent = "Adjunto: " + (att.label || fallbackName);
    link.append(tooltip);
    icons.push(link);
  }

  if (icons.length) {
    const row = document.createElement("span");
    row.className = "cell-icons";
    row.append(...icons);
    td.append(row);
  }

  return td;
}

function fillMonthRows(container, anchor, opts = {}) {
  container.innerHTML = "";
  const start = firstOfMonth(anchor);
  const end = lastOfMonth(anchor);
  let cursor = mondayOf(start);
  while (cursor <= end) {
    const tr = document.createElement("tr");
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i);
      const inMonth = d.getMonth() === start.getMonth();
      tr.append(dayCellContent(d, inMonth, opts));
    }
    container.append(tr);
    cursor = addDays(cursor, 7);
  }
}

function renderMonth() {
  const body = document.getElementById("calBody");
  const start = firstOfMonth(state.anchor);
  document.getElementById("monthlabel").textContent =
    capitalize(`${MONTHS[start.getMonth()]} ${start.getFullYear()}`);

  fillMonthRows(body, state.anchor);

  const now = firstOfMonth(new Date());
  document.getElementById("today").disabled =
    start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
}

function renderUpcomingEvents() {
  const box = document.getElementById("monthEvents");
  const ul = document.getElementById("monthEventsList");
  ul.innerHTML = "";

  const todayISO = toISO(new Date());
  const items = [];
  for (const [iso, evs] of state.events) {
    if (iso < todayISO) continue;
    for (const ev of evs) items.push({ date: parseDate(iso), ev });
  }
  items.sort((a, b) =>
    toISO(a.date).localeCompare(toISO(b.date)) ||
    (a.ev.time || "").localeCompare(b.ev.time || ""));

  if (!items.length) { box.hidden = true; return; }

  for (const { date, ev } of items) {
    const li = document.createElement("li");
    li.className = "event";
    if (involves(ev, state.myKid)) li.classList.add("event-mine");
    const who = Array.isArray(ev.audience) ? "algunos apoderados" : "Todo el curso";
    const bits = [`${DOW[((date.getDay() + 6) % 7) + 1]} ${longDate(date)}`, ev.title];
    if (ev.time) bits.push(ev.time);
    bits.push(who);
    li.textContent = bits.join(" · ");
    if (ev.place || ev.note) {
      const extra = document.createElement("span");
      extra.className = "event-note";
      extra.textContent = ev.place || ev.note;
      li.append(document.createElement("br"), extra);
    }
    ul.append(li);
  }
  box.hidden = false;
}

function renderMine() {
  const box = document.getElementById("mine");
  if (!state.myKid) { box.hidden = true; return; }

  const today = new Date();
  const found = nextTurnFor(state.myKid, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  if (!found) { box.hidden = true; return; }

  const sameDay = toISO(found.date) === toISO(today);
  const dow = DOW[((found.date.getDay() + 6) % 7) + 1];
  document.getElementById("mineLead").textContent = sameDay
    ? `Hoy le toca a ${state.myKid}`
    : `${state.myKid} lleva la colación el ${dow} ${longDate(found.date)}`;
  document.getElementById("mineMeal").textContent = found.entry.meal;
  box.hidden = false;
}

function renderAvisos() {
  const ul = document.getElementById("avisos");
  ul.innerHTML = "";
  const items = [...state.avisos].sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) {
    ul.innerHTML = `<li class="aviso"><p>Por ahora no hay avisos.</p></li>`;
    return;
  }
  for (const a of items) {
    const li = document.createElement("li");
    li.className = "aviso";
    const d = parseDate(a.date);
    li.innerHTML =
      `<h3></h3><p></p><time datetime="${a.date}">${longDate(d)}</time>`;
    li.querySelector("h3").textContent = a.title;
    li.querySelector("p").textContent = a.body;
    ul.append(li);
  }
}

function renderRestrictions() {
  const ul = document.getElementById("restrictions");
  ul.innerHTML = "";
  const items = state.cfg.restrictions || [];
  if (!items.length) {
    ul.innerHTML = `<li class="aviso"><p>No hay restricciones alimenticias registradas.</p></li>`;
    return;
  }
  for (const r of items) {
    const li = document.createElement("li");
    li.className = "aviso";
    const p = document.createElement("p");
    p.textContent = r.kid ? `${r.restriction} — ${r.kid}` : r.restriction;
    li.append(p);
    ul.append(li);
  }
}

function renderPicker() {
  const sel = document.getElementById("kidSelect");
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Mi hijo/a…";
  sel.append(placeholder);

  const sorted = [...state.cfg.kids].sort((a, b) => a.localeCompare(b, "es"));
  for (const kid of sorted) {
    const opt = document.createElement("option");
    opt.value = kid;
    opt.textContent = kid;
    sel.append(opt);
  }
  sel.value = state.myKid || "";
}

function monthText() {
  const start = firstOfMonth(state.anchor);
  const end = lastOfMonth(state.anchor);
  const lines = [`Colación ${state.cfg.curso} — ${capitalize(MONTHS[start.getMonth()])} ${start.getFullYear()}`];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    const iso = toISO(d);
    const isWeekend = dow === 0 || dow === 6;
    const dayEvents = state.events.get(iso) || [];

    if (!isWeekend) {
      const e = state.index.get(iso);
      const c = state.closures.get(iso);
      let detail;
      if (e) detail = `${e.kid}`;
      else if (c && c.type === "sinColacion") detail = `sin colación (${c.reason})`;
      else if (c) detail = c.reason || "sin clases";
      else detail = "sin colación";
      lines.push(`${DOW_SHORT[((dow + 6) % 7) + 1]} ${d.getDate()}: ${detail}`);
    } else if (dayEvents.length) {
      lines.push(`${DOW_SHORT[((dow + 6) % 7) + 1]} ${d.getDate()}:`);
    }

    for (const ev of dayEvents) {
      lines.push(`   ${ev.title}${ev.time ? " " + ev.time : ""}`);
    }
  }
  return lines.join("\n");
}

/* ---------- compartir como imagen ---------- */

const HTML2CANVAS_URL = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
let html2canvasPromise = null;

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (!html2canvasPromise) {
    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HTML2CANVAS_URL;
      script.onload = () => resolve();
      script.onerror = () => { html2canvasPromise = null; reject(new Error("No se pudo cargar html2canvas")); };
      document.head.append(script);
    });
  }
  return html2canvasPromise;
}

function buildShareSnapshot(anchor) {
  const start = firstOfMonth(anchor);
  const wrap = document.createElement("div");
  wrap.style.cssText =
    `position:fixed; top:0; left:-10000px; background:var(--paper); ` +
    `padding:1.25rem; width:${document.querySelector(".wrap").clientWidth}px;`;

  const nav = document.createElement("nav");
  nav.className = "monthnav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "stepper";
  prevBtn.textContent = "‹";
  const label = document.createElement("p");
  label.className = "monthlabel";
  label.textContent = capitalize(`${MONTHS[start.getMonth()]} ${start.getFullYear()}`);
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "stepper";
  nextBtn.textContent = "›";
  nav.append(prevBtn, label, nextBtn);

  const table = document.createElement("table");
  table.className = "cal";
  const thead = document.createElement("thead");
  thead.append(buildLegendRow());
  const tbody = document.createElement("tbody");
  fillMonthRows(tbody, anchor, { hideToday: true, hideMine: true });
  table.append(thead, tbody);

  wrap.append(nav, table);
  document.body.append(wrap);
  return wrap;
}

function shareFileName(anchor) {
  const start = firstOfMonth(anchor);
  return `colacion-${state.cfg.curso}-${MONTHS[start.getMonth()]}-${start.getFullYear()}`
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") + ".png";
}

async function shareMonthImage() {
  const btn = document.getElementById("shareImage");
  const label = btn.querySelector(".btn-label");
  const originalLabel = label.textContent;
  btn.disabled = true;
  label.textContent = "Generando…";

  let snapshot;
  try {
    await loadHtml2Canvas();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    snapshot = buildShareSnapshot(state.anchor);
    const canvas = await window.html2canvas(snapshot, { backgroundColor: "#F3F6F1", scale: 2 });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const filename = shareFileName(state.anchor);
    const file = new File([blob], filename, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      alert("Imagen descargada. Compártela desde tus archivos o galería.");
    }
  } catch (e) {
    if (e && e.name !== "AbortError") {
      console.error(e);
      alert("No se pudo generar la imagen. Intenta de nuevo.");
    }
  } finally {
    if (snapshot) snapshot.remove();
    label.textContent = originalLabel;
    btn.disabled = false;
  }
}

/* ---------- boot ---------- */

async function switchCourse(id) {
  const course = state.courses.find((c) => c.id === id);
  state.courseId = id;
  try { localStorage.setItem(STORE_COURSE_KEY, id); } catch (e) { /* modo privado */ }

  const [cfg, avisos] = await Promise.all([
    fetch(course.schedule, { cache: "no-store" }).then((r) => r.json()),
    fetch(course.announcements, { cache: "no-store" }).then((r) => r.json())
  ]);

  state.cfg = cfg;
  state.avisos = avisos;
  state.closures = expandClosures(cfg.closures);
  state.events = expandEvents(cfg.events);
  state.attachments = expandAttachments(cfg.attachments);
  state.index = buildIndex(cfg, state.closures);
  try { state.myKid = localStorage.getItem(kidStoreKey()); } catch (e) { state.myKid = null; }

  renderLegend();
  renderPicker();
  renderMine();
  renderAvisos();
  renderRestrictions();
  renderMonth();
  renderUpcomingEvents();
}

async function boot() {
  try {
    state.courses = await fetch("data/courses.json", { cache: "no-store" }).then((r) => r.json());

    const courseSelect = document.getElementById("courseSelect");
    courseSelect.innerHTML = "";
    for (const c of state.courses) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      courseSelect.append(opt);
    }

    const params = new URLSearchParams(location.search);
    const classParam = params.get("class");
    const classCourse = classParam
      ? state.courses.find((c) => (c.alias || "").toLowerCase() === classParam.toLowerCase())
      : null;

    let initialId = classCourse ? classCourse.id : null;
    if (!initialId) {
      try { initialId = localStorage.getItem(STORE_COURSE_KEY); } catch (e) { initialId = null; }
    }
    if (!state.courses.some((c) => c.id === initialId)) {
      initialId = state.courses[0].id;
    }
    courseSelect.value = initialId;

    document.getElementById("hoy").textContent = `Hoy es ${longDate(new Date())}`;
    state.anchor = firstOfMonth(new Date());

    courseSelect.addEventListener("change", () => {
      switchCourse(courseSelect.value);
    });

    document.getElementById("kidSelect").addEventListener("change", (e) => {
      state.myKid = e.target.value || null;
      try {
        if (state.myKid) localStorage.setItem(kidStoreKey(), state.myKid);
        else localStorage.removeItem(kidStoreKey());
      } catch (err) { /* modo privado */ }
      renderMine();
      renderMonth();
      renderUpcomingEvents();
    });

    document.getElementById("prev").addEventListener("click", () => {
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1);
      renderMonth();
    });
    document.getElementById("next").addEventListener("click", () => {
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1);
      renderMonth();
    });
    document.getElementById("today").addEventListener("click", () => {
      state.anchor = firstOfMonth(new Date());
      renderMonth();
    });
    document.getElementById("shareImage").addEventListener("click", shareMonthImage);
    document.getElementById("share").addEventListener("click", async () => {
      const text = monthText();
      if (navigator.share) {
        try { await navigator.share({ text }); } catch (e) { /* cancelado */ }
      } else {
        await navigator.clipboard.writeText(text);
        alert("Mes copiado. Pégalo en el grupo.");
      }
    });

    await switchCourse(initialId);

    const kidParam = classCourse ? params.get("kid") : null;
    if (kidParam) {
      const foundKid = state.cfg.kids.find((k) => k.toLowerCase() === kidParam.toLowerCase());
      if (foundKid) {
        state.myKid = foundKid;
        try { localStorage.setItem(kidStoreKey(), foundKid); } catch (e) { /* modo privado */ }
        document.getElementById("kidSelect").value = foundKid;
        renderMine();
        renderMonth();
        renderUpcomingEvents();
      }
    }
  } catch (err) {
    const box = document.getElementById("err");
    box.hidden = false;
    box.textContent = location.protocol === "file:"
      ? "Abre el sitio con un servidor local (python3 -m http.server 8000), no con doble clic en el archivo."
      : "No se pudo leer los datos del curso. Revisa que los archivos existan y sean JSON válido.";
    console.error(err);
  }
}

boot();

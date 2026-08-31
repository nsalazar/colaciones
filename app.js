"use strict";

const DOW = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const DOW_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const STORE_KEY = "colacion:kid";
const HORIZON_DAYS = 420;

const state = {
  cfg: null,
  avisos: [],
  index: new Map(),
  closures: new Map(),
  events: new Map(),
  anchor: null, // first day of the displayed month
  myKid: null
};

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

function involves(ev, kid) {
  if (!kid) return false;
  if (ev.audience === "todos" || !ev.audience) return true;
  return Array.isArray(ev.audience) && ev.audience.includes(kid);
}

function buildIndex(cfg, closures) {
  const map = new Map();
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

  for (const o of cfg.overrides || []) {
    const entry = map.get(o.date);
    if (entry) {
      entry.kid = o.kid;
      entry.note = o.note || "cambio";
      entry.swapped = true;
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

function renderLegend() {
  const row = document.getElementById("legend");
  row.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const th = document.createElement("th");
    const meal = state.cfg.weekdays[String(i)] || "";
    th.innerHTML = `<span class="legend-dow"></span><span class="legend-meal"></span>`;
    th.querySelector(".legend-dow").textContent = DOW_SHORT[i];
    th.querySelector(".legend-meal").textContent = meal;
    row.append(th);
  }
}

function dayCellContent(d, inMonth) {
  const td = document.createElement("td");
  if (!inMonth) {
    td.className = "empty";
    return td;
  }

  const iso = toISO(d);
  const todayISO = toISO(new Date());
  const entry = state.index.get(iso);
  const closure = state.closures.get(iso);
  const dayEvents = state.events.get(iso) || [];

  td.className = "cell";
  if (iso === todayISO) td.classList.add("today");
  if (!entry) td.classList.add("off");
  if (closure && closure.type === "sinColacion") td.classList.add("nofood");
  if (closure && closure.type === "sinClases") td.classList.add("closed");
  if (entry && state.myKid && entry.kid === state.myKid) td.classList.add("mine-day");
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

  if (dayEvents.length) {
    const dot = document.createElement("span");
    dot.className = "cell-dot";
    dot.setAttribute("aria-hidden", "true");
    td.append(dot);
  }

  return td;
}

function renderMonth() {
  const body = document.getElementById("calBody");
  body.innerHTML = "";

  const start = firstOfMonth(state.anchor);
  const end = lastOfMonth(state.anchor);
  document.getElementById("monthlabel").textContent =
    capitalize(`${MONTHS[start.getMonth()]} ${start.getFullYear()}`);

  let cursor = mondayOf(start);
  while (cursor <= end) {
    const tr = document.createElement("tr");
    for (let i = 0; i < 5; i++) {
      const d = addDays(cursor, i);
      const inMonth = d.getMonth() === start.getMonth();
      tr.append(dayCellContent(d, inMonth));
    }
    body.append(tr);
    cursor = addDays(cursor, 7);
  }

  renderMonthEvents(start, end);
}

function renderMonthEvents(start, end) {
  const box = document.getElementById("monthEvents");
  const ul = document.getElementById("monthEventsList");
  ul.innerHTML = "";

  const items = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const iso = toISO(d);
    for (const ev of state.events.get(iso) || []) {
      items.push({ date: new Date(d), ev });
    }
  }

  if (!items.length) { box.hidden = true; return; }

  for (const { date, ev } of items) {
    const li = document.createElement("li");
    li.className = "event";
    if (involves(ev, state.myKid)) li.classList.add("event-mine");
    const who = Array.isArray(ev.audience) ? "algunos apoderados" : "todo el curso";
    const bits = [`${DOW[((date.getDay() + 6) % 7) + 1]} ${date.getDate()}`, ev.title];
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

function renderPicker() {
  const sel = document.getElementById("kidSelect");
  for (const kid of state.cfg.kids) {
    const opt = document.createElement("option");
    opt.value = kid;
    opt.textContent = kid;
    sel.append(opt);
  }
  if (state.myKid) sel.value = state.myKid;
  sel.addEventListener("change", () => {
    state.myKid = sel.value || null;
    try {
      if (state.myKid) localStorage.setItem(STORE_KEY, state.myKid);
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* modo privado */ }
    renderMine();
    renderMonth();
  });
}

function monthText() {
  const start = firstOfMonth(state.anchor);
  const end = lastOfMonth(state.anchor);
  const lines = [`Colación ${state.cfg.curso} — ${capitalize(MONTHS[start.getMonth()])} ${start.getFullYear()}`];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = toISO(d);
    const e = state.index.get(iso);
    const c = state.closures.get(iso);
    let detail;
    if (e) detail = `${e.kid}`;
    else if (c && c.type === "sinColacion") detail = `sin colación (${c.reason})`;
    else if (c) detail = c.reason || "sin clases";
    else detail = "sin colación";
    lines.push(`${DOW_SHORT[((dow + 6) % 7) + 1]} ${d.getDate()}: ${detail}`);
    for (const ev of state.events.get(iso) || []) {
      lines.push(`   ${ev.title}${ev.time ? " " + ev.time : ""}`);
    }
  }
  return lines.join("\n");
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const [cfg, avisos] = await Promise.all([
      fetch("data/schedule.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("data/announcements.json", { cache: "no-store" }).then((r) => r.json())
    ]);

    state.cfg = cfg;
    state.avisos = avisos;
    state.closures = expandClosures(cfg.closures);
    state.events = expandEvents(cfg.events);
    state.index = buildIndex(cfg, state.closures);
    state.anchor = firstOfMonth(new Date());
    try { state.myKid = localStorage.getItem(STORE_KEY); } catch (e) { state.myKid = null; }

    document.getElementById("curso").textContent = cfg.curso;
    const now = new Date();
    document.getElementById("hoy").textContent =
      `Hoy es ${longDate(now)}`;

    renderLegend();
    renderPicker();
    renderMine();
    renderAvisos();
    renderMonth();

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
    document.getElementById("share").addEventListener("click", async () => {
      const text = monthText();
      if (navigator.share) {
        try { await navigator.share({ text }); } catch (e) { /* cancelado */ }
      } else {
        await navigator.clipboard.writeText(text);
        alert("Mes copiado. Pégalo en el grupo.");
      }
    });
  } catch (err) {
    const box = document.getElementById("err");
    box.hidden = false;
    box.textContent = location.protocol === "file:"
      ? "Abre el sitio con un servidor local (python3 -m http.server 8000), no con doble clic en el archivo."
      : "No se pudo leer data/schedule.json. Revisa que el archivo exista y sea JSON válido.";
    console.error(err);
  }
}

boot();

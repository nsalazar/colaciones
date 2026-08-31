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
  anchor: null,
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

function longDate(d) {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
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

function renderWeek() {
  const list = document.getElementById("days");
  const todayISO = toISO(new Date());
  list.innerHTML = "";

  const monday = state.anchor;
  const friday = addDays(monday, 4);
  document.getElementById("weeklabel").textContent =
    `${monday.getDate()} al ${friday.getDate()} de ${MONTHS[friday.getMonth()]}`;

  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const iso = toISO(d);
    const entry = state.index.get(iso);

    const closure = state.closures.get(iso);

    const li = document.createElement("li");
    li.className = "day";
    if (iso === todayISO) li.classList.add("today");
    if (!entry) li.classList.add("off");
    if (closure && closure.type === "sinColacion") li.classList.add("nofood");
    if (entry && state.myKid && entry.kid === state.myKid) li.classList.add("mine-day");

    const when = document.createElement("div");
    when.className = "day-when";
    when.innerHTML =
      `<span class="day-dow">${DOW_SHORT[i + 1]}</span>` +
      `<span class="day-num">${d.getDate()}</span>`;

    const body = document.createElement("div");
    if (entry) {
      const meal = document.createElement("p");
      meal.className = "day-meal";
      meal.textContent = entry.meal;
      if (entry.swapped) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = entry.note;
        meal.appendChild(tag);
      }
      const kid = document.createElement("p");
      kid.className = "day-kid";
      kid.textContent = entry.kid;
      body.append(meal, kid);
    } else {
      const off = document.createElement("p");
      off.className = "day-meal";
      if (closure && closure.type === "sinColacion") {
        off.textContent = "No enviar colación";
      } else if (closure) {
        off.textContent = "Sin clases";
      } else {
        off.textContent = "Sin colación";
      }
      body.append(off);

      if (closure && closure.reason) {
        const why = document.createElement("p");
        why.className = "day-kid";
        why.textContent = closure.reason;
        body.append(why);
      }
    }

    li.append(when, body);

    for (const ev of state.events.get(iso) || []) {
      const box = document.createElement("p");
      box.className = "event";
      if (involves(ev, state.myKid)) box.classList.add("event-mine");
      const who = Array.isArray(ev.audience) ? "algunos apoderados" : "todo el curso";
      const bits = [ev.title];
      if (ev.time) bits.push(ev.time);
      bits.push(who);
      box.textContent = bits.join(" · ");
      if (ev.place || ev.note) {
        const extra = document.createElement("span");
        extra.className = "event-note";
        extra.textContent = ev.place || ev.note;
        box.append(document.createElement("br"), extra);
      }
      body.append(box);
    }

    list.append(li);
  }
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
    renderWeek();
  });
}

function weekText() {
  const monday = state.anchor;
  const lines = [`Colación ${state.cfg.curso} — semana del ${longDate(monday)}`];
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const iso = toISO(d);
    const e = state.index.get(iso);
    const c = state.closures.get(iso);
    let detail;
    if (e) detail = `${e.meal} — ${e.kid}`;
    else if (c && c.type === "sinColacion") detail = `no enviar colación (${c.reason})`;
    else if (c) detail = `sin clases (${c.reason})`;
    else detail = "sin colación";
    lines.push(`${DOW[i + 1]} ${d.getDate()}: ${detail}`);
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
    state.anchor = mondayOf(new Date());
    try { state.myKid = localStorage.getItem(STORE_KEY); } catch (e) { state.myKid = null; }

    document.getElementById("curso").textContent = `Colación ${cfg.curso}`;
    const now = new Date();
    document.getElementById("hoy").textContent =
      `Hoy es ${longDate(now)}`;

    renderPicker();
    renderMine();
    renderAvisos();
    renderWeek();

    document.getElementById("prev").addEventListener("click", () => {
      state.anchor = addDays(state.anchor, -7); renderWeek();
    });
    document.getElementById("next").addEventListener("click", () => {
      state.anchor = addDays(state.anchor, 7); renderWeek();
    });
    document.getElementById("today").addEventListener("click", () => {
      state.anchor = mondayOf(new Date()); renderWeek();
    });
    document.getElementById("share").addEventListener("click", async () => {
      const text = weekText();
      if (navigator.share) {
        try { await navigator.share({ text }); } catch (e) { /* cancelado */ }
      } else {
        await navigator.clipboard.writeText(text);
        alert("Semana copiada. Pégala en el grupo.");
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

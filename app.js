// Darija voice listening test: blind MOS, one clip at a time, ratings sent to a Google Apps Script web app.
"use strict";

const CONFIG = window.SAWTI_MOS || { endpoint: "", version: "v1" };
const STORE = `sawti-mos-${CONFIG.version}`;
const LANG_STORE = "sawti-mos-lang";

const $ = (id) => document.getElementById(id);
const audio = new Audio();
audio.preload = "auto";
let clips = [];
let state = null;
let current = { plays: 0, firstPlay: null, heardToEnd: false };
let lang = "ary";

// ---------- storage (survives a reload, so a listener can resume) ----------
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: works, just no resume */ }
}
const save = () => store(STORE, state);

// ---------- language ----------
function t(key, vars = {}) {
  const text = STRINGS[lang][key] ?? STRINGS.en[key];
  return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (_, v) => vars[v]) : text;
}

function fillSelect(select, items) {
  const value = select.value;
  select.innerHTML = `<option value="">${t("choose")}</option>` + items
    .map(([saved, ar, fr]) => {
      const label = lang === "ary" ? ar || saved : lang === "fr" ? fr || saved : saved;
      return `<option value="${saved}">${label}</option>`;
    })
    .join("");
  select.value = value;
}

function buildScale(container) {
  const name = container.dataset.name;
  const checked = choice(name);
  container.innerHTML = t(container.dataset.words)
    .map((w, i) => `<label><input type="radio" name="${name}" value="${i + 1}"${checked === i + 1 ? " checked" : ""}><span class="num">${i + 1}</span><span class="word">${w}</span></label>`)
    .join("");
}

function setLanguage(code) {
  lang = STRINGS[code] ? code : "ary";
  store(LANG_STORE, lang);
  document.documentElement.lang = LANGS[lang].html;
  document.documentElement.dir = LANGS[lang].dir;
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  $("lead").innerHTML = t("lead", { n: `<strong>${clips.length || 32}</strong>` });
  fillSelect(document.querySelector('select[name="region"]'), REGIONS);
  fillSelect(document.querySelector('select[name="age_range"]'), AGES);
  for (const scale of document.querySelectorAll(".options")) buildScale(scale);
  for (const b of $("lang").children) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  if (state) refreshRateTexts();
}

function buildSwitcher() {
  $("lang").innerHTML = Object.entries(LANGS)
    .map(([code, l]) => `<button type="button" data-lang="${code}" lang="${l.html}">${l.name}</button>`)
    .join("");
  $("lang").addEventListener("click", (e) => {
    const code = e.target.closest("button")?.dataset.lang;
    if (code) setLanguage(code);
  });
}

// ---------- order: random per listener, never the same sentence twice in a row ----------
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function listenOrder(manifest) {
  for (let tries = 0; tries < 5000; tries++) {
    const order = shuffled(manifest);
    if (order.every((c, i) => i === 0 || c.group !== order[i - 1].group)) return order.map((c) => c.id);
  }
  return shuffled(manifest).map((c) => c.id); // practically unreachable with 8 groups of 4
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---------- sending ----------
async function send(row) {
  if (!CONFIG.endpoint) { console.info("test mode, not saved:", row); return true; }
  try {
    // text/plain keeps it a "simple" request: no CORS preflight, which Apps Script cannot answer
    const res = await fetch(CONFIG.endpoint, { method: "POST", body: JSON.stringify(row) });
    const reply = await res.json();
    return reply.ok === true;
  } catch {
    return false;
  }
}
let flushing = false;
let sendFailed = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  sendFailed = false;
  while (state.queue.length) {
    if (!(await send(state.queue[0]))) { sendFailed = true; break; }
    state.queue.shift();
    save();
  }
  flushing = false;
  showSaveState();
}
function showSaveState() {
  const el = $("save-state");
  const pending = state.queue.length;
  const failed = pending && sendFailed;
  // a queued answer is normal while it is being sent; only a failed send is worth a warning
  el.textContent = failed ? t("notSent", { n: pending }) : pending ? t("saving") : t("saved");
  el.className = `save-state ${failed ? "bad" : "ok"}`;
  $("done-state").textContent = failed ? t("failed", { n: pending }) : pending ? t("stillSaving") : t("allSaved");
  $("retry").hidden = !failed;
}
function row(event, extra = {}) {
  return {
    session_id: state.session,
    event,
    ...state.profile,
    client_time: new Date().toISOString(),
    version: CONFIG.version,
    ...extra,
  };
}

// ---------- screens ----------
function show(name) {
  for (const s of ["welcome", "rate", "done"]) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo({ top: 0 });
}

function refreshRateTexts() {
  $("progress-label").textContent = t("progress", { i: Math.min(state.index + 1, state.order.length), n: state.order.length });
  $("play-hint").textContent = current.heardToEnd ? t("hintRate") : t("hintPlay");
  $("play").setAttribute("aria-label", audio.paused ? t("play") : t("pause"));
  showSaveState();
}

function showClip() {
  const n = state.order.length;
  $("progress-bar").style.width = `${(state.index / n) * 100}%`;
  current = { plays: 0, firstPlay: null, heardToEnd: false };
  audio.src = `clips/${state.order[state.index]}.wav`;
  $("track-bar").style.width = "0";
  for (const input of document.querySelectorAll(".scale input")) input.checked = false;
  $("q-natural").disabled = true;
  $("q-clear").disabled = true;
  $("next").disabled = true;
  setPlaying(false);
  refreshRateTexts();
}

function setPlaying(on) {
  $("icon-play").hidden = on;
  $("icon-pause").hidden = !on;
  $("play").setAttribute("aria-label", on ? t("pause") : t("play"));
}

function choice(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? Number(checked.value) : null;
}

function next() {
  const naturalness = choice("naturalness");
  const intelligibility = choice("intelligibility");
  if (!current.heardToEnd || !naturalness || !intelligibility) return;
  audio.pause();
  state.queue.push(row("rating", {
    clip: state.order[state.index],
    position: state.index + 1,
    naturalness,
    intelligibility,
    plays: current.plays,
    seconds: Math.round((Date.now() - current.firstPlay) / 100) / 10,
  }));
  state.index += 1;
  if (state.index >= state.order.length) {
    state.queue.push(row("finish", { position: state.index }));
    state.finished = true;
    save();
    show("done");
  } else {
    save();
    showClip();
  }
  flush();
}

// ---------- events ----------
$("profile").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { $("profile-error").hidden = false; return; }
  const data = new FormData(form);
  state = {
    session: newId(),
    profile: {
      native: data.get("native"),
      headphones: data.get("headphones"),
      region: data.get("region"),
      age_range: data.get("age_range"),
    },
    order: listenOrder(clips),
    index: 0,
    queue: [],
    finished: false,
  };
  state.queue.push(row("start", { position: 0 }));
  save();
  show("rate");
  showClip();
  flush();
});

$("play").addEventListener("click", () => {
  if (!audio.paused) { audio.pause(); return; }
  if (audio.ended || audio.currentTime === 0) {
    audio.currentTime = 0;
    current.plays += 1;
    current.firstPlay ??= Date.now();
  }
  audio.play();
});
audio.addEventListener("play", () => setPlaying(true));
audio.addEventListener("pause", () => setPlaying(false));
audio.addEventListener("timeupdate", () => {
  if (audio.duration) $("track-bar").style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});
audio.addEventListener("ended", () => {
  setPlaying(false);
  current.heardToEnd = true;
  $("q-natural").disabled = false;
  $("q-clear").disabled = false;
  $("play-hint").textContent = t("hintRate");
});
document.addEventListener("change", (e) => {
  if (e.target.closest(".scale")) $("next").disabled = !(choice("naturalness") && choice("intelligibility"));
});
$("next").addEventListener("click", next);
$("retry").addEventListener("click", flush);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !$("screen-rate").hidden && !["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)) {
    e.preventDefault();
    $("play").click();
  }
});

// ---------- start ----------
(async function init() {
  $("test-banner").hidden = Boolean(CONFIG.endpoint);
  buildSwitcher();
  setLanguage(load(LANG_STORE) || "ary");
  clips = await (await fetch("clips.json")).json();
  state = load(STORE);
  setLanguage(lang); // again, now that the clip count and any saved session are known
  if (state && state.finished) { show("done"); flush(); return; }
  if (state) { show("rate"); showClip(); flush(); return; }
  show("welcome");
})();

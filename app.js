// Darija voice listening test: blind MOS, one clip at a time, ratings sent to a Google Apps Script web app.
"use strict";

const CONFIG = window.SAWTI_MOS || { endpoint: "", version: "v1" };
const STORE = `sawti-mos-${CONFIG.version}`;
const NATURAL = ["Bad", "Poor", "Fair", "Good", "Excellent"];
const CLEAR = ["Very hard", "Hard", "OK", "Easy", "Very easy"];

const $ = (id) => document.getElementById(id);
const audio = new Audio();
audio.preload = "auto";
let clips = [];
let state = null;
let current = { plays: 0, firstPlay: null, heardToEnd: false };

// ---------- storage (survives a reload, so a listener can resume) ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode: still works, no resume */ }
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
  el.textContent = failed ? `${pending} answer${pending > 1 ? "s" : ""} not sent yet` : pending ? "Saving…" : "Saved";
  el.className = `save-state ${failed ? "bad" : "ok"}`;
  if (!$("screen-done").hidden) {
    $("done-state").textContent = failed
      ? `${pending} answer${pending > 1 ? "s were" : " was"} not sent yet. Check your connection and press the button.`
      : pending ? "Saving your answers…" : "All your ratings are saved. You can close this page.";
    $("retry").hidden = !failed;
  }
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

function buildScale(container, words) {
  const name = container.dataset.name;
  container.innerHTML = words
    .map((w, i) => `<label><input type="radio" name="${name}" value="${i + 1}"><span class="num">${i + 1}</span><span class="word">${w}</span></label>`)
    .join("");
}

function showClip() {
  const n = state.order.length;
  const id = state.order[state.index];
  $("progress-label").textContent = `Clip ${state.index + 1} of ${n}`;
  $("progress-bar").style.width = `${(state.index / n) * 100}%`;
  current = { plays: 0, firstPlay: null, heardToEnd: false };
  audio.src = `clips/${id}.wav`;
  $("track-bar").style.width = "0";
  $("play-hint").textContent = "Press play and listen to the end.";
  for (const input of document.querySelectorAll(".scale input")) input.checked = false;
  $("q-natural").disabled = true;
  $("q-clear").disabled = true;
  $("next").disabled = true;
  setPlaying(false);
  showSaveState();
}

function setPlaying(on) {
  $("icon-play").hidden = on;
  $("icon-pause").hidden = !on;
  $("play").setAttribute("aria-label", on ? "Pause clip" : "Play clip");
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
  $("play-hint").textContent = "Now rate it below. You can play it again.";
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
  buildScale(document.querySelector('[data-name="naturalness"]'), NATURAL);
  buildScale(document.querySelector('[data-name="intelligibility"]'), CLEAR);
  clips = await (await fetch("clips.json")).json();
  $("clip-count").textContent = clips.length;
  state = load();
  if (state && state.finished) { show("done"); showSaveState(); flush(); return; }
  if (state) { show("rate"); showClip(); flush(); return; }
  show("welcome");
})();

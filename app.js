"use strict";

/* =========================================================
   Guitar Library — 自分専用コード譜/TAB譜アプリ
   ローカル完結(IndexedDB) / PWA / iPhone最優先
   ========================================================= */

/* ---------------- アプリバージョン ----------------
   GitHubを更新したのに古いページが表示される場合、
   ホーム画面下部のバージョン表示を見れば
   「今読み込まれているのがどのビルドか」がすぐ分かる。
   デプロイのたびにここの数字を必ず上げること。
   (あわせて sw.js の CACHE_NAME も上げないと
    Service Workerのキャッシュが更新されず古いままになる) */
const APP_VERSION = "1.1.0";
const APP_BUILD_DATE = "2026-09-05";

/* ---------------- IndexedDB layer ---------------- */
const DB_NAME = "guitarLibraryDB";
const DB_VERSION = 1;
const STORE = "songs";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("lastPlayedAt", "lastPlayedAt");
        store.createIndex("playCount", "playCount");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = openDB();

async function dbTx(storeMode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, storeMode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readonly");
  return reqToPromise(tx.objectStore(STORE).getAll());
}

async function dbGet(id) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readonly");
  return reqToPromise(tx.objectStore(STORE).get(id));
}

async function dbAdd(song) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readwrite");
  const id = await reqToPromise(tx.objectStore(STORE).add(song));
  return id;
}

async function dbPut(song) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).put(song));
}

async function dbDelete(id) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).delete(id));
}

/* ---------------- Chord chart rendering + tap-to-diagram ---------------- */

const CHORD_SHAPES = {
  // frets: 6th(low E) -> 1st(high e). -1 = mute, 0 = open.
  "C":       { frets: [-1,3,2,0,1,0], base: 1 },
  "G":       { frets: [3,2,0,0,0,3],  base: 1 },
  "D":       { frets: [-1,-1,0,2,3,2],base: 1 },
  "A":       { frets: [-1,0,2,2,2,0], base: 1 },
  "E":       { frets: [0,2,2,1,0,0],  base: 1 },
  "Am":      { frets: [-1,0,2,2,1,0], base: 1 },
  "Em":      { frets: [0,2,2,0,0,0],  base: 1 },
  "Dm":      { frets: [-1,-1,0,2,3,1],base: 1 },
  "F":       { frets: [1,3,3,2,1,1],  base: 1, barre: 1 },
  "B7":      { frets: [-1,2,1,2,0,2], base: 1 },
  "E7":      { frets: [0,2,0,1,0,0],  base: 1 },
  "A7":      { frets: [-1,0,2,0,2,0], base: 1 },
  "D7":      { frets: [-1,-1,0,2,1,2],base: 1 },
  "G7":      { frets: [3,2,0,0,0,1],  base: 1 },
  "C7":      { frets: [-1,3,2,3,1,0], base: 1 },
  "Cadd9":   { frets: [-1,3,2,0,3,0], base: 1 },
  "Csus4":   { frets: [-1,3,3,0,1,1], base: 1 },
  "Dsus4":   { frets: [-1,-1,0,2,3,3],base: 1 },
  "Dsus2":   { frets: [-1,-1,0,2,3,0],base: 1 },
  "Asus2":   { frets: [-1,0,2,2,0,0], base: 1 },
  "Asus4":   { frets: [-1,0,2,2,3,0], base: 1 },
  "Fmaj7":   { frets: [-1,-1,3,2,1,0],base: 1 },
  "Cmaj7":   { frets: [-1,3,2,0,0,0], base: 1 },
  "Am7":     { frets: [-1,0,2,0,1,0], base: 1 },
  "Em7":     { frets: [0,2,0,0,0,0],  base: 1 },
  "Dm7":     { frets: [-1,-1,0,2,1,1],base: 1 },
  "Gadd9":   { frets: [3,2,0,2,0,3],  base: 1 },
  "B":       { frets: [-1,2,4,4,4,2], base: 1, barre: 2 },
  "Bm":      { frets: [-1,2,4,4,3,2], base: 1, barre: 2 },
  "F#m":     { frets: [2,4,4,2,2,2],  base: 1, barre: 2 },
  "Bb":      { frets: [-1,1,3,3,3,1], base: 1, barre: 1 },
};

// Ordered longest-quality-first so "maj7" isn't swallowed by "m".
const CHORD_QUALITIES = [
  "maj7","maj9","mmaj7","m7b5","m7-5","m9","m7","m6","m11","madd9",
  "sus4","sus2","add9","add11","dim7","aug7","dim","aug",
  "7sus4","9sus4","7-5","7+5","6/9","m",
  "13","11","9","7","6","5",
];
const CHORD_RE = new RegExp(
  "(?<![A-Za-z0-9#])([A-G])(#|b)?(" + CHORD_QUALITIES.join("|") + ")?(/[A-G](#|b)?)?(?![A-Za-z0-9])",
  "g"
);

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linkifyChords(escapedText) {
  return escapedText.replace(CHORD_RE, (match) => {
    const clean = match.trim();
    if (!clean) return match;
    return `<span class="chord-tok" data-chord="${clean}">${match}</span>`;
  });
}

function renderChordChart(rawText) {
  if (!rawText || !rawText.trim()) return "";
  const bracketRe = /\[[^\]]*\]/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = bracketRe.exec(rawText))) {
    result += linkifyChords(escapeHtml(rawText.slice(lastIndex, m.index)));
    result += `<span class="section-tag">${escapeHtml(m[0])}</span>`;
    lastIndex = bracketRe.lastIndex;
  }
  result += linkifyChords(escapeHtml(rawText.slice(lastIndex)));
  return result;
}

function findChordShape(name) {
  if (CHORD_SHAPES[name]) return CHORD_SHAPES[name];
  // try flat->sharp normalization roughly, or strip slash bass
  const noBass = name.split("/")[0];
  if (CHORD_SHAPES[noBass]) return CHORD_SHAPES[noBass];
  return null;
}

function buildChordDiagramSVG(shape) {
  const W = 180, H = 210;
  const left = 30, right = W - 20, top = 30, bottom = H - 30;
  const stringGap = (right - left) / 5;
  const numFrets = 4;
  const fretGap = (bottom - top) / numFrets;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  // strings
  for (let s = 0; s < 6; s++) {
    const x = left + s * stringGap;
    svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#a89680" stroke-width="1.5"/>`;
  }
  // frets
  for (let f = 0; f <= numFrets; f++) {
    const y = top + f * fretGap;
    const w = f === 0 && shape.base === 1 ? 3.5 : 1.5;
    svg += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#a89680" stroke-width="${w}"/>`;
  }
  if (shape.base > 1) {
    svg += `<text x="${right + 6}" y="${top + fretGap * 0.8}" font-size="13" fill="#a89680">${shape.base}fr</text>`;
  }
  // dots + open/mute markers
  shape.frets.forEach((fret, i) => {
    const x = left + i * stringGap;
    if (fret === -1) {
      svg += `<text x="${x}" y="${top - 12}" font-size="15" fill="#c1614c" text-anchor="middle">&#10005;</text>`;
    } else if (fret === 0) {
      svg += `<circle cx="${x}" cy="${top - 14}" r="6" fill="none" stroke="#f2e9de" stroke-width="1.5"/>`;
    } else {
      const relFret = shape.base > 1 ? fret - shape.base + 1 : fret;
      const y = top + (relFret - 0.5) * fretGap;
      svg += `<circle cx="${x}" cy="${y}" r="9" fill="#d4a24c"/>`;
    }
  });
  svg += `</svg>`;
  return svg;
}

/* ---------------- App state / routing ---------------- */

const screens = {
  home: document.getElementById("screen-home"),
  song: document.getElementById("screen-song"),
  form: document.getElementById("screen-form"),
  settings: document.getElementById("screen-settings"),
};

let allSongsCache = [];
let currentSongId = null;
let editingSongId = null;
let pendingThumbDataUrl = null;
let searchQuery = "";

// audio (song playback) form state
let pendingAudioBlob = null;
let pendingAudioName = "";
let pendingAudioType = "";

// play-mode (sync playback) state
const PLAY_RATES = [0.5, 0.75, 1, 1.25, 1.5];
let playRateIndex = 2;
let playTimeline = [];
let playAudioUrl = null;
let playAudioSongId = null;
let chipPressTimer = null;
let suppressChipClick = false;

// auto chord-detection state
let detectFile = null;
let detectFileUrl = null;
let detectSegments = [];
let detectPlayingIndex = -1;

// chord edit sheet state (Feature 1)
let _cesOriginalChord = null;

// timeline entry edit sheet state (Feature 2)
let _tesEntryIdx = -1;
let _tesCurrentTime = 0;

// play pane edit mode toggle (Feature 2)
let playEditMode = false;

function showScreen(name) {
  if (name !== "song") {
    const audio = document.getElementById("play-audio");
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (playAudioUrl) { URL.revokeObjectURL(playAudioUrl); playAudioUrl = null; }
    playAudioSongId = null;
    playTimeline = [];
  }
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo(0, 0);
}

function route() {
  const hash = location.hash || "#/home";
  const [, path, param] = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/) || [];
  if (path === "song" && param) {
    openSong(Number(param));
  } else if (path === "add") {
    openForm(null);
  } else if (path === "edit" && param) {
    openForm(Number(param));
  } else if (path === "settings") {
    showScreen("settings");
  } else {
    renderHome();
    showScreen("home");
  }
}
window.addEventListener("hashchange", route);

function go(hash) {
  location.hash = hash;
}
function goBack() {
  history.back();
}

/* ---------------- Home screen ---------------- */

async function refreshSongs() {
  allSongsCache = await dbGetAll();
  return allSongsCache;
}

function songRowHtml(song) {
  const thumb = song.thumbnail
    ? `<img src="${song.thumbnail}" alt="">`
    : "&#9834;";
  return `
    <button class="song-row" data-id="${song.id}">
      <span class="song-thumb">${thumb}</span>
      <span class="song-meta">
        <div class="song-title">${escapeHtml(song.title || "無題")}</div>
        <div class="song-artist">${escapeHtml(song.artist || "")}</div>
      </span>
      ${song.key ? `<span class="song-key">${escapeHtml(song.key)}</span>` : ""}
    </button>
  `;
}

async function renderHome() {
  await refreshSongs();
  const body = document.getElementById("home-body");
  const q = searchQuery.trim().toLowerCase();

  if (q) {
    const filtered = allSongsCache.filter((s) =>
      (s.title || "").toLowerCase().includes(q) ||
      (s.artist || "").toLowerCase().includes(q)
    );
    body.innerHTML = filtered.length
      ? `<div class="section-label">検索結果</div><div class="song-list">${filtered.map(songRowHtml).join("")}</div>`
      : `<div class="empty-state"><strong>見つかりませんでした</strong>別のキーワードで試してください</div>`;
    bindSongRows(body);
    return;
  }

  if (allSongsCache.length === 0) {
    body.innerHTML = `<div class="empty-state"><strong>曲がまだありません</strong>右下の「＋ 曲を追加」から<br>最初の1曲を登録しましょう</div>`;
    return;
  }

  const recent = [...allSongsCache]
    .filter((s) => s.lastPlayedAt)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 3);

  const frequent = [...allSongsCache]
    .filter((s) => (s.playCount || 0) > 0)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 3);

  const all = [...allSongsCache].sort((a, b) => (a.title || "").localeCompare(b.title || "", "ja"));

  let html = "";
  if (recent.length) {
    html += `<div class="section-label">最近弾いた曲</div><div class="song-list">${recent.map(songRowHtml).join("")}</div>`;
  }
  if (frequent.length) {
    html += `<div class="section-label">よく弾く曲</div><div class="song-list">${frequent.map(songRowHtml).join("")}</div>`;
  }
  html += `<div class="section-label">すべての曲</div><div class="song-list">${all.map(songRowHtml).join("")}</div>`;
  body.innerHTML = html;
  bindSongRows(body);
}

function bindSongRows(container) {
  container.querySelectorAll(".song-row").forEach((row) => {
    row.addEventListener("click", () => {
      go(`#/song/${row.dataset.id}`);
    });
  });
}

/* ---------------- Song detail screen ---------------- */

async function openSong(id) {
  const song = await dbGet(id);
  if (!song) {
    go("#/home");
    return;
  }
  currentSongId = id;

  // mark as played
  song.playCount = (song.playCount || 0) + 1;
  song.lastPlayedAt = Date.now();
  await dbPut(song);

  renderSongScreen(song, { resetTab: true });
  showScreen("song");
}

// Re-render the currently open song without bumping play stats or resetting
// playback (used after a quick chord/time correction from Play mode).
async function refreshSongScreenAfterEdit() {
  if (!currentSongId) return;
  const song = await dbGet(currentSongId);
  if (!song) return;
  renderSongScreen(song, { resetTab: false });
}

function renderSongScreen(song, opts) {
  const resetTab = !opts || opts.resetTab !== false;

  document.getElementById("song-title").textContent = song.title || "無題";
  document.getElementById("song-artist").textContent = song.artist || "";

  const badgeRow = document.getElementById("song-badges");
  let badges = "";
  if (song.key) badges += `<span class="badge">Key: <b>${escapeHtml(song.key)}</b></span>`;
  badges += `<span class="badge">Capo: <b>${escapeHtml(song.capo || "なし")}</b></span>`;
  badgeRow.innerHTML = badges;

  const chordPane = document.getElementById("pane-chords");
  chordPane.innerHTML = song.chords && song.chords.trim()
    ? `<div class="chart">${renderChordChart(song.chords)}</div>`
    : `<div class="empty-pane">コード譜が未登録です</div>`;

  const tabPane = document.getElementById("pane-tab");
  tabPane.innerHTML = song.tab && song.tab.trim()
    ? `<div class="tabchart">${escapeHtml(song.tab)}</div>`
    : `<div class="empty-pane">TAB譜が未登録です</div>`;

  const memoBlock = document.getElementById("song-memo");
  if (song.memo && song.memo.trim()) {
    memoBlock.style.display = "block";
    memoBlock.innerHTML = `<span class="label">メモ</span>${escapeHtml(song.memo)}`;
  } else {
    memoBlock.style.display = "none";
  }

  bindChordTaps(chordPane);

  const playTabBtn = document.getElementById("tab-btn-play");
  playTimeline = parseChordTimeline(song.chords || "");

  let targetTab;
  if (resetTab) {
    targetTab = song.audioBlob ? "play" : "chords";
  } else {
    targetTab = document.getElementById("tab-btn-play").classList.contains("active") ? "play"
      : document.getElementById("tab-btn-tab").classList.contains("active") ? "tab" : "chords";
    if (targetTab === "play" && !song.audioBlob) targetTab = "chords";
  }

  if (song.audioBlob) {
    playTabBtn.style.display = "";
    setupPlayAudio(song);
    renderPlayPane(song);
  } else {
    playTabBtn.style.display = "none";
  }
  setSongTab(targetTab);

  document.getElementById("song-edit-btn").onclick = () => go(`#/edit/${song.id}`);
}

function setSongTab(which) {
  document.getElementById("tab-btn-play").classList.toggle("active", which === "play");
  document.getElementById("tab-btn-chords").classList.toggle("active", which === "chords");
  document.getElementById("tab-btn-tab").classList.toggle("active", which === "tab");
  document.getElementById("pane-play").classList.toggle("active", which === "play");
  document.getElementById("pane-chords").classList.toggle("active", which === "chords");
  document.getElementById("pane-tab").classList.toggle("active", which === "tab");
}

function bindChordTaps(container) {
  container.querySelectorAll(".chord-tok").forEach((el) => {
    el.addEventListener("click", () => openChordEditSheet(el.dataset.chord));
  });
}

function openChordSheet(chordName) {
  const shape = findChordShape(chordName);
  document.getElementById("sheet-chord-name").textContent = chordName;
  const wrap = document.getElementById("sheet-diagram");
  wrap.innerHTML = shape
    ? buildChordDiagramSVG(shape)
    : `<div class="no-diagram">このコードのダイアグラムは未対応です</div>`;
  document.getElementById("chord-sheet").classList.add("active");
}

/* ----------------  Chord Edit Sheet (Feature 1) ----------------
   Opens when user taps a chord token in the コード譜 pane.
   Shows diagram + common variants (tap to instantly apply) + text input.
   On apply: replaces ALL occurrences of that chord name in the song text.
   ---------------------------------------------------------------- */

function buildChordVariants(chordName) {
  const rootMatch = chordName.match(/^([A-G][#b]?)/);
  if (!rootMatch) return [];
  const root = rootMatch[1];
  const qualities = ["", "m", "7", "maj7", "m7", "sus2", "sus4", "add9", "dim", "aug", "5", "m7b5"];
  return qualities.map((q) => root + q).filter((n) => n !== chordName);
}

function openChordEditSheet(chordName) {
  _cesOriginalChord = chordName;
  document.getElementById("ces-chord-name").textContent = chordName;

  const shape = findChordShape(chordName);
  document.getElementById("ces-diagram").innerHTML = shape
    ? buildChordDiagramSVG(shape)
    : '<div class="no-diagram">ダイアグラム未対応</div>';

  const variants = buildChordVariants(chordName);
  document.getElementById("ces-variants").innerHTML = variants
    .map((c) => `<button type="button" class="ces-variant-btn" data-chord="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");

  const input = document.getElementById("ces-input");
  input.value = chordName;
  document.getElementById("chord-edit-sheet").classList.add("active");
}

function closeChordEditSheet() {
  document.getElementById("chord-edit-sheet").classList.remove("active");
}

async function applyChordEdit(newName) {
  const trimmed = (newName || "").trim();
  if (!trimmed) return;
  closeChordEditSheet();
  if (trimmed === _cesOriginalChord) return;
  await replaceChordInSong(_cesOriginalChord, trimmed);
}

async function replaceChordInSong(oldName, newName) {
  if (!currentSongId) return;
  const song = await dbGet(currentSongId);
  if (!song || !song.chords) return;

  // Match whole chord tokens (not inside longer words)
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9#b])`, "g");
  const hits = (song.chords.match(re) || []).length;

  if (hits === 0) { showToast("変更箇所が見つかりませんでした"); return; }

  song.chords = song.chords.replace(re, newName);
  await dbPut(song);
  showToast(`${oldName} → ${newName} に変更（${hits}箇所）`);
  await refreshSongScreenAfterEdit();
}

/* ----------------  Timeline Entry Edit Sheet (Feature 2) ----------------
   Replaces the window.prompt() chord-edit in play mode.
   Shows chord variants + text input + ±time buttons + save.
   ---------------------------------------------------------------- */

function openTimelineEditSheet(idx) {
  const entry = playTimeline[idx];
  if (!entry) return;

  _tesEntryIdx = idx;
  _tesCurrentTime = entry.time;

  const variants = buildChordVariants(entry.chord);
  document.getElementById("tes-variants").innerHTML = variants
    .map((c) => `<button type="button" class="ces-variant-btn" data-chord="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");

  document.getElementById("tes-chord-input").value = entry.chord;
  _updateTesTimeDisplay();
  document.getElementById("timeline-edit-sheet").classList.add("active");

  const audio = document.getElementById("play-audio");
  if (audio && !audio.paused) audio.pause();
}

function closeTimelineEditSheet() {
  document.getElementById("timeline-edit-sheet").classList.remove("active");
}

function _updateTesTimeDisplay() {
  const el = document.getElementById("tes-time-display");
  if (el) el.textContent = ChordDetect.formatTime(_tesCurrentTime);
}

async function applyTesEdit() {
  const newChord = (document.getElementById("tes-chord-input").value || "").trim();
  if (!newChord) return;
  const entry = playTimeline[_tesEntryIdx];
  if (!entry) return;

  closeTimelineEditSheet();

  if (!currentSongId) return;
  const song = await dbGet(currentSongId);
  if (!song) return;
  const lines = (song.chords || "").split(/\r?\n/);
  if (entry.lineIdx == null || lines[entry.lineIdx] == null) return;

  lines[entry.lineIdx] = `${ChordDetect.formatTime(_tesCurrentTime)}  ${newChord}`;
  song.chords = lines.join("\n");
  await dbPut(song);
  showToast("修正しました");
  await refreshSongScreenAfterEdit();
}

/* ----------------  Detect segment time helper (Feature 2) ---------------- */

function parseDetectTimeInput(str) {
  const m = (str || "").trim().match(/^(\d+):([0-5]?\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function renderDetectTimeline() {
  const tl = document.getElementById("detect-timeline");
  if (!tl || detectSegments.length === 0) return;
  const first = detectSegments[0].start;
  const last = detectSegments[detectSegments.length - 1].end;
  const total = last - first;
  if (total <= 0) return;
  tl.innerHTML = detectSegments.map((seg, i) => {
    const w = ((seg.end - seg.start) / total * 100).toFixed(2);
    const lbl = seg.chord.length > 4 ? seg.chord.slice(0, 3) : seg.chord;
    return `<div class="detect-tl-seg" style="flex:${w}" data-tl-index="${i}" title="${escapeHtml(seg.chord)}"><span>${escapeHtml(lbl)}</span></div>`;
  }).join("");
}

/* ---------------- Play mode (playback synced with chords) ----------------
   Timeline entries are parsed straight out of the song's chord-chart text:
   a line like "0:09  C" becomes { time: 9, chord: "C" }. Section tags such
   as "[Chorus]" on their own line tag every following entry until the next
   tag. This keeps a single source of truth (the chord chart text) instead
   of a separate data structure to keep in sync.
   ------------------------------------------------------------------- */

function parseChordTimeline(text) {
  const entries = [];
  if (!text) return entries;
  const lines = text.split(/\r?\n/);
  const sectionRe = /^\s*\[([^\]]+)\]\s*$/;
  const timeChordRe = /^\s*(\d+):([0-5]?\d)\s+(\S.*?)\s*$/;
  let currentSection = null;
  lines.forEach((line, lineIdx) => {
    if (!line.trim()) return;
    const sm = line.match(sectionRe);
    if (sm) {
      currentSection = sm[1].trim();
      return;
    }
    const tm = line.match(timeChordRe);
    if (tm) {
      const chord = tm[3].trim();
      if (chord) {
        entries.push({
          time: parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10),
          chord,
          section: currentSection,
          lineIdx,
        });
      }
    }
  });
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function setupPlayAudio(song) {
  const audio = document.getElementById("play-audio");
  if (playAudioSongId === song.id) return; // already loaded, keep playback position
  audio.pause();
  if (playAudioUrl) { URL.revokeObjectURL(playAudioUrl); playAudioUrl = null; }
  playAudioUrl = URL.createObjectURL(song.audioBlob);
  audio.src = playAudioUrl;
  audio.load();
  playRateIndex = 2; // reset to 1x for each newly opened song
  audio.playbackRate = PLAY_RATES[playRateIndex];
  playAudioSongId = song.id;
}

function renderPlayPane(song) {
  playEditMode = false; // reset edit mode whenever the play pane is (re)rendered
  const pane = document.getElementById("pane-play");
  const hasTimeline = playTimeline.length > 0;
  pane.innerHTML = `
    <div class="play-wrap">
      <div class="play-section-label" id="play-section-label">&nbsp;</div>
      <div class="play-chord-stage">
        <div class="play-chord-next hidden" id="play-chord-next">
          <span class="play-next-label">次</span>
          <span class="play-next-name" id="play-next-name"></span>
        </div>
        <div class="play-chord-name is-empty" id="play-chord-name">${hasTimeline ? "再生してください" : "&#9834;"}</div>
        <div class="play-chord-diagram" id="play-chord-diagram"></div>
      </div>
      ${hasTimeline ? `
      <div class="play-edit-toolbar">
        <button type="button" id="play-edit-mode-btn" class="play-edit-mode-btn">✏ タイミングを編集</button>
      </div>` : ""}
      <div class="play-progression${playEditMode ? " edit-mode" : ""}" id="play-progression"></div>
      <div class="play-transport">
        <div class="play-time-row">
          <span id="play-time-current">0:00</span>
          <input type="range" id="play-seek" class="play-seek" min="0" max="1000" value="0" step="1">
          <span id="play-time-total">0:00</span>
        </div>
        <div class="play-controls-row">
          <button type="button" id="play-rate-btn" class="play-rate-btn">${PLAY_RATES[playRateIndex]}x</button>
          <button type="button" id="play-toggle-btn" class="play-toggle-btn">&#9654;</button>
          <div class="play-rate-spacer"></div>
        </div>
      </div>
      ${hasTimeline ? "" : `<div class="play-no-timeline">タイムスタンプ付きコードが見つかりません。コード譜に「0:09　C」のような行を追加すると、再生に合わせて自動でハイライトされます。「音源から自動検出」を使うと自動的にこの形式で入力されます。</div>`}
    </div>
  `;
  renderPlayProgression();
  const audio = document.getElementById("play-audio");
  updatePlayUIForTime(audio.currentTime || 0);
  updatePlayTimeDisplay();
  updatePlayToggleIcon();
}

function renderPlayProgression() {
  const wrap = document.getElementById("play-progression");
  if (!wrap) return;
  let lastSection = null;
  wrap.innerHTML = playTimeline.map((entry, i) => {
    const showSection = entry.section && entry.section !== lastSection;
    lastSection = entry.section;
    return `<div class="play-chip" data-index="${i}">${
      showSection ? `<span class="chip-section">${escapeHtml(entry.section)}</span>` : ""
    }${escapeHtml(entry.chord)}</div>`;
  }).join("");
}

function findCurrentTimelineIndex(t) {
  let idx = -1;
  for (let i = 0; i < playTimeline.length; i++) {
    if (playTimeline[i].time <= t + 0.05) idx = i;
    else break;
  }
  return idx;
}

function updatePlayUIForTime(t) {
  const nameEl = document.getElementById("play-chord-name");
  if (!nameEl) return; // play pane not currently mounted
  const diagramEl = document.getElementById("play-chord-diagram");
  const nextWrap = document.getElementById("play-chord-next");
  const nextNameEl = document.getElementById("play-next-name");
  const sectionEl = document.getElementById("play-section-label");

  if (playTimeline.length === 0) return;

  const idx = findCurrentTimelineIndex(t);
  const current = idx >= 0 ? playTimeline[idx] : null;
  const next = idx >= 0 ? playTimeline[idx + 1] : playTimeline[0];

  if (current) {
    nameEl.textContent = current.chord;
    nameEl.classList.remove("is-empty");
    const shape = findChordShape(current.chord);
    diagramEl.innerHTML = shape ? buildChordDiagramSVG(shape) : `<div class="no-diagram">ダイアグラム未対応</div>`;
    sectionEl.textContent = current.section || "";
  } else {
    nameEl.textContent = "まもなく開始";
    nameEl.classList.add("is-empty");
    diagramEl.innerHTML = "";
    sectionEl.innerHTML = "&nbsp;";
  }

  if (next && next !== current) {
    nextWrap.classList.remove("hidden");
    nextNameEl.textContent = next.chord;
  } else {
    nextWrap.classList.add("hidden");
  }

  document.querySelectorAll("#play-progression .play-chip").forEach((chip, i) => {
    chip.classList.toggle("is-current", i === idx);
    chip.classList.toggle("is-past", i < idx);
  });
  if (idx >= 0) {
    const currentChip = document.querySelector(`#play-progression .play-chip[data-index="${idx}"]`);
    if (currentChip) currentChip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

function updatePlayTimeDisplay() {
  const audio = document.getElementById("play-audio");
  const curEl = document.getElementById("play-time-current");
  if (!curEl) return;
  const totEl = document.getElementById("play-time-total");
  const seekEl = document.getElementById("play-seek");
  curEl.textContent = ChordDetect.formatTime(audio.currentTime || 0);
  totEl.textContent = audio.duration && isFinite(audio.duration) ? ChordDetect.formatTime(audio.duration) : "0:00";
  if (seekEl && audio.duration && isFinite(audio.duration)) {
    seekEl.value = Math.round((audio.currentTime / audio.duration) * 1000);
  }
}

function updatePlayToggleIcon() {
  const audio = document.getElementById("play-audio");
  const btn = document.getElementById("play-toggle-btn");
  if (!btn) return;
  btn.innerHTML = audio.paused ? "&#9654;" : "&#10073;&#10073;";
}

function togglePlayAudio() {
  const audio = document.getElementById("play-audio");
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function cyclePlayRate() {
  playRateIndex = (playRateIndex + 1) % PLAY_RATES.length;
  const audio = document.getElementById("play-audio");
  audio.playbackRate = PLAY_RATES[playRateIndex];
  const btn = document.getElementById("play-rate-btn");
  if (btn) btn.textContent = PLAY_RATES[playRateIndex] + "x";
}

function seekToTimelineEntry(idx) {
  const entry = playTimeline[idx];
  const audio = document.getElementById("play-audio");
  if (!entry || !audio.src) return;
  audio.currentTime = entry.time;
  updatePlayUIForTime(entry.time);
  updatePlayTimeDisplay();
}

// Long-press / right-click a chip → opens the timeline edit sheet (Feature 2).
function quickEditTimelineEntry(idx) {
  openTimelineEditSheet(idx);
}

async function applyTimelineEdit(entry, newChordName) {
  if (!currentSongId) return;
  const song = await dbGet(currentSongId);
  if (!song) return;
  const lines = (song.chords || "").split(/\r?\n/);
  if (entry.lineIdx == null || lines[entry.lineIdx] == null) return;
  lines[entry.lineIdx] = `${ChordDetect.formatTime(entry.time)}  ${newChordName}`;
  song.chords = lines.join("\n");
  await dbPut(song);
  showToast("コードを修正しました");
  await refreshSongScreenAfterEdit();
}

/* ---------------- Add / Edit form ---------------- */

const formFields = ["title", "artist", "key", "capo", "chords", "tab", "memo"];

async function openForm(id) {
  editingSongId = id;
  pendingThumbDataUrl = null;
  pendingAudioBlob = null;
  pendingAudioName = "";
  pendingAudioType = "";
  const form = document.getElementById("song-form");
  form.reset();
  document.getElementById("thumb-preview").src = "";
  document.getElementById("thumb-preview").style.display = "none";
  document.getElementById("form-title-label").textContent = id ? "曲を編集" : "曲を追加";
  document.getElementById("form-delete-btn").style.display = id ? "block" : "none";
  updateAudioFieldUI();

  if (id) {
    const song = await dbGet(id);
    if (song) {
      formFields.forEach((f) => {
        const el = document.getElementById("field-" + f);
        if (el) el.value = song[f] || "";
      });
      if (song.thumbnail) {
        pendingThumbDataUrl = song.thumbnail;
        const prev = document.getElementById("thumb-preview");
        prev.src = song.thumbnail;
        prev.style.display = "block";
      }
      if (song.audioBlob) {
        pendingAudioBlob = song.audioBlob;
        pendingAudioName = song.audioName || "音源ファイル";
        pendingAudioType = song.audioType || song.audioBlob.type || "";
        updateAudioFieldUI();
      }
    }
  }
  showScreen("form");
}

function handleAudioFile(file) {
  if (!file) return;
  pendingAudioBlob = file;
  pendingAudioName = file.name;
  pendingAudioType = file.type;
  updateAudioFieldUI();
}

function removeAudioFile() {
  pendingAudioBlob = null;
  pendingAudioName = "";
  pendingAudioType = "";
  updateAudioFieldUI();
}

function updateAudioFieldUI() {
  const nameEl = document.getElementById("audio-file-name");
  const removeBtn = document.getElementById("audio-remove-btn");
  if (!nameEl || !removeBtn) return;
  if (pendingAudioBlob) {
    nameEl.textContent = "選択中: " + (pendingAudioName || "音源ファイル");
    removeBtn.style.display = "inline-block";
  } else {
    nameEl.textContent = "";
    removeBtn.style.display = "none";
  }
}

async function handleThumbnailFile(file) {
  if (!file) return;
  const dataUrl = await resizeImageToDataUrl(file, 300, 0.82);
  pendingThumbDataUrl = dataUrl;
  const prev = document.getElementById("thumb-preview");
  prev.src = dataUrl;
  prev.style.display = "block";
}

function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveForm(e) {
  e.preventDefault();
  const song = {};
  formFields.forEach((f) => {
    song[f] = document.getElementById("field-" + f).value.trim();
  });
  song.thumbnail = pendingThumbDataUrl || null;
  song.audioBlob = pendingAudioBlob || null;
  song.audioName = pendingAudioBlob ? pendingAudioName : null;
  song.audioType = pendingAudioBlob ? pendingAudioType : null;

  if (!song.title) {
    document.getElementById("field-title").focus();
    return;
  }

  if (editingSongId) {
    const existing = await dbGet(editingSongId);
    const updated = { ...existing, ...song };
    await dbPut(updated);
    showToast("保存しました");
    go(`#/song/${editingSongId}`);
  } else {
    song.playCount = 0;
    song.lastPlayedAt = null;
    song.createdAt = Date.now();
    const id = await dbAdd(song);
    showToast("追加しました");
    go(`#/song/${id}`);
  }
}

async function deleteCurrentEditingSong() {
  if (!editingSongId) return;
  if (!confirm("この曲を削除しますか？この操作は取り消せません。")) return;
  await dbDelete(editingSongId);
  showToast("削除しました");
  go("#/home");
}

/* ---------------- Settings / backup ---------------- */

// Blob (audio) isn't JSON-serializable, so backups convert it to a data URL
// on export and back to a Blob on import.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function exportBackup() {
  const songs = await dbGetAll();
  const exportSongs = [];
  for (const song of songs) {
    const clone = { ...song };
    if (clone.audioBlob instanceof Blob) {
      clone.audioDataUrl = await blobToDataUrl(clone.audioBlob);
      delete clone.audioBlob;
    }
    exportSongs.push(clone);
  }
  const payload = {
    app: "guitar-library",
    exportedAt: new Date().toISOString(),
    songs: exportSongs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `guitar-library-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました");
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const songs = Array.isArray(data.songs) ? data.songs : Array.isArray(data) ? data : null;
    if (!songs) throw new Error("invalid format");
    if (!confirm(`${songs.length}曲を読み込みます。既存のデータに追加されます。よろしいですか？`)) return;
    for (const s of songs) {
      const clone = { ...s };
      delete clone.id; // avoid key collisions, always insert as new
      if (clone.audioDataUrl) {
        try {
          clone.audioBlob = await dataUrlToBlob(clone.audioDataUrl);
        } catch (audioErr) {
          clone.audioBlob = null;
        }
        delete clone.audioDataUrl;
      }
      await dbAdd(clone);
    }
    showToast(`${songs.length}曲を読み込みました`);
    route();
  } catch (err) {
    alert("読み込みに失敗しました。ファイル形式を確認してください。");
  }
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ---------------- Auto chord detection ---------------- */

function detectShowStep(step) {
  ["pick", "progress", "review"].forEach((s) => {
    document.getElementById("detect-step-" + s).classList.toggle("active", s === step);
  });
}

function openDetectOverlay() {
  detectFile = null;
  detectSegments = [];
  detectPlayingIndex = -1;
  if (detectFileUrl) { URL.revokeObjectURL(detectFileUrl); detectFileUrl = null; }
  document.getElementById("detect-file-input").value = "";
  document.getElementById("detect-file-name").textContent = "";
  document.getElementById("detect-start-btn").disabled = true;
  document.getElementById("detect-progress-bar").style.width = "0%";
  document.getElementById("detect-progress-text").textContent = "解析中…";
  detectShowStep("pick");
  document.getElementById("detect-overlay").classList.add("active");
}

function closeDetectOverlay() {
  const audio = document.getElementById("detect-audio");
  audio.pause();
  if (detectFileUrl) { URL.revokeObjectURL(detectFileUrl); detectFileUrl = null; }
  document.getElementById("detect-overlay").classList.remove("active");
}

function onDetectFileChosen(file) {
  detectFile = file || null;
  document.getElementById("detect-file-name").textContent = file ? file.name : "";
  document.getElementById("detect-start-btn").disabled = !file;
}

async function runDetection() {
  if (!detectFile) return;
  detectShowStep("progress");
  const bar = document.getElementById("detect-progress-bar");
  const text = document.getElementById("detect-progress-text");
  bar.style.width = "0%";

  try {
    const segments = await ChordDetect.analyzeFile(detectFile, (ratio, msg) => {
      bar.style.width = Math.round(ratio * 100) + "%";
      if (msg) text.textContent = msg;
    });
    detectSegments = segments.map((s) => ({ ...s }));
    detectFileUrl = URL.createObjectURL(detectFile);
    document.getElementById("detect-audio").src = detectFileUrl;
    renderDetectSegments();
    detectShowStep("review");
  } catch (err) {
    alert("解析に失敗しました。この形式の音源には対応していない可能性があります。");
    detectShowStep("pick");
  }
}

function renderDetectSegments() {
  const list = document.getElementById("detect-segment-list");
  if (detectSegments.length === 0) {
    list.innerHTML = `<div class="empty-segments">コードを検出できませんでした。別の音源で試すか、手動で入力してください。</div>`;
    return;
  }

  // Build visual timeline (proportional widths)
  const firstStart = detectSegments[0].start;
  const lastEnd = detectSegments[detectSegments.length - 1].end;
  const totalDuration = lastEnd - firstStart;
  let timelineHtml = "";
  if (totalDuration > 0) {
    const segs = detectSegments.map((seg, i) => {
      const w = ((seg.end - seg.start) / totalDuration * 100).toFixed(2);
      const lbl = seg.chord.length > 4 ? seg.chord.slice(0, 4) : seg.chord;
      return `<div class="detect-tl-seg" style="flex:${w}" data-tl-index="${i}" title="${escapeHtml(seg.chord)}"><span>${escapeHtml(lbl)}</span></div>`;
    }).join("");
    timelineHtml = `<div class="detect-timeline" id="detect-timeline">${segs}</div>`;
  }

  // Rows: play | editable-start-time | chord-input | delete
  const rowsHtml = detectSegments.map((seg, i) => `
    <div class="segment-row" data-index="${i}">
      <button type="button" class="segment-play" data-action="play">&#9654;</button>
      <input type="text" class="segment-time-input" data-action="edit-time"
             value="${ChordDetect.formatTime(seg.start)}" placeholder="0:00"
             inputmode="numeric" aria-label="開始時間">
      <input type="text" class="segment-chord-input" data-action="edit" value="${escapeHtml(seg.chord)}">
      <button type="button" class="segment-delete" data-action="delete">&#128465;</button>
    </div>
  `).join("");

  list.innerHTML = timelineHtml + rowsHtml;
}

function bindDetectSegmentEvents() {
  const list = document.getElementById("detect-segment-list");

  list.addEventListener("click", (e) => {
    // Timeline segment click → scroll to corresponding row & highlight
    const tlSeg = e.target.closest(".detect-tl-seg");
    if (tlSeg) {
      const idx = Number(tlSeg.dataset.tlIndex);
      const row = list.querySelector(`.segment-row[data-index="${idx}"]`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      list.querySelectorAll(".detect-tl-seg").forEach((s) => s.classList.remove("highlighted"));
      tlSeg.classList.add("highlighted");
      list.querySelectorAll(".segment-row").forEach((r) => r.classList.remove("highlighted"));
      if (row) {
        row.classList.add("highlighted");
        setTimeout(() => row.classList.remove("highlighted"), 1400);
      }
      return;
    }

    const row = e.target.closest(".segment-row");
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (e.target.closest('[data-action="play"]')) {
      playDetectSegment(idx, e.target.closest(".segment-play"));
    } else if (e.target.closest('[data-action="delete"]')) {
      detectSegments.splice(idx, 1);
      renderDetectSegments();
    }
  });

  list.addEventListener("input", (e) => {
    if (e.target.dataset.action === "edit") {
      const row = e.target.closest(".segment-row");
      const idx = Number(row.dataset.index);
      detectSegments[idx].chord = e.target.value;
      // Live-update the corresponding timeline label
      const tlSeg = list.querySelector(`.detect-tl-seg[data-tl-index="${idx}"]`);
      if (tlSeg) {
        const lbl = e.target.value.length > 4 ? e.target.value.slice(0, 4) : e.target.value;
        const span = tlSeg.querySelector("span");
        if (span) span.textContent = lbl || "?";
        tlSeg.title = e.target.value;
      }
    }
  });

  // Commit editable time on blur/Enter
  list.addEventListener("change", (e) => {
    if (e.target.dataset.action === "edit-time") {
      const row = e.target.closest(".segment-row");
      if (!row) return;
      const idx = Number(row.dataset.index);
      const parsed = parseDetectTimeInput(e.target.value);
      if (parsed !== null && parsed >= 0) {
        detectSegments[idx].start = parsed;
        renderDetectTimeline(); // re-draw proportional bar
      } else {
        e.target.value = ChordDetect.formatTime(detectSegments[idx].start);
      }
    }
  });

  list.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.action === "edit-time") {
      e.target.blur(); // trigger change event
    }
  });
}

function playDetectSegment(idx, btnEl) {
  const audio = document.getElementById("detect-audio");
  document.querySelectorAll(".segment-play.playing").forEach((b) => b.classList.remove("playing"));

  if (detectPlayingIndex === idx && !audio.paused) {
    audio.pause();
    detectPlayingIndex = -1;
    return;
  }

  const seg = detectSegments[idx];
  const previewEnd = seg.start + Math.min(6, seg.end - seg.start);
  audio.currentTime = seg.start;
  audio.play();
  detectPlayingIndex = idx;
  btnEl.classList.add("playing");

  const onTime = () => {
    if (audio.currentTime >= previewEnd) {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      btnEl.classList.remove("playing");
      detectPlayingIndex = -1;
    }
  };
  audio.addEventListener("timeupdate", onTime);
  audio.addEventListener("pause", () => btnEl.classList.remove("playing"), { once: true });
}

function applyDetectSegments() {
  const validSegments = detectSegments.filter((s) => s.chord && s.chord.trim());
  if (validSegments.length === 0) {
    showToast("反映するコードがありません");
    return;
  }
  const lines = validSegments.map((s) => `${ChordDetect.formatTime(s.start)}  ${s.chord.trim()}`);
  const text = "[自動検出]\n" + lines.join("\n");

  const textarea = document.getElementById("field-chords");
  const existing = textarea.value.trim();
  if (existing) {
    if (!confirm("既にコード譜が入力されています。末尾に追記しますか？(キャンセルで中止)")) return;
    textarea.value = existing + "\n\n" + text;
  } else {
    textarea.value = text;
  }
  closeDetectOverlay();
  showToast("コード譜に反映しました");
  if (typeof textarea.scrollIntoView === "function") {
    textarea.scrollIntoView({ block: "center" });
  }
}

/* ---------------- Wiring ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  route();

  const versionEl = document.getElementById("app-version-footer");
  if (versionEl) {
    versionEl.textContent = `Guitar Library v${APP_VERSION} (${APP_BUILD_DATE})`;
  }
  const versionSettingsEl = document.getElementById("app-version-settings");
  if (versionSettingsEl) {
    versionSettingsEl.textContent = `v${APP_VERSION} (${APP_BUILD_DATE} ビルド)`;
  }

  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderHome();
  });

  document.getElementById("fab-add").addEventListener("click", () => go("#/add"));
  document.getElementById("settings-open-btn").addEventListener("click", () => go("#/settings"));

  document.getElementById("song-back-btn").addEventListener("click", goBack);
  document.getElementById("form-back-btn").addEventListener("click", goBack);
  document.getElementById("settings-back-btn").addEventListener("click", goBack);

  document.getElementById("tab-btn-play").addEventListener("click", () => setSongTab("play"));
  document.getElementById("tab-btn-chords").addEventListener("click", () => setSongTab("chords"));
  document.getElementById("tab-btn-tab").addEventListener("click", () => setSongTab("tab"));

  document.getElementById("sheet-close-btn").addEventListener("click", () => {
    document.getElementById("chord-sheet").classList.remove("active");
  });
  document.getElementById("chord-sheet").addEventListener("click", (e) => {
    if (e.target.id === "chord-sheet") e.currentTarget.classList.remove("active");
  });

  document.getElementById("song-form").addEventListener("submit", saveForm);
  document.getElementById("form-delete-btn").addEventListener("click", deleteCurrentEditingSong);

  document.getElementById("thumb-input").addEventListener("change", (e) => {
    handleThumbnailFile(e.target.files[0]);
  });
  document.getElementById("thumb-pick-btn").addEventListener("click", () => {
    document.getElementById("thumb-input").click();
  });

  document.getElementById("export-btn").addEventListener("click", exportBackup);
  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });
  document.getElementById("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });

  document.getElementById("open-detect-btn").addEventListener("click", openDetectOverlay);
  document.getElementById("detect-close-btn").addEventListener("click", closeDetectOverlay);
  document.getElementById("detect-file-pick-btn").addEventListener("click", () => {
    document.getElementById("detect-file-input").click();
  });
  document.getElementById("detect-file-input").addEventListener("change", (e) => {
    onDetectFileChosen(e.target.files[0]);
  });
  document.getElementById("detect-start-btn").addEventListener("click", runDetection);
  document.getElementById("detect-apply-btn").addEventListener("click", applyDetectSegments);
  bindDetectSegmentEvents();

  // -------- Audio file picker (add/edit form) --------
  document.getElementById("audio-input").addEventListener("change", (e) => {
    handleAudioFile(e.target.files[0]);
  });
  document.getElementById("audio-pick-btn").addEventListener("click", () => {
    document.getElementById("audio-input").click();
  });
  document.getElementById("audio-remove-btn").addEventListener("click", removeAudioFile);

  // -------- Chord Edit Sheet (Feature 1) --------
  const chordEditSheet = document.getElementById("chord-edit-sheet");
  chordEditSheet.addEventListener("click", (e) => {
    // Backdrop tap closes
    if (e.target === chordEditSheet) { closeChordEditSheet(); return; }
    if (e.target.closest("#ces-close-btn")) { closeChordEditSheet(); return; }
    // Variant button → immediate apply
    const varBtn = e.target.closest(".ces-variant-btn");
    if (varBtn && e.target.closest("#ces-variants")) {
      applyChordEdit(varBtn.dataset.chord);
      return;
    }
    // Manual apply button
    if (e.target.id === "ces-apply-btn") {
      applyChordEdit(document.getElementById("ces-input").value);
    }
  });
  document.getElementById("ces-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyChordEdit(e.target.value);
  });

  // -------- Timeline Entry Edit Sheet (Feature 2) --------
  const timelineEditSheet = document.getElementById("timeline-edit-sheet");
  timelineEditSheet.addEventListener("click", (e) => {
    if (e.target === timelineEditSheet) { closeTimelineEditSheet(); return; }
    // Time adjustment buttons
    const adjBtn = e.target.closest(".tes-adj-btn");
    if (adjBtn) {
      const delta = Number(adjBtn.dataset.delta);
      _tesCurrentTime = Math.max(0, _tesCurrentTime + delta);
      _updateTesTimeDisplay();
      return;
    }
    // Variant button → update chord input (don't close yet)
    const varBtn = e.target.closest(".ces-variant-btn");
    if (varBtn && e.target.closest("#tes-variants")) {
      document.getElementById("tes-chord-input").value = varBtn.dataset.chord;
      return;
    }
    if (e.target.id === "tes-cancel-btn") { closeTimelineEditSheet(); return; }
    if (e.target.id === "tes-apply-btn") { applyTesEdit(); }
  });
  document.getElementById("tes-chord-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { applyTesEdit(); }
  });

  // -------- Play mode: persistent <audio> element events --------
  const playAudioEl = document.getElementById("play-audio");
  playAudioEl.addEventListener("timeupdate", () => {
    updatePlayUIForTime(playAudioEl.currentTime);
    updatePlayTimeDisplay();
  });
  playAudioEl.addEventListener("loadedmetadata", updatePlayTimeDisplay);
  playAudioEl.addEventListener("play", updatePlayToggleIcon);
  playAudioEl.addEventListener("pause", updatePlayToggleIcon);
  playAudioEl.addEventListener("ended", updatePlayToggleIcon);

  // -------- Play mode: delegated controls (pane content is re-rendered per song) --------
  const panePlay = document.getElementById("pane-play");
  panePlay.addEventListener("click", (e) => {
    if (e.target.closest("#play-toggle-btn")) {
      togglePlayAudio();
      return;
    }
    if (e.target.closest("#play-rate-btn")) {
      cyclePlayRate();
      return;
    }
    // Edit mode toggle button
    if (e.target.closest("#play-edit-mode-btn")) {
      playEditMode = !playEditMode;
      const btn = document.getElementById("play-edit-mode-btn");
      if (btn) {
        btn.textContent = playEditMode ? "✏ 編集モード中" : "✏ タイミングを編集";
        btn.classList.toggle("active", playEditMode);
      }
      const prog = document.getElementById("play-progression");
      if (prog) prog.classList.toggle("edit-mode", playEditMode);
      return;
    }
    const chip = e.target.closest(".play-chip");
    if (chip) {
      if (suppressChipClick) { suppressChipClick = false; return; }
      const idx = Number(chip.dataset.index);
      if (playEditMode) {
        openTimelineEditSheet(idx);
      } else {
        seekToTimelineEntry(idx);
      }
    }
  });
  panePlay.addEventListener("input", (e) => {
    if (e.target.id === "play-seek") {
      const audio = document.getElementById("play-audio");
      if (audio.duration && isFinite(audio.duration)) {
        audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
      }
    }
  });
  panePlay.addEventListener("touchstart", (e) => {
    const chip = e.target.closest(".play-chip");
    if (!chip) return;
    clearTimeout(chipPressTimer);
    chipPressTimer = setTimeout(() => {
      suppressChipClick = true;
      quickEditTimelineEntry(Number(chip.dataset.index));
    }, 550);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => {
    panePlay.addEventListener(ev, () => clearTimeout(chipPressTimer), { passive: true });
  });
  panePlay.addEventListener("contextmenu", (e) => {
    const chip = e.target.closest(".play-chip");
    if (chip) {
      e.preventDefault();
      quickEditTimelineEntry(Number(chip.dataset.index));
    }
  });
});

/* ---------------- Service worker ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
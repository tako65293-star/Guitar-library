"use strict";

/* =========================================================
   Guitar Library — 自分専用コード譜/TAB譜アプリ
   ローカル完結(IndexedDB) / PWA / iPhone最優先
   ========================================================= */

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

function showScreen(name) {
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

  setSongTab("chords");
  bindChordTaps(chordPane);

  document.getElementById("song-edit-btn").onclick = () => go(`#/edit/${id}`);

  showScreen("song");
}

function setSongTab(which) {
  document.getElementById("tab-btn-chords").classList.toggle("active", which === "chords");
  document.getElementById("tab-btn-tab").classList.toggle("active", which === "tab");
  document.getElementById("pane-chords").classList.toggle("active", which === "chords");
  document.getElementById("pane-tab").classList.toggle("active", which === "tab");
}

function bindChordTaps(container) {
  container.querySelectorAll(".chord-tok").forEach((el) => {
    el.addEventListener("click", () => openChordSheet(el.dataset.chord));
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

/* ---------------- Add / Edit form ---------------- */

const formFields = ["title", "artist", "key", "capo", "chords", "tab", "memo"];

async function openForm(id) {
  editingSongId = id;
  pendingThumbDataUrl = null;
  const form = document.getElementById("song-form");
  form.reset();
  document.getElementById("thumb-preview").src = "";
  document.getElementById("thumb-preview").style.display = "none";
  document.getElementById("form-title-label").textContent = id ? "曲を編集" : "曲を追加";
  document.getElementById("form-delete-btn").style.display = id ? "block" : "none";

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
    }
  }
  showScreen("form");
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

async function exportBackup() {
  const songs = await dbGetAll();
  const payload = {
    app: "guitar-library",
    exportedAt: new Date().toISOString(),
    songs,
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

/* ---------------- Wiring ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  route();

  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderHome();
  });

  document.getElementById("fab-add").addEventListener("click", () => go("#/add"));
  document.getElementById("settings-open-btn").addEventListener("click", () => go("#/settings"));

  document.getElementById("song-back-btn").addEventListener("click", goBack);
  document.getElementById("form-back-btn").addEventListener("click", goBack);
  document.getElementById("settings-back-btn").addEventListener("click", goBack);

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
});

/* ---------------- Service worker ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

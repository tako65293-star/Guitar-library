"use strict";

/* =========================================================
   ChordDetect — 音源ファイルからコード進行を推定する
   完全ローカル(ブラウザ内DSP)処理。外部送信・外部APIなし。

   パイプライン:
   audio file -> decode -> mono / resample -> フレーム分割
   -> 窓関数 -> FFT -> クロマベクトル -> コードテンプレート照合
   -> 時間方向スムージング -> セグメント化
   ========================================================= */

const ChordDetect = (() => {
  const TARGET_SAMPLE_RATE = 22050;
  const FRAME_SIZE = 8192;   // ~371ms window @22050Hz (低音の周波数分解能を確保)
  const HOP_SIZE = 4096;     // 50% overlap, ~186ms 時間分解能
  const MIN_FREQ = 65;       // ギターの低いEあたり
  const MAX_FREQ = 2000;
  const MAX_ANALYZE_SECONDS = 6 * 60; // 長すぎる音源は先頭6分までに制限(処理時間対策)
  const SMOOTH_WINDOW = 5;   // 中央値/多数決フィルタのフレーム数
  const MIN_SEGMENT_SEC = 0.5;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  /* ---------- FFT (in-place, iterative radix-2 Cooley-Tukey) ---------- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const uRe = re[i + k], uIm = im[i + k];
          const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
          const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[i + k + half] = uRe - vRe;
          im[i + k + half] = uIm - vIm;
          const nextRe = curRe * wRe - curIm * wIm;
          const nextIm = curRe * wIm + curIm * wRe;
          curRe = nextRe; curIm = nextIm;
        }
      }
    }
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  /* ---------- Chord templates ---------- */
  // 12 major + 12 minor. root=1.0, third=0.85, fifth=0.9 の重み付け二値テンプレート。
  function buildTemplates() {
    const templates = [];
    for (let root = 0; root < 12; root++) {
      const maj = new Array(12).fill(0);
      maj[root] = 1.0;
      maj[(root + 4) % 12] = 0.85;
      maj[(root + 7) % 12] = 0.9;
      templates.push({ name: NOTE_NAMES[root], vec: maj });

      const min = new Array(12).fill(0);
      min[root] = 1.0;
      min[(root + 3) % 12] = 0.85;
      min[(root + 7) % 12] = 0.9;
      templates.push({ name: NOTE_NAMES[root] + "m", vec: min });
    }
    templates.forEach((t) => {
      t.norm = Math.sqrt(t.vec.reduce((s, v) => s + v * v, 0));
    });
    return templates;
  }
  const TEMPLATES = buildTemplates();

  function cosineSim(vec, vecNorm, template) {
    if (vecNorm === 0) return 0;
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += vec[i] * template.vec[i];
    return dot / (vecNorm * template.norm);
  }

  /* ---------- Bin -> pitch-class map (precomputed per sampleRate/frameSize) ---------- */
  function buildBinMap(sampleRate, frameSize) {
    const nBins = frameSize / 2;
    const map = new Int8Array(nBins).fill(-1);
    for (let k = 1; k < nBins; k++) {
      const freq = (k * sampleRate) / frameSize;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = (((Math.round(midi) % 12) + 12) % 12);
      map[k] = pc;
    }
    return map;
  }

  function hannWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    return w;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* ---------- Core: analyze raw mono Float32 samples at a known sample rate ---------- */
  // Exposed separately from file/browser decoding so it is unit-testable with synthetic audio.
  async function analyzeSamples(samples, sampleRate, onProgress) {
    const maxSamples = Math.min(samples.length, MAX_ANALYZE_SECONDS * sampleRate);
    const window = hannWindow(FRAME_SIZE);
    const binMap = buildBinMap(sampleRate, FRAME_SIZE);
    const hopTime = HOP_SIZE / sampleRate;

    const frameCount = Math.max(0, Math.floor((maxSamples - FRAME_SIZE) / HOP_SIZE) + 1);
    const frameLabels = new Array(frameCount);
    const frameEnergies = new Float32Array(frameCount);

    const re = new Float32Array(FRAME_SIZE);
    const im = new Float32Array(FRAME_SIZE);
    const chroma = new Float32Array(12);

    for (let f = 0; f < frameCount; f++) {
      const start = f * HOP_SIZE;
      chroma.fill(0);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const s = start + i < maxSamples ? samples[start + i] : 0;
        re[i] = s * window[i];
        im[i] = 0;
      }
      fft(re, im);
      let energy = 0;
      for (let k = 1; k < FRAME_SIZE / 2; k++) {
        const pc = binMap[k];
        if (pc < 0) continue;
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        chroma[pc] += mag;
        energy += mag;
      }
      frameEnergies[f] = energy;

      let vecNorm = 0;
      for (let i = 0; i < 12; i++) vecNorm += chroma[i] * chroma[i];
      vecNorm = Math.sqrt(vecNorm);

      let bestName = "N";
      let bestScore = -1;
      for (const t of TEMPLATES) {
        const score = cosineSim(chroma, vecNorm, t);
        if (score > bestScore) {
          bestScore = score;
          bestName = t.name;
        }
      }
      frameLabels[f] = { name: bestName, score: bestScore };

      if (onProgress && f % 40 === 0) {
        onProgress(Math.min(0.85, (f / frameCount) * 0.85), "コードを解析中…");
        await yieldToUI();
      }
    }

    // silence threshold: track全体の平均エネルギーの一定割合を下回るフレームは無音扱い
    let meanEnergy = 0;
    for (let f = 0; f < frameCount; f++) meanEnergy += frameEnergies[f];
    meanEnergy = frameCount ? meanEnergy / frameCount : 0;
    const silenceThresh = meanEnergy * 0.22;

    const rawLabels = frameLabels.map((l, i) =>
      frameEnergies[i] < silenceThresh || l.score < 0.35 ? "N" : l.name
    );

    if (onProgress) { onProgress(0.9, "ゆらぎを補正中…"); await yieldToUI(); }

    // majority-vote smoothing over a small sliding window to remove jitter
    const smoothed = new Array(rawLabels.length);
    const half = Math.floor(SMOOTH_WINDOW / 2);
    for (let i = 0; i < rawLabels.length; i++) {
      const counts = new Map();
      for (let j = Math.max(0, i - half); j <= Math.min(rawLabels.length - 1, i + half); j++) {
        const lbl = rawLabels[j];
        counts.set(lbl, (counts.get(lbl) || 0) + 1);
      }
      let best = rawLabels[i], bestCount = -1;
      counts.forEach((c, lbl) => { if (c > bestCount) { bestCount = c; best = lbl; } });
      smoothed[i] = best;
    }

    if (onProgress) { onProgress(0.95, "コード進行にまとめています…"); await yieldToUI(); }

    // run-length encode into segments, dropping silence
    const segments = [];
    for (let i = 0; i < smoothed.length; i++) {
      const t0 = i * hopTime;
      const t1 = t0 + hopTime;
      const label = smoothed[i];
      const last = segments[segments.length - 1];
      if (last && last.chord === label) {
        last.end = t1;
      } else {
        segments.push({ chord: label, start: t0, end: t1 });
      }
    }

    // merge very short segments into the previous one (reduces flicker artifacts)
    const merged = [];
    for (const seg of segments) {
      const prev = merged[merged.length - 1];
      if (prev && seg.end - seg.start < MIN_SEGMENT_SEC) {
        prev.end = seg.end;
      } else {
        merged.push({ ...seg });
      }
    }
    // re-merge any now-adjacent equal chords created by the pass above
    const final = [];
    for (const seg of merged) {
      const prev = final[final.length - 1];
      if (prev && prev.chord === seg.chord) {
        prev.end = seg.end;
      } else {
        final.push(seg);
      }
    }

    const chordsOnly = final.filter((s) => s.chord !== "N");

    if (onProgress) onProgress(1, "完了");
    return chordsOnly;
  }

  function yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /* ---------- Browser-facing entry point: decode + resample + analyze ---------- */
  async function analyzeFile(file, onProgress) {
    if (onProgress) onProgress(0, "音源を読み込み中…");
    const arrayBuffer = await file.arrayBuffer();

    const AC = window.AudioContext || window.webkitAudioContext;
    const decodeCtx = new AC();
    let decoded;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      decodeCtx.close && decodeCtx.close();
    }

    if (onProgress) onProgress(0.05, "モノラル・ダウンサンプリング中…");
    const duration = Math.min(decoded.duration, MAX_ANALYZE_SECONDS);
    const targetLength = Math.ceil(duration * TARGET_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    const merger = offline.createChannelMerger ? null : null;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);

    const segments = await analyzeSamples(samples, TARGET_SAMPLE_RATE, onProgress);
    return segments;
  }

  return { analyzeFile, analyzeSamples, formatTime, FRAME_SIZE, HOP_SIZE, TARGET_SAMPLE_RATE };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ChordDetect;
}

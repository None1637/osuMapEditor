// src/osu/fft.ts
function fft(re, im) {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & n - 1) !== 0) throw new Error("fft: length must be power of 2");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const xr = re[b] * cwr - im[b] * cwi;
        const xi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}
function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  return w;
}

// src/osu/bpmDetect.ts
var ANALYSIS_SR = 11025;
var WIN = 512;
var HOP = 64;
function mixDownResample(buf, targetSr = ANALYSIS_SR) {
  const sr = buf.sampleRate;
  const n = buf.length;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  if (sr === targetSr) {
    const out2 = new Float32Array(n);
    for (let i = 0; i < n; i++) out2[i] = (ch0[i] + ch1[i]) * 0.5;
    return out2;
  }
  const ratio = sr / targetSr;
  const m = Math.floor(n / ratio);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    const a = j < n ? j : n - 1, b = j + 1 < n ? j + 1 : n - 1;
    out[i] = ((ch0[a] + ch1[a]) * (1 - f) + (ch0[b] + ch1[b]) * f) * 0.5;
  }
  return out;
}
function onsetEnvelope(samples, sr, win = WIN, hop = HOP) {
  const frames = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  const hann = hannWindow(win);
  const re = new Float32Array(win), im = new Float32Array(win);
  const bins = win >> 1;
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) {
      re[i] = samples[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    for (let b = 0; b < bins; b++) mag[b] = Math.log1p(100 * Math.hypot(re[b], im[b]) / (1 + b / 24));
    if (prev === null) {
      prev = mag;
      continue;
    }
    let flux = 0;
    for (let b = 0; b < bins; b++) {
      const d = mag[b] - prev[b];
      if (d > 0) flux += d;
    }
    prev = mag;
    env[f] = flux;
  }
  const w = Math.max(1, Math.round(1e3 / (hop / sr * 1e3)));
  const norm = new Float32Array(frames);
  let run = 0;
  const q = [];
  let maxV = 0;
  for (let i = 0; i < frames; i++) {
    q.push(env[i]);
    run += env[i];
    if (q.length > w) run -= q.shift();
    const v = Math.max(0, env[i] - run / q.length * 0.7);
    norm[i] = v;
    if (v > maxV) maxV = v;
  }
  if (maxV > 0) for (let i = 0; i < frames; i++) norm[i] /= maxV;
  return { env: norm, hopMs: hop / sr * 1e3 };
}
function acfFrac(seg, lag) {
  const n = seg.length;
  const l0 = Math.floor(lag), f = lag - l0;
  let s = 0, cnt = 0;
  for (let i = 0; i + l0 + 1 < n; i++) {
    s += seg[i] * (seg[i + l0] * (1 - f) + seg[i + l0 + 1] * f);
    cnt++;
  }
  return cnt ? s / cnt : 0;
}
function trackScore(env, P) {
  if (P < 2 || env.length < P * 3) return 0;
  let t = 0;
  {
    let bv = -1;
    const end = Math.min(env.length - 1, Math.round(P * 2));
    for (let i = 0; i <= end; i++) if (env[i] > bv) {
      bv = env[i];
      t = i;
    }
  }
  const beats = [];
  while (t < env.length) {
    beats.push(t);
    const j0 = Math.round(t + P * 0.85), j1 = Math.min(env.length - 1, Math.round(t + P * 1.15));
    if (j0 > j1) break;
    let bj = j0, bv = -1;
    for (let j = j0; j <= j1; j++) if (env[j] > bv) {
      bv = env[j];
      bj = j;
    }
    t = bj;
  }
  if (beats.length < 3) return 0;
  const meanEnv = beats.reduce((s, b) => s + env[b], 0) / beats.length;
  let varSum = 0;
  for (const b of beats) {
    const d = env[b] - meanEnv;
    varSum += d * d;
  }
  const cv = Math.sqrt(varSum / beats.length) / (meanEnv || 1);
  let peakE = 0, unexplained = 0;
  const thresh = meanEnv * 0.75;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] >= thresh) {
      peakE += env[i];
      let onGrid = false;
      for (const b of beats) if (Math.abs(b - i) <= P * 0.12) {
        onGrid = true;
        break;
      }
      if (!onGrid) unexplained += env[i];
    }
  }
  const resid = peakE > 0 ? unexplained / peakE : 1;
  return meanEnv * (1 - resid) * (1 - Math.min(0.5, cv));
}
function acfCandidates(seg, minLag, maxLag) {
  maxLag = Math.min(maxLag, (seg.length >> 1) - 2);
  if (maxLag <= minLag + 1) return [];
  const acf = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= maxLag * 2 && lag < seg.length - 2; lag++) acf[lag] = acfFrac(seg, lag);
  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = acf[lag] + 0.5 * acf[lag * 2];
    if (s >= acf[lag - 1] + 0.5 * acf[(lag - 1) * 2] && s > acf[lag + 1] + 0.5 * acf[(lag + 1) * 2]) peaks.push(lag);
  }
  peaks.sort((a, b) => acf[b] + 0.5 * acf[b * 2] - (acf[a] + 0.5 * acf[a * 2]));
  const cand = peaks.slice(0, 8);
  if (!cand.length) return [];
  let bestAcf = 0;
  const refd = [];
  for (const c of cand) {
    let bl = c, bs = -Infinity;
    for (let d = -1; d <= 1.0001; d += 0.1) {
      const l = c + d;
      if (l < minLag || l > maxLag) continue;
      const s = acfFrac(seg, l) + 0.5 * acfFrac(seg, l * 2);
      if (s > bs) {
        bs = s;
        bl = l;
      }
    }
    if (bs > bestAcf) bestAcf = bs;
    refd.push({ lag: bl, adj: trackScore(seg, bl) });
  }
  if (bestAcf <= 2e-3) return [];
  refd.sort((a, b) => b.adj - a.adj);
  return refd.slice(0, 6);
}

// verifier/v540/realFixtures.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var root = __dirname;
var realFixtures = [
  {
    name: "Yoko",
    decodedDir: "(14) - Drop it! Yoko!",
    osuFile: "fixtures/(14) - Drop it! Yoko!/a - Drop it! Yoko! (a) [14].osu",
    annotatedBpm: 6e4 / 426.136,
    annotatedVariable: false
  },
  {
    name: "Turupeta",
    decodedDir: "09 Turupeta",
    osuFile: "fixtures/09 Turupeta/Silver Forest - Turupeta (None1637) [Lunatic].osu",
    annotatedBpm: 180,
    annotatedVariable: false
  },
  {
    name: "Nare",
    decodedDir: "1041086 YURRY CANON - Dareka no Shinzou ni Nareta Nara",
    osuFile: "fixtures/1041086 YURRY CANON - Dareka no Shinzou ni Nareta Nara/YURRY CANON - Dareka no Shinzou ni Nareta Nara (BinFhone) [Heart].osu",
    annotatedBpm: 6e4 / 413.793103448276,
    annotatedVariable: false
    // 仅谱面如此；旧独立 ACF 研究提示 outro 可能真实加速。
  },
  {
    name: "Carnival",
    decodedDir: "t+pazolite - Kick-ass Kung-fu Carnival",
    osuFile: "fixtures/t+pazolite - Kick-ass Kung-fu Carnival/t+pazolite - Kick-ass Kung-fu Carnival (None1637) [Extra].osu",
    annotatedBpm: 220,
    annotatedVariable: true
  }
];
function loadRealBuffer(fixture) {
  const dir = (0, import_node_path.join)(root, "decoded", fixture.decodedDir);
  const meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, "meta.json"), "utf8"));
  const channels = Array.from({ length: meta.numberOfChannels }, (_, ch) => {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, `ch${ch}.f32`));
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  });
  return {
    sampleRate: meta.sampleRate,
    length: meta.length,
    numberOfChannels: meta.numberOfChannels,
    getChannelData: (ch) => channels[ch]
  };
}

// verifier/v540/window-diagnostic.ts
var times = {
  Yoko: [10, 40, 80, 120],
  Turupeta: [10, 40, 80, 120, 150],
  Nare: [10, 60, 120, 180, 205, 210, 215, 220],
  Carnival: [10, 60, 120, 180, 186, 188, 190, 192, 194, 196, 198, 200, 204, 208, 212, 216, 220, 224, 230, 250, 280]
};
var fold = (bpm) => {
  while (bpm > 240) bpm /= 2;
  while (bpm < 60) bpm *= 2;
  return bpm;
};
var monoAt = (buf, ch) => ({
  sampleRate: buf.sampleRate,
  numberOfChannels: 1,
  length: buf.length,
  getChannelData: () => buf.getChannelData(ch)
});
for (const fixture of realFixtures) {
  if (process.argv[2] && process.argv[2] !== fixture.name) continue;
  const buf = loadRealBuffer(fixture);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const { env, hopMs } = onsetEnvelope(mixDownResample(monoAt(buf, ch)), 11025);
    const minLag = Math.max(2, Math.round(6e4 / 440 / hopMs));
    const maxLag = Math.ceil(6e4 / 60 / hopMs) + 1;
    const candidates = (segment) => acfCandidates(segment, minLag, Math.min(maxLag, (segment.length >> 1) - 2)).map((c) => ({
      bpm: +(6e4 / c.lag / hopMs).toFixed(2),
      folded: +fold(6e4 / c.lag / hopMs).toFixed(2),
      score: +c.adj.toFixed(4)
    }));
    console.log(JSON.stringify({ name: fixture.name, ch, scope: "global", candidates: candidates(env) }));
    for (const time of times[fixture.name]) {
      const center = Math.round(time * 1e3 / hopMs);
      const half = Math.round(2e3 / hopMs);
      const segment = env.subarray(Math.max(0, center - half), Math.min(env.length, center + half));
      console.log(JSON.stringify({ name: fixture.name, ch, scope: "window", time, candidates: candidates(segment) }));
    }
  }
}

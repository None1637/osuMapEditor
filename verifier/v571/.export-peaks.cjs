// verifier/v571/export-peaks.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

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
var WIN = 512;
var HOP = 64;
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

// verifier/v571/export-peaks.ts
var root = __dirname;
var config = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "experiment.json"), "utf8"));
if (config.status !== "frozen_before_diagnostic_evaluation" || config.productionCodeChanged !== false) {
  throw new Error("E12\u51BB\u7ED3\u914D\u7F6E\u6539\u53D8");
}
var oldRows = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "../v558/candidates.json"), "utf8"));
function loadAudio(id) {
  const directory = (0, import_node_path.join)(root, "../v541/decoded", id);
  const meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, "meta.json"), "utf8"));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}
function peaks(envelope) {
  const radius = Math.round(5 / envelope.hopMs), output = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < 0.02) continue;
    let maximum = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(envelope.env.length - 1, i + radius); j++) {
      if (envelope.env[j] > center || envelope.env[j] === center && j < i) {
        maximum = false;
        break;
      }
    }
    if (!maximum) continue;
    const left = envelope.env[i - 1], right = envelope.env[i + 1], denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    output.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output;
}
function nearest(peakTimes, target) {
  let low = 0, high = peakTimes.length;
  while (low < high) {
    const middle = low + high >> 1;
    if (peakTimes[middle] < target - 10) low = middle + 1;
    else high = middle;
  }
  let best = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + 10; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - target;
}
(0, import_node_fs.mkdirSync)((0, import_node_path.join)(root, "per-sample"), { recursive: true });
var parityRows = [];
for (const id of config.sampleIds) {
  const { samples, sampleRate } = loadAudio(id);
  const full = { ...onsetEnvelope(samples, sampleRate, 256, 11), biasMs: 3 * 256 / 4 / sampleRate * 1e3 };
  const fullPeaks = peaks(full);
  const rows = oldRows.rows.filter((row) => row.sampleId === id);
  for (const row of rows) {
    const reproduced = nearest(fullPeaks, row.targetMs);
    const equal = reproduced === null || row.fullResidualMs === null ? reproduced === row.fullResidualMs : reproduced === row.fullResidualMs;
    if (!equal) throw new Error(`${row.segmentId} full parity\u5931\u8D25: ${reproduced} != ${row.fullResidualMs}`);
    parityRows.push({ segmentId: row.segmentId, expectedResidualMs: row.fullResidualMs, reproducedResidualMs: reproduced });
  }
  (0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "per-sample", `${id}.json`), JSON.stringify({
    sampleId: id,
    sampleRate,
    envelopeFrames: full.env.length,
    peakCount: fullPeaks.length,
    fullPeakMs: fullPeaks
  }), "utf8");
  console.log(JSON.stringify({ sampleId: id, frames: full.env.length, fullPeaks: fullPeaks.length, parityObjects: rows.length }));
}
if (parityRows.length !== 90) throw new Error(`parity\u7269\u4EF6\u6570=${parityRows.length}`);
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "peak-export-parity.json"), JSON.stringify({
  version: "v571-full-peak-export-parity-v1",
  passed: true,
  comparisonRows: parityRows.length,
  exactResidualEquality: true,
  rows: parityRows
}, null, 2), "utf8");
console.log("V571_FULL_PEAKS_EXPORTED exactParityObjects=90");

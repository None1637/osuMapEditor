// verifier/v566/run.ts
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

// verifier/v566/run.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v563 = (0, import_node_path.join)(root, "../v563");
var config = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "experiment.json"), "utf8"));
if (config.productionCodeChanged !== false) throw new Error("\u751F\u4EA7\u4EE3\u7801\u6807\u5FD7\u6539\u53D8");
var source = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v563, "calibrated-candidates.json"), "utf8"));
function loadAudio(id) {
  const directory = (0, import_node_path.join)(v541, "decoded", id);
  const meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, "meta.json"), "utf8"));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}
var outputRows = [];
for (const id of config.sampleIds) {
  const { samples, sampleRate } = loadAudio(id);
  const envelope = onsetEnvelope(samples, sampleRate, config.windowSamples, config.hopSamples);
  const biasMs = 3 * config.windowSamples / 4 / sampleRate * 1e3;
  let refinedCount = 0;
  for (const row of source.rows.filter((item) => item.sampleId === id)) {
    const original = row.fullCandidateAbsoluteMs;
    if (original === null) {
      outputRows.push({
        ...row,
        e7RawSlopeIndex: null,
        e7RawSlopeValue: null,
        e7RawCandidateAbsoluteMs: null,
        e7RawResidualMs: null
      });
      continue;
    }
    let bestIndex = null, bestSlope = -Infinity;
    for (let i = 1; i < envelope.env.length; i++) {
      const timeMs = i * envelope.hopMs + biasMs;
      if (timeMs < original - config.localRuleParameters.risingSearchMs) continue;
      if (timeMs > original) break;
      const slope = envelope.env[i] - envelope.env[i - 1];
      if (slope > bestSlope) {
        bestSlope = slope;
        bestIndex = i;
      }
    }
    if (bestIndex === null) throw new Error(`${row.segmentId} \u539F\u5CF0\u524D\u7A97\u53E3\u6CA1\u6709\u5305\u7EDC\u5E27`);
    const refined = (bestIndex - 0.5) * envelope.hopMs + biasMs;
    const targetMs = row.targetMs;
    outputRows.push({
      ...row,
      e7RawSlopeIndex: bestIndex,
      e7RawSlopeValue: bestSlope,
      e7RawCandidateAbsoluteMs: refined,
      e7RawResidualMs: refined - targetMs
    });
    refinedCount++;
  }
  console.log(JSON.stringify({ id, refinedCount, hopMs: envelope.hopMs, biasMs }));
}
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "raw-candidates.json"), JSON.stringify({
  version: "v566-local-rising-edge-e7-raw-candidates-v1",
  configuration: config,
  rows: outputRows
}, null, 2));
console.log(`V566_RAW_CANDIDATES_WRITTEN objects=${outputRows.length}`);

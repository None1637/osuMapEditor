// verifier/v566/check-raw.ts
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

// verifier/v566/check-raw.ts
var root = __dirname;
var config = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "experiment.json"), "utf8"));
var payload = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "raw-candidates.json"), "utf8"));
var failures = [];
var refinedCount = 0;
var maximumTimeDifferenceMs = 0;
for (const id of config.sampleIds) {
  const directory = (0, import_node_path.join)(root, "../v541/decoded", id);
  const meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, "meta.json"), "utf8"));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  const envelope = onsetEnvelope(samples, meta.sampleRate, config.windowSamples, config.hopSamples);
  const biasMs = 3 * config.windowSamples / 4 / meta.sampleRate * 1e3;
  for (const row of payload.rows.filter((item) => item.sampleId === id)) {
    if (row.fullCandidateAbsoluteMs === null) {
      if (row.e7RawCandidateAbsoluteMs !== null || row.e7RawSlopeIndex !== null) failures.push(`${row.segmentId}/\u7F3A\u5931\u5019\u9009\u88AB\u65B0\u589E`);
      continue;
    }
    const eligible = [];
    for (let i = 1; i < envelope.env.length; i++) {
      const timeMs = i * envelope.hopMs + biasMs;
      if (timeMs >= row.fullCandidateAbsoluteMs - config.localRuleParameters.risingSearchMs && timeMs <= row.fullCandidateAbsoluteMs) eligible.push(i);
      if (timeMs > row.fullCandidateAbsoluteMs) break;
    }
    if (!eligible.length) {
      failures.push(`${row.segmentId}/\u65E0\u6709\u6548\u5E27`);
      continue;
    }
    const expectedSlope = Math.max(...eligible.map((i) => envelope.env[i] - envelope.env[i - 1]));
    const expectedIndex = eligible.find((i) => envelope.env[i] - envelope.env[i - 1] === expectedSlope);
    const expectedTime = (expectedIndex - 0.5) * envelope.hopMs + biasMs;
    if (row.e7RawSlopeIndex !== expectedIndex) failures.push(`${row.segmentId}/\u659C\u7387\u7D22\u5F15 ${row.e7RawSlopeIndex} != ${expectedIndex}`);
    if (row.e7RawSlopeValue !== expectedSlope) failures.push(`${row.segmentId}/\u659C\u7387\u503C\u4E0D\u4E00\u81F4`);
    const difference = Math.abs(row.e7RawCandidateAbsoluteMs - expectedTime);
    maximumTimeDifferenceMs = Math.max(maximumTimeDifferenceMs, difference);
    if (difference > 1e-9) failures.push(`${row.segmentId}/\u7EDD\u5BF9\u65F6\u95F4\u5DEE ${difference}`);
    if (Math.abs(row.e7RawResidualMs - (expectedTime - row.targetMs)) > 1e-9) failures.push(`${row.segmentId}/\u6B8B\u5DEE\u9519\u8BEF`);
    refinedCount++;
  }
}
if (payload.rows.length !== 90 || refinedCount !== 83) failures.push(`\u6570\u91CF\u9519\u8BEF ${payload.rows.length}/${refinedCount}`);
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "raw-validation.json"), JSON.stringify({
  version: "v566-raw-rising-edge-independent-recheck-v1",
  passed: failures.length === 0,
  objects: payload.rows.length,
  refinedCount,
  maximumTimeDifferenceMs,
  failures
}, null, 2));
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`ok: 90\u884C\u539F\u59CB\u5019\u9009\uFF0C83\u4E2A\u4E0A\u5347\u6CBF\u5747\u4ECE\u97F3\u9891\u72EC\u7ACB\u91CD\u5EFA\uFF0C\u6700\u5927\u65F6\u95F4\u5DEE=${maximumTimeDifferenceMs}`);
console.log("V566_RAW_CANDIDATES_VALIDATION_PASSED");

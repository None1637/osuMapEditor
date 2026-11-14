// verifier/v549/analyze-ceiling.ts
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
function onsetEnvelope(samples2, sr, win = WIN, hop = HOP) {
  const frames = Math.max(0, Math.floor((samples2.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  const hann = hannWindow(win);
  const re = new Float32Array(win), im = new Float32Array(win);
  const bins = win >> 1;
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) {
      re[i] = samples2[off + i] * hann[i];
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

// verifier/v549/analyze-ceiling.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v548 = (0, import_node_path.join)(root, "../v548");
var HOP2 = 11;
var WIN2 = 256;
var PHASE_MIN = -30;
var PHASE_MAX = 30;
var PHASE_STEP = 0.5;
var SEARCH_RADIUS_MS = 10;
var peakConfigs = [
  { name: "sup20-th020-current", suppressionMs: 20, threshold: 0.02 },
  { name: "sup10-th020", suppressionMs: 10, threshold: 0.02 },
  { name: "sup05-th020", suppressionMs: 5, threshold: 0.02 },
  { name: "sup00-th020", suppressionMs: 0, threshold: 0.02 },
  { name: "sup10-th010", suppressionMs: 10, threshold: 0.01 },
  { name: "sup05-th010", suppressionMs: 5, threshold: 0.01 },
  { name: "sup10-th005", suppressionMs: 10, threshold: 5e-3 },
  { name: "sup05-th005", suppressionMs: 5, threshold: 5e-3 }
];
function loadAudio(id) {
  const directory = (0, import_node_path.join)(v541, "decoded", id), meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, "meta.json"), "utf8"));
  const samples2 = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples2.length; i++) samples2[i] += data[i] / meta.numberOfChannels;
  }
  return { samples: samples2, sampleRate: meta.sampleRate, durationMs: meta.durationMs };
}
function peaks(envelope, config) {
  const radius = Math.round(config.suppressionMs / envelope.hopMs), output2 = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < config.threshold) continue;
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
    output2.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output2;
}
function nearest(peakTimes, target, radius) {
  let low = 0, high = peakTimes.length;
  while (low < high) {
    const middle = low + high >> 1;
    if (peakTimes[middle] < target - radius) low = middle + 1;
    else high = middle;
  }
  let best = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + radius; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - target;
}
function parseHits(osu, redlines) {
  const section = osu.split("[HitObjects]")[1]?.split("[")[0] ?? "";
  const times = [...new Set(section.split(/\r?\n/).map((row) => Number(row.trim().split(",")[2])).filter((time) => Number.isFinite(time) && time >= 0).map((time) => Math.round(time)))].sort((a, b) => a - b);
  return times.map((timeMs, index) => {
    let segment = -1;
    for (let i = 0; i < redlines.length; i++) if (timeMs >= redlines[i].timeMs && timeMs < redlines[i].endMs) {
      segment = i;
      break;
    }
    const active = segment >= 0 ? redlines[segment] : void 0;
    return { timeMs, index, segment, region: (active?.durationMs ?? Infinity) <= 1200 ? "dense" : "stable" };
  });
}
function metrics(residuals) {
  const matched = residuals.filter((value) => value !== null);
  return { count: residuals.length, matched: matched.length, within5: matched.filter((value) => Math.abs(value) <= 5).length };
}
function summarize(hits, residuals) {
  const output2 = { all: metrics(residuals), stable: metrics(residuals.filter((_, index) => hits[index].region === "stable")) };
  const dense = residuals.filter((_, index) => hits[index].region === "dense");
  if (dense.length) output2.dense = metrics(dense);
  return output2;
}
function sumMetrics(target, source) {
  if (!source) return;
  target.count += source.count;
  target.matched += source.matched;
  target.within5 += source.within5;
}
function emptySummary(hasDense = true) {
  const empty = () => ({ count: 0, matched: 0, within5: 0 });
  const output2 = { all: empty(), stable: empty() };
  if (hasDense) output2.dense = empty();
  return output2;
}
function addSummary(target, source) {
  sumMetrics(target.all, source.all);
  sumMetrics(target.stable, source.stable);
  sumMetrics(target.dense, source.dense);
}
function finalizeSummary(summary) {
  for (const region of ["all", "stable", "dense"]) {
    const item = summary[region];
    if (!item) continue;
    Object.assign(item, {
      within5msAll: item.count ? item.within5 / item.count : null,
      matchCoverage: item.count ? item.matched / item.count : null
    });
  }
  return summary;
}
function segmentOracle(hits, peakTimes, delay) {
  const output2 = new Array(hits.length).fill(null);
  const segments = /* @__PURE__ */ new Map();
  hits.forEach((hit, index) => {
    if (!segments.has(hit.segment)) segments.set(hit.segment, []);
    segments.get(hit.segment).push(index);
  });
  for (const [segment, indices] of segments) {
    if (segment < 0) {
      for (const index of indices) output2[index] = nearest(peakTimes, hits[index].timeMs + delay, SEARCH_RADIUS_MS);
      continue;
    }
    let bestPhase = 0, bestCount = -1, bestResiduals = [];
    for (let phase = PHASE_MIN; phase <= PHASE_MAX + 1e-9; phase += PHASE_STEP) {
      const residuals = indices.map((index) => nearest(peakTimes, hits[index].timeMs + delay + phase, SEARCH_RADIUS_MS));
      const count = residuals.filter((value) => value !== null && Math.abs(value) <= 5).length;
      if (count > bestCount) {
        bestCount = count;
        bestPhase = phase;
        bestResiduals = residuals;
      }
    }
    indices.forEach((hitIndex, i) => {
      output2[hitIndex] = bestResiduals[i];
    });
    void bestPhase;
  }
  return output2;
}
var selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "selection.json"), "utf8"));
var samples = [];
for (const selected of selection.samples) {
  const id = selected.id;
  const previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "per-sample", `${id}.json`), "utf8"));
  const redlines = previous.redlines;
  const delay = previous.globalDelay.delayMs;
  const chosen = previous.configurations.find((config) => config.aggregate === "top2" && config.method === "dp");
  const { samples: audio, sampleRate, durationMs } = loadAudio(id);
  const rawEnvelope = onsetEnvelope(audio, sampleRate, WIN2, HOP2);
  const envelope = { ...rawEnvelope, biasMs: 3 * WIN2 / 4 / sampleRate * 1e3 };
  const osu = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "samples", id, selected.beatmapFile), "utf8");
  const hits = parseHits(osu, redlines);
  const configurations = [];
  for (const config of peakConfigs) {
    const peakTimes = peaks(envelope, config);
    const actualResiduals = hits.map((hit) => {
      const fold = hit.index % 2 === 0 ? "odd" : "even";
      const phase = chosen.phases.actual[fold][hit.segment] ?? 0;
      return nearest(peakTimes, hit.timeMs + delay + phase, SEARCH_RADIUS_MS);
    });
    const baselineResiduals = hits.map((hit) => nearest(peakTimes, hit.timeMs + delay, SEARCH_RADIUS_MS));
    const noteOracleResiduals = hits.map((hit) => nearest(peakTimes, hit.timeMs + delay, PHASE_MAX + 5) === null ? null : 0);
    const output2 = {
      ...config,
      peakCount: peakTimes.length,
      actual: summarize(hits, actualResiduals),
      baseline: summarize(hits, baselineResiduals),
      noteOracle: summarize(hits, noteOracleResiduals)
    };
    if (config.name === "sup20-th020-current") output2.segmentOracle = summarize(hits, segmentOracle(hits, peakTimes, delay));
    configurations.push(output2);
  }
  samples.push({ id, selectionGroup: selected.selectionGroup, referenceVariable: selected.referenceVariable, globalDelay: previous.globalDelay, hitCount: hits.length, denseHitCount: hits.filter((hit) => hit.region === "dense").length, configurations });
  console.log(JSON.stringify({ id, hits: hits.length, current: configurations[0].actual.all, segmentOracle: configurations[0].segmentOracle.all, noteOracle: configurations[0].noteOracle.all }));
}
var aggregate = [];
for (const config of peakConfigs) {
  for (const subset of ["all", "calibrationNormal"]) {
    const selectedSamples = samples.filter((sample) => subset === "all" || Math.abs(sample.globalDelay.delayMs) < 60 && sample.globalDelay.delayMs >= 0);
    const combined = { actual: emptySummary(), baseline: emptySummary(), noteOracle: emptySummary() };
    if (config.name === "sup20-th020-current") combined.segmentOracle = emptySummary();
    for (const sample of selectedSamples) {
      const source = sample.configurations.find((item) => item.name === config.name);
      for (const kind of Object.keys(combined)) addSummary(combined[kind], source[kind]);
    }
    for (const kind of Object.keys(combined)) finalizeSummary(combined[kind]);
    aggregate.push({ name: config.name, subset, songCount: selectedSamples.length, ...combined });
  }
}
var output = {
  version: "v549-ceiling-diagnostic-v1",
  status: "post_hoc_oracle_and_peak_sensitivity_not_independent_accuracy",
  target: "80% of hitobject onset measurements within 5 ms",
  phaseSource: "v548 top2/dp actualCrossFit; no refitting in this diagnostic",
  oracleDefinition: "segmentOracle chooses the best phase on the same notes being scored; noteOracle chooses an independent phase for every note; neither is a valid predictor",
  sampleCount: samples.length,
  aggregate,
  samples
};
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "ceiling-results.json"), JSON.stringify(output, null, 2));
console.log("V549_CEILING_ANALYSIS_WRITTEN");

// verifier/v555/export-candidates.ts
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

// verifier/v555/export-candidates.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v548 = (0, import_node_path.join)(root, "../v548");
var HOP2 = 11;
var WIN2 = 256;
var THRESHOLD = 0.02;
var SUPPRESSION_MS = 5;
var SAMPLE_IDS = ["sample-003", "sample-042", "sample-095"];
var BAND_ORDER = ["full", "max", "top2", "low", "mid", "high"];
var EDGE_ORDER = [["peak", 1], ["edge50", 0.5], ["edge25", 0.25]];
var configs = BAND_ORDER.flatMap((band) => EDGE_ORDER.map(([edge, fraction]) => ({ name: `${band}-${edge}`, band, edge, fraction })));
var selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "../v550/selection.json"), "utf8"));
var segments = selection.segments;
var v548Selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "selection.json"), "utf8"));
var predictions = Object.fromEntries(configs.map((config) => [config.name, []]));
function loadAudio(id) {
  const directory = (0, import_node_path.join)(v541, "decoded", id), meta = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, "meta.json"), "utf8"));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}
function normalize(raw, hopMs) {
  const width = Math.max(1, Math.round(1e3 / hopMs));
  const output = new Float32Array(raw.length), queue = [];
  let running = 0, maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]);
    running += raw[i];
    if (queue.length > width) running -= queue.shift();
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    output[i] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}
function multiBand(samples, sampleRate) {
  const frames = Math.max(0, Math.floor((samples.length - WIN2) / HOP2) + 1);
  const raw = Array.from({ length: 4 }, () => new Float32Array(frames));
  const hann = hannWindow(WIN2), re = new Float32Array(WIN2), im = new Float32Array(WIN2);
  let previous = null;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP2;
    for (let i = 0; i < WIN2; i++) {
      re[i] = samples[offset + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const magnitude = new Float32Array(WIN2 / 2);
    for (let bin = 0; bin < magnitude.length; bin++) magnitude[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]) / (1 + bin / 24));
    if (previous !== null) {
      const sums = [0, 0, 0, 0];
      for (let bin = 0; bin < magnitude.length; bin++) {
        const difference = Math.max(0, magnitude[bin] - previous[bin]);
        sums[0] += difference;
        if (bin >= 1 && bin <= 8) sums[1] += difference;
        if (bin >= 9 && bin <= 32) sums[2] += difference;
        if (bin >= 33) sums[3] += difference;
      }
      for (let band = 0; band < 4; band++) raw[band][frame] = sums[band];
    }
    previous = magnitude;
  }
  const hopMs = HOP2 / sampleRate * 1e3, biasMs = 3 * WIN2 / 4 / sampleRate * 1e3;
  const names = ["full", "low", "mid", "high"];
  const output = Object.fromEntries(names.map((name, index) => [name, { name, env: normalize(raw[index], hopMs), hopMs, biasMs }]));
  output.full = { ...onsetEnvelope(samples, sampleRate, WIN2, HOP2), biasMs };
  const max = new Float32Array(frames), top2 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const values = names.map((name) => output[name].env[i]).sort((a, b) => b - a);
    max[i] = values[0];
    top2[i] = (values[0] + values[1]) / 2;
  }
  output.max = { env: max, hopMs, biasMs };
  output.top2 = { env: top2, hopMs, biasMs };
  return output;
}
function peaks(envelope) {
  const radius = Math.round(SUPPRESSION_MS / envelope.hopMs), output = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < THRESHOLD) continue;
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
    output.push({ index: i, delta, timeMs: (i + delta) * envelope.hopMs + envelope.biasMs });
  }
  return output;
}
function nearest(peakTimes, target) {
  let low = 0, high = peakTimes.length;
  while (low < high) {
    const middle = low + high >> 1;
    if (peakTimes[middle].timeMs < target - 10) low = middle + 1;
    else high = middle;
  }
  let best = null;
  for (let index = low; index < peakTimes.length && peakTimes[index].timeMs <= target + 10; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak.timeMs - target) < Math.abs(best.timeMs - target)) best = peak;
  }
  return best;
}
function leadingEdge(env, peakIndex, fraction, hopMs, biasMs) {
  const threshold = env[peakIndex] * fraction, earliest = Math.max(0, peakIndex - Math.round(25 / hopMs));
  let crossing = earliest;
  for (let index = peakIndex - 1; index >= earliest; index--) if (env[index] <= threshold) {
    crossing = index;
    break;
  }
  if (crossing >= peakIndex) return peakIndex * hopMs + biasMs;
  const left = env[crossing], right = env[crossing + 1];
  const ratio = right <= left ? 0 : Math.max(0, Math.min(1, (threshold - left) / (right - left)));
  return (crossing + ratio) * hopMs + biasMs;
}
function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
function highPeakFeatures(envelopes, peak, target) {
  if (!peak) return { candidatePresent: false };
  const high = envelopes.high, index = peak.index, hopMs = high.hopMs;
  const before = Math.max(0, index - Math.round(25 / hopMs)), after = Math.min(high.env.length - 1, index + Math.round(25 / hopMs));
  const leftMin = Math.min(...high.env.subarray(before, index + 1)), rightMin = Math.min(...high.env.subarray(index, after + 1));
  const localMean = mean(high.env.subarray(Math.max(0, index - Math.round(50 / hopMs)), Math.min(high.env.length, index + Math.round(50 / hopMs) + 1)));
  const attackIndex = Math.max(0, index - Math.round(10 / hopMs)), peakValue = high.env[index];
  return {
    candidatePresent: true,
    peakValue,
    fullPeakValue: envelopes.full.env[index],
    midPeakValue: envelopes.mid.env[index],
    lowPeakValue: envelopes.low.env[index],
    highFullRatio: peakValue / (envelopes.full.env[index] + 1e-6),
    highMidRatio: peakValue / (envelopes.mid.env[index] + 1e-6),
    highLowRatio: peakValue / (envelopes.low.env[index] + 1e-6),
    peakProminence: peakValue - Math.max(leftMin, rightMin),
    leftRise: peakValue - leftMin,
    rightFall: peakValue - rightMin,
    attack10: peakValue - high.env[attackIndex],
    fullAttack10: envelopes.full.env[index] - envelopes.full.env[attackIndex],
    peakToLocalMean: peakValue / (localMean + 1e-6),
    absDistanceMs: Math.abs(peak.timeMs - target),
    signedDistanceMs: peak.timeMs - target
  };
}
function hitTimes(id, beatmapFile) {
  const osu = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "samples", id, beatmapFile), "utf8");
  const section = osu.split("[HitObjects]")[1]?.split("[")[0] ?? "";
  return [...new Set(section.split(/\r?\n/).map((row) => Number(row.trim().split(",")[2])).filter((time) => Number.isFinite(time) && time >= 0).map((time) => Math.round(time)))].sort((a, b) => a - b);
}
var baselineRows = [];
var features = [];
for (const id of SAMPLE_IDS) {
  const selected = v548Selection.samples.find((item) => item.id === id);
  const previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "per-sample", `${id}.json`), "utf8"));
  const chosen = previous.configurations.find((config) => config.aggregate === "top2" && config.method === "dp");
  const redlines = previous.redlines, delay = previous.globalDelay.delayMs;
  const times = hitTimes(id, selected.beatmapFile), timeToIndex = new Map(times.map((time, index) => [time, index]));
  const { samples, sampleRate } = loadAudio(id);
  const envelopes = multiBand(samples, sampleRate);
  const peaksByBand = Object.fromEntries(BAND_ORDER.map((band) => [band, peaks(envelopes[band])]));
  for (const segment of segments.filter((item) => item.sampleId === id)) {
    const reference = segment.referenceMs;
    const redlineIndex = redlines.findIndex((line) => reference >= line.timeMs && reference < line.endMs);
    const fold = timeToIndex.get(reference) % 2 === 0 ? "odd" : "even";
    const phase = redlineIndex >= 0 ? chosen.phases.actual[fold][redlineIndex] ?? 0 : 0;
    const target = reference + delay + phase;
    const highPeak = nearest(peaksByBand.high, target);
    features.push({ segmentId: segment.segmentId, sampleId: id, ...highPeakFeatures(envelopes, highPeak, target) });
    for (const config of configs) {
      const envelope = envelopes[config.band], peak = nearest(peaksByBand[config.band], target);
      let residualMs = null;
      if (peak) {
        const measured = config.edge === "peak" ? peak.timeMs : leadingEdge(envelope.env, peak.index, config.fraction, envelope.hopMs, envelope.biasMs);
        residualMs = measured - target;
      }
      predictions[config.name].push({ segmentId: segment.segmentId, residualMs });
      if (config.name === "full-peak") {
        const expected = segment.sup5ResidualMs;
        baselineRows.push({
          segmentId: segment.segmentId,
          presenceMatches: residualMs === null === (expected === null),
          absDifferenceMs: residualMs === null || expected === null ? null : Math.abs(residualMs - expected)
        });
      }
    }
  }
  console.log(`V555_TS_ENVELOPES_WRITTEN ${id} frames=${envelopes.full.env.length}`);
}
var baselineReproduction = {
  count: baselineRows.length,
  allPresenceMatches: baselineRows.every((row) => row.presenceMatches),
  maxAbsDifferenceMs: Math.max(...baselineRows.flatMap((row) => row.absDifferenceMs === null ? [] : [row.absDifferenceMs])),
  rows: baselineRows
};
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "candidate-predictions.json"), JSON.stringify({
  version: "v555-typescript-dsp-candidates-v1",
  featureVersion: "v556-high-peak-gate-features-v1",
  configurations: configs,
  baselineReproduction,
  predictions,
  features
}, null, 2));
console.log(JSON.stringify({ baselineReproduction: { ...baselineReproduction, rows: void 0 }, featureCount: features.length }));
console.log("V555_TS_CANDIDATES_WRITTEN");

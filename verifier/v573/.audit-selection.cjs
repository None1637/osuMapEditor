// verifier/v573/audit-selection.ts
var import_node_crypto = require("node:crypto");
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

// verifier/v573/audit-selection.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var SAMPLE_IDS = ["sample-017", "sample-047", "sample-054", "sample-067", "sample-077", "sample-099"];
var PER_STRATUM = 10;
var MIN_SPACING_MS = 200;
var PRE_MS = 500;
var POST_MS = 500;
var HOP2 = 11;
var WIN2 = 256;
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
function highEnvelope(samples, sampleRate) {
  const frames = Math.max(0, Math.floor((samples.length - WIN2) / HOP2) + 1);
  const raw = new Float32Array(frames), hann = hannWindow(WIN2), re = new Float32Array(WIN2), im = new Float32Array(WIN2);
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
      let sum = 0;
      for (let bin = 33; bin < magnitude.length; bin++) sum += Math.max(0, magnitude[bin] - previous[bin]);
      raw[frame] = sum;
    }
    previous = magnitude;
  }
  const hopMs = HOP2 / sampleRate * 1e3;
  return { env: normalize(raw, hopMs), hopMs, biasMs: 3 * WIN2 / 4 / sampleRate * 1e3 };
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
    return { timeMs, index, segment, region: (active?.durationMs ?? Infinity) <= 1200 ? "dense" : "stable", bpm: active?.bpm ?? null };
  });
}
var hash = (id, timeMs) => (0, import_node_crypto.createHash)("sha256").update(`v557:${id}:${timeMs}`).digest("hex");
var clock = (ms) => {
  const total = Math.round(ms), minutes = Math.floor(total / 6e4), remainder = total % 6e4;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1e3)).padStart(2, "0")}.${String(remainder % 1e3).padStart(3, "0")}`;
};
var manifest = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "manifest.json"), "utf8"));
var selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "../v559/confirmation-selection.json"), "utf8"));
var actualIds = selection.samples.map((item) => item.id);
if (JSON.stringify(actualIds) !== JSON.stringify(SAMPLE_IDS)) throw new Error(`\u56FA\u5B9A\u9009\u66F2\u590D\u6838\u5931\u8D25: ${actualIds.join(",")}`);
var segments = [];
var population = [];
(0, import_node_fs.mkdirSync)((0, import_node_path.join)(root, "peaks"), { recursive: true });
for (const id of SAMPLE_IDS) {
  const selected = selection.samples.find((item) => item.id === id);
  const previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "per-sample", `${id}.json`), "utf8"));
  const chosen = previous.configurations.find((config) => config.aggregate === "top2" && config.method === "dp");
  if (!chosen) throw new Error(`${id} \u7F3A\u5C11\u51BB\u7ED3 top2/dp \u914D\u7F6E`);
  const delay = previous.globalDelay.delayMs, redlines = previous.redlines;
  const { samples, sampleRate } = loadAudio(id);
  const full = { ...onsetEnvelope(samples, sampleRate, WIN2, HOP2), biasMs: 3 * WIN2 / 4 / sampleRate * 1e3 };
  const fullPeaks = peaks(full), highPeaks = peaks(highEnvelope(samples, sampleRate));
  const storedPeaks = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "peaks", `${id}.json`), "utf8"));
  if (JSON.stringify(storedPeaks) !== JSON.stringify({ sampleId: id, fullPeakMs: fullPeaks })) throw new Error(`${id} full\u5CF0\u72EC\u7ACB\u91CD\u5EFA\u4E0D\u4E00\u81F4`);
  const osu = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "samples", id, selected.beatmapFile), "utf8");
  const hits = parseHits(osu, redlines);
  const candidates = hits.map((hit) => {
    const fold = hit.index % 2 === 0 ? "odd" : "even";
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0, target = hit.timeMs + delay + phase;
    const fullResidualMs = nearest(fullPeaks, target), highResidualMs = nearest(highPeaks, target);
    const fullGood = fullResidualMs !== null && Math.abs(fullResidualMs) <= 5;
    const highGood = highResidualMs !== null && Math.abs(highResidualMs) <= 5;
    const stratum = fullGood && highGood ? "both-within5" : highGood ? "only-high-within5" : "neither-within5";
    return { ...hit, stratum, fullResidualMs, highResidualMs };
  });
  const manifestItem = manifest.samples.find((item) => item.id === id);
  const originalAudioPath = `${manifestItem.sourceDirectory}\\${manifestItem.originalAudioFilename}`;
  const selectedForSample = [];
  const strata = ["both-within5", "only-high-within5", "neither-within5"];
  const pools = Object.fromEntries(strata.map((stratum) => [stratum, candidates.filter((candidate) => candidate.stratum === stratum).sort((a, b) => hash(id, a.timeMs).localeCompare(hash(id, b.timeMs)))]));
  const quotas = Object.fromEntries(strata.map((stratum) => [stratum, Math.min(PER_STRATUM, pools[stratum].length)]));
  while (strata.reduce((sum, stratum) => sum + quotas[stratum], 0) < 30) {
    const stratum = strata.filter((item) => quotas[item] < pools[item].length).sort((a, b) => pools[b].length - pools[a].length || strata.indexOf(a) - strata.indexOf(b))[0];
    quotas[stratum]++;
  }
  for (const stratum of [...strata].sort((a, b) => quotas[a] - quotas[b] || strata.indexOf(a) - strata.indexOf(b))) {
    const pool = pools[stratum], quota = quotas[stratum];
    let count = 0;
    for (const candidate of pool) {
      if (selectedForSample.some((other) => Math.abs(other.timeMs - candidate.timeMs) < MIN_SPACING_MS)) continue;
      const fold = candidate.index % 2 === 0 ? "odd" : "even";
      const phaseMs = chosen.phases.actual[fold][candidate.segment] ?? 0;
      const targetMs = candidate.timeMs + delay + phaseMs;
      segments.push({
        segmentId: `${id}_h${candidate.timeMs}`,
        sampleId: id,
        directoryName: selected.directoryName,
        beatmapFile: selected.beatmapFile,
        originalAudioPath,
        referenceMs: candidate.timeMs,
        referenceClock: clock(candidate.timeMs),
        clipStartMs: candidate.timeMs - PRE_MS,
        clipEndMs: candidate.timeMs + POST_MS,
        clipStartClock: clock(candidate.timeMs - PRE_MS),
        clipEndClock: clock(candidate.timeMs + POST_MS),
        stratum,
        stratumPopulation: pool.length,
        stratumSelected: quota,
        stratumWeight: pool.length / quota,
        selectionHash: hash(id, candidate.timeMs),
        region: candidate.region,
        bpm: candidate.bpm,
        hitIndex: candidate.index,
        fold,
        targetMs,
        globalDelayMs: delay,
        phaseMs,
        fullResidualMs: candidate.fullResidualMs,
        highResidualMs: candidate.highResidualMs,
        reviewedActualOnsetMs: null,
        confidence: null
      });
      selectedForSample.push(candidate);
      count++;
      if (count === quota) break;
    }
    population.push({ sampleId: id, stratum, population: pool.length, selected: count, weight: pool.length / quota });
    if (count !== quota) throw new Error(`${id}/${stratum} \u4EC5\u9009\u5230 ${count}/${quota}`);
  }
  console.log(JSON.stringify({ id, hits: hits.length, selected: selectedForSample.length, population: population.filter((item) => item.sampleId === id) }));
}
var actualSelection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "selection.json"), "utf8"));
if (JSON.stringify(actualSelection.population) !== JSON.stringify(population)) throw new Error("\u5206\u5C42\u4EBA\u53E3\u4E0E\u6743\u91CD\u72EC\u7ACB\u91CD\u5EFA\u4E0D\u4E00\u81F4");
if (actualSelection.segments.length !== segments.length) throw new Error("\u9009\u62E9\u7269\u4EF6\u6570\u91CF\u4E0D\u4E00\u81F4");
var actualById = new Map(actualSelection.segments.map((segment) => [segment.segmentId, segment]));
for (const expected of segments) {
  const actual = actualById.get(expected.segmentId);
  if (!actual) throw new Error(`\u7F3A\u5C11\u9009\u62E9\u7269\u4EF6 ${expected.segmentId}`);
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) throw new Error(`\u9009\u62E9\u5B57\u6BB5\u4E0D\u4E00\u81F4 ${expected.segmentId}/${key}`);
  }
}
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "selection-validation.json"), JSON.stringify({
  version: "v573-selection-independent-reconstruction-v1",
  passed: true,
  sampleIds: SAMPLE_IDS,
  selectedObjects: segments.length,
  fullPeaksVerified: true,
  populationVerified: true,
  selectionFieldsVerified: true
}, null, 2));
console.log(`V573_SELECTION_VALIDATION_PASSED segments=${segments.length}`);

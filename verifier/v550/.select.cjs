// verifier/v550/select.ts
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

// verifier/v550/select.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v548 = (0, import_node_path.join)(root, "../v548");
var SAMPLE_IDS = ["sample-003", "sample-042", "sample-095"];
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
function peaks(envelope, suppressionMs) {
  const radius = Math.round(suppressionMs / envelope.hopMs), output2 = [];
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
    output2.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output2;
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
var hash = (id, timeMs) => (0, import_node_crypto.createHash)("sha256").update(`v550:${id}:${timeMs}`).digest("hex");
var clock = (ms) => {
  const total = Math.round(ms), minutes = Math.floor(total / 6e4), remainder = total % 6e4;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1e3)).padStart(2, "0")}.${String(remainder % 1e3).padStart(3, "0")}`;
};
var manifest = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "manifest.json"), "utf8"));
var selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "selection.json"), "utf8"));
var segments = [];
var population = [];
for (const id of SAMPLE_IDS) {
  const selected = selection.samples.find((item) => item.id === id);
  const previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "per-sample", `${id}.json`), "utf8"));
  const chosen = previous.configurations.find((config) => config.aggregate === "top2" && config.method === "dp");
  const delay = previous.globalDelay.delayMs, redlines = previous.redlines;
  const { samples, sampleRate } = loadAudio(id);
  const rawEnvelope = onsetEnvelope(samples, sampleRate, WIN2, HOP2);
  const envelope = { ...rawEnvelope, biasMs: 3 * WIN2 / 4 / sampleRate * 1e3 };
  const currentPeaks = peaks(envelope, 20), sup5Peaks = peaks(envelope, 5);
  const osu = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "samples", id, selected.beatmapFile), "utf8");
  const hits = parseHits(osu, redlines);
  const candidates = hits.map((hit) => {
    const fold = hit.index % 2 === 0 ? "odd" : "even";
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0, target = hit.timeMs + delay + phase;
    const currentResidualMs = nearest(currentPeaks, target), sup5ResidualMs = nearest(sup5Peaks, target);
    const currentGood = currentResidualMs !== null && Math.abs(currentResidualMs) <= 5;
    const sup5Good = sup5ResidualMs !== null && Math.abs(sup5ResidualMs) <= 5;
    const stratum = currentGood && sup5Good ? "both-within5" : sup5Good ? "only-sup5-within5" : "neither-within5";
    return { ...hit, stratum, currentResidualMs, sup5ResidualMs };
  });
  const manifestItem = manifest.samples.find((item) => item.id === id);
  const originalAudioPath = `${manifestItem.sourceDirectory}\\${manifestItem.originalAudioFilename}`;
  const selectedForSample = [];
  for (const stratum of ["both-within5", "only-sup5-within5", "neither-within5"]) {
    const pool = candidates.filter((candidate) => candidate.stratum === stratum).sort((a, b) => hash(id, a.timeMs).localeCompare(hash(id, b.timeMs)));
    let count = 0;
    for (const candidate of pool) {
      if (selectedForSample.some((other) => Math.abs(other.timeMs - candidate.timeMs) < MIN_SPACING_MS)) continue;
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
        stratumSelected: PER_STRATUM,
        stratumWeight: pool.length / PER_STRATUM,
        selectionHash: hash(id, candidate.timeMs),
        region: candidate.region,
        bpm: candidate.bpm,
        currentResidualMs: candidate.currentResidualMs,
        sup5ResidualMs: candidate.sup5ResidualMs,
        reviewedActualOnsetMs: null,
        confidence: null
      });
      selectedForSample.push(candidate);
      count++;
      if (count === PER_STRATUM) break;
    }
    population.push({ sampleId: id, stratum, population: pool.length, selected: count, weight: pool.length / PER_STRATUM });
    if (count !== PER_STRATUM) throw new Error(`${id}/${stratum} \u4EC5\u9009\u5230 ${count}/${PER_STRATUM}`);
  }
  console.log(JSON.stringify({ id, hits: hits.length, selected: selectedForSample.length, population: population.filter((item) => item.sampleId === id) }));
}
var output = {
  version: "v550-stratified-independent-onset-review-v1",
  groundTruthStatus: "pending_independent_review",
  target: "independently verify whether 20 ms and 5 ms peak settings achieve 80% within 5 ms",
  selectionRule: "for each of 003/042/095, sha256(v550:sample-id:hit-time) order; 10 per stratum; at least 200 ms between selected references in one song",
  strata: ["both-within5", "only-sup5-within5", "neither-within5"],
  clipPolicy: "workspace decoded PCM to 16-bit WAV; reference -500 ms to +500 ms; no time stretching; algorithm onset candidates hidden from review plots",
  population,
  segments
};
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "selection.json"), JSON.stringify(output, null, 2));
console.log(`V550_SELECTION_WRITTEN segments=${segments.length}`);

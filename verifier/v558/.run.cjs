// verifier/v558/run.ts
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

// verifier/v558/run.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v548 = (0, import_node_path.join)(root, "../v548");
var v557 = (0, import_node_path.join)(root, "../v557");
var config = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(root, "experiment.json"), "utf8"));
var WIN2 = config.windowSamples;
var HOP2 = config.hopSamples;
var BANDS_PER_OCTAVE = 24;
var MIN_FREQUENCY = 27.5;
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
    const value = Math.max(0, raw[i] - running / queue.length * 0.7);
    output[i] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}
function derivedDifferenceFrames() {
  const hann = hannWindow(WIN2), firstAboveHalf = hann.findIndex((value) => value > 0.5);
  return Math.max(1, Math.floor((WIN2 / 2 - firstAboveHalf) / HOP2));
}
function createFilterbank(sampleRate) {
  const centers = [];
  for (let index = 0; ; index++) {
    const center = MIN_FREQUENCY * 2 ** (index / BANDS_PER_OCTAVE);
    if (center > Math.min(16e3, sampleRate / 2)) break;
    centers.push(center);
  }
  return centers.map((center, index) => {
    const left = index === 0 ? center / 2 ** (1 / BANDS_PER_OCTAVE) : centers[index - 1];
    const right = index + 1 < centers.length ? centers[index + 1] : center * 2 ** (1 / BANDS_PER_OCTAVE);
    const weights = [];
    for (let bin = 0; bin < WIN2 / 2; bin++) {
      const frequency = bin * sampleRate / WIN2;
      if (frequency < left || frequency > right) continue;
      const weight = frequency <= center ? (frequency - left) / (center - left) : (right - frequency) / (right - center);
      if (weight > 0) weights.push({ bin, weight });
    }
    return { weights };
  });
}
function experimentalEnvelopes(samples, sampleRate, diffFrames2) {
  const frames = Math.max(0, Math.floor((samples.length - WIN2) / HOP2) + 1);
  const rawAdjacent = new Float32Array(frames), rawLag = new Float32Array(frames), rawSuper = new Float32Array(frames);
  const hann = hannWindow(WIN2), re = new Float32Array(WIN2), im = new Float32Array(WIN2);
  const filterbank = createFilterbank(sampleRate);
  const currentHistory = new Array(diffFrames2 + 1), superHistory = new Array(diffFrames2 + 1);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP2;
    for (let i = 0; i < WIN2; i++) {
      re[i] = samples[offset + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const current = new Float32Array(WIN2 / 2), rawMagnitude = new Float32Array(WIN2 / 2);
    for (let bin = 0; bin < current.length; bin++) {
      current[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]) / (1 + bin / 24));
      rawMagnitude[bin] = Math.hypot(re[bin], im[bin]);
    }
    const filtered = new Float32Array(filterbank.length);
    for (let band = 0; band < filterbank.length; band++) {
      let sum = 0;
      for (const { bin, weight } of filterbank[band].weights) sum += rawMagnitude[bin] * weight;
      filtered[band] = Math.log10(1 + sum);
    }
    const slot = frame % (diffFrames2 + 1);
    if (frame > 0) {
      const previous = currentHistory[(frame - 1) % (diffFrames2 + 1)];
      let sum = 0;
      for (let bin = 0; bin < current.length; bin++) sum += Math.max(0, current[bin] - previous[bin]);
      rawAdjacent[frame] = sum;
    }
    if (frame >= diffFrames2) {
      const previous = currentHistory[(frame - diffFrames2) % (diffFrames2 + 1)];
      const previousFiltered = superHistory[(frame - diffFrames2) % (diffFrames2 + 1)];
      let lagSum = 0, superSum = 0;
      for (let bin = 0; bin < current.length; bin++) lagSum += Math.max(0, current[bin] - previous[bin]);
      for (let band = 0; band < filtered.length; band++) {
        const previousMaximum = Math.max(
          previousFiltered[Math.max(0, band - 1)],
          previousFiltered[band],
          previousFiltered[Math.min(filtered.length - 1, band + 1)]
        );
        superSum += Math.max(0, filtered[band] - previousMaximum);
      }
      rawLag[frame] = lagSum;
      rawSuper[frame] = superSum;
    }
    currentHistory[slot] = current;
    superHistory[slot] = filtered;
  }
  const hopMs = HOP2 / sampleRate * 1e3, biasMs = 3 * WIN2 / 4 / sampleRate * 1e3;
  return {
    adjacent: { env: normalize(rawAdjacent, hopMs), hopMs, biasMs },
    lag5: { env: normalize(rawLag, hopMs), hopMs, biasMs },
    superflux: { env: normalize(rawSuper, hopMs), hopMs, biasMs },
    filterbankBandCount: filterbank.length
  };
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
    return { timeMs, index, segment };
  });
}
var selection = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v557, "selection.json"), "utf8"));
var diffFrames = derivedDifferenceFrames();
if (diffFrames !== config.expectedDifferenceFrames) throw new Error(`\u5DEE\u5206\u8DDD\u79BB\u63A8\u5BFC\u53D8\u5316: ${diffFrames}`);
(0, import_node_fs.mkdirSync)((0, import_node_path.join)(root, "per-sample"), { recursive: true });
var allRows = [];
for (const id of config.sampleIds) {
  const selectedSegments = selection.segments.filter((segment) => segment.sampleId === id);
  const selectedBeatmap = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "selection.json"), "utf8"));
  const beatmapFile = selectedBeatmap.samples.find((item) => item.id === id).beatmapFile;
  const previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v548, "per-sample", `${id}.json`), "utf8"));
  const chosen = previous.configurations.find((item) => item.aggregate === "top2" && item.method === "dp");
  const { samples, sampleRate } = loadAudio(id);
  const full = { ...onsetEnvelope(samples, sampleRate, WIN2, HOP2), biasMs: 3 * WIN2 / 4 / sampleRate * 1e3 };
  const experimental = experimentalEnvelopes(samples, sampleRate, diffFrames);
  let adjacentDifference = 0;
  if (experimental.adjacent.env.length !== full.env.length) throw new Error(`${id} \u76F8\u90BB\u5E27\u5305\u7EDC\u957F\u5EA6\u4E0D\u4E00\u81F4`);
  for (let i = 0; i < full.env.length; i++) adjacentDifference = Math.max(adjacentDifference, Math.abs(full.env[i] - experimental.adjacent.env[i]));
  if (adjacentDifference !== 0) throw new Error(`${id} \u76F8\u90BB\u5E27\u5B9E\u73B0\u4E0E\u751F\u4EA7\u5305\u7EDC\u4E0D\u4E00\u81F4: ${adjacentDifference}`);
  const fullPeaks = peaks(full), lagPeaks = peaks(experimental.lag5), superPeaks = peaks(experimental.superflux);
  const osu = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v541, "samples", id, beatmapFile), "utf8");
  const hits = parseHits(osu, previous.redlines), hitByTime = new Map(hits.map((hit) => [hit.timeMs, hit]));
  const rows = selectedSegments.map((segment) => {
    const hit = hitByTime.get(segment.referenceMs);
    if (!hit) throw new Error(`${segment.segmentId} \u627E\u4E0D\u5230\u8C31\u9762\u7269\u4EF6`);
    const fold = hit.index % 2 === 0 ? "odd" : "even";
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0;
    const target = hit.timeMs + previous.globalDelay.delayMs + phase;
    const fullResidualMs = nearest(fullPeaks, target);
    const stored = segment.fullResidualMs;
    const baselineDifference = fullResidualMs === null || stored === null ? fullResidualMs === stored ? 0 : Infinity : Math.abs(fullResidualMs - stored);
    if (baselineDifference !== 0) throw new Error(`${segment.segmentId} full \u57FA\u7EBF\u590D\u73B0\u5931\u8D25: ${baselineDifference}`);
    return {
      segmentId: segment.segmentId,
      sampleId: id,
      referenceMs: segment.referenceMs,
      targetMs: target,
      globalDelayMs: previous.globalDelay.delayMs,
      phaseMs: phase,
      fullResidualMs,
      lag5ResidualMs: nearest(lagPeaks, target),
      superfluxResidualMs: nearest(superPeaks, target),
      fullGlobalResidualMs: nearest(fullPeaks, hit.timeMs + previous.globalDelay.delayMs),
      lag5GlobalResidualMs: nearest(lagPeaks, hit.timeMs + previous.globalDelay.delayMs),
      superfluxGlobalResidualMs: nearest(superPeaks, hit.timeMs + previous.globalDelay.delayMs),
      baselineResidualAbsDifferenceMs: baselineDifference
    };
  });
  allRows.push(...rows);
  (0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "per-sample", `${id}.json`), JSON.stringify({
    id,
    differenceFrames: diffFrames,
    differenceMs: diffFrames * HOP2 / sampleRate * 1e3,
    filterbankBandCount: experimental.filterbankBandCount,
    fullAdjacentMaxAbsDifference: adjacentDifference,
    peakCounts: { full: fullPeaks.length, lag5: lagPeaks.length, superflux: superPeaks.length },
    rows
  }, null, 2));
  console.log(JSON.stringify({
    id,
    objects: rows.length,
    differenceFrames: diffFrames,
    bands: experimental.filterbankBandCount,
    peaks: { full: fullPeaks.length, lag5: lagPeaks.length, superflux: superPeaks.length },
    adjacentDifference
  }));
}
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "candidates.json"), JSON.stringify({
  version: "v558-superflux-e1-candidates-v1",
  configuration: config,
  differenceFrames: diffFrames,
  rows: allRows
}, null, 2));
console.log(`V558_CANDIDATES_WRITTEN objects=${allRows.length} diffFrames=${diffFrames}`);

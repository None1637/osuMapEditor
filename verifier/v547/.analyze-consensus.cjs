// verifier/v547/analyze-consensus.ts
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

// verifier/v547/analyze-consensus.ts
var root = __dirname;
var v541 = (0, import_node_path.join)(root, "../v541");
var v545 = (0, import_node_path.join)(root, "../v545");
var HOP2 = 11;
var WIN2 = 256;
var GLOBAL_SEARCH_RADIUS_MS = 10;
var PEAK_SUPPRESSION_MS = 20;
var PHASE_MIN = -30;
var PHASE_MAX = 30;
var PHASE_STEP = 0.5;
var TRANSITION_PENALTY = 5e-4;
function normalize(raw, hopMs) {
  const width = Math.max(1, Math.round(1e3 / hopMs));
  const output2 = new Float32Array(raw.length);
  const queue = [];
  let running = 0;
  let maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]);
    running += raw[i];
    if (queue.length > width) running -= queue.shift();
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    output2[i] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output2.length; i++) output2[i] /= maximum;
  return output2;
}
function multiBand(samples, sampleRate) {
  const frames = Math.max(0, Math.floor((samples.length - WIN2) / HOP2) + 1);
  const raw = Array.from({ length: 4 }, () => new Float32Array(frames));
  const hann = hannWindow(WIN2);
  const re = new Float32Array(WIN2), im = new Float32Array(WIN2);
  let previous2 = null;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP2;
    for (let i = 0; i < WIN2; i++) {
      re[i] = samples[offset + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const magnitude = new Float32Array(WIN2 / 2);
    for (let bin = 0; bin < magnitude.length; bin++) magnitude[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]) / (1 + bin / 24));
    if (previous2 !== null) {
      const sums = [0, 0, 0, 0];
      for (let bin = 0; bin < magnitude.length; bin++) {
        const difference = Math.max(0, magnitude[bin] - previous2[bin]);
        sums[0] += difference;
        if (bin >= 1 && bin <= 8) sums[1] += difference;
        if (bin >= 9 && bin <= 32) sums[2] += difference;
        if (bin >= 33) sums[3] += difference;
      }
      for (let band = 0; band < 4; band++) raw[band][frame] = sums[band];
    }
    previous2 = magnitude;
  }
  const hopMs = HOP2 / sampleRate * 1e3;
  const biasMs = 3 * WIN2 / 4 / sampleRate * 1e3;
  return ["full", "low", "mid", "high"].map((name, index) => ({ name, env: normalize(raw[index], hopMs), hopMs, biasMs }));
}
function sample(envelope, timeMs) {
  const position = (timeMs - envelope.biasMs) / envelope.hopMs;
  const left = Math.floor(position);
  if (left < 0 || left + 1 >= envelope.env.length) return 0;
  const fraction = position - left;
  return envelope.env[left] * (1 - fraction) + envelope.env[left + 1] * fraction;
}
function peaks(envelope) {
  const radius = Math.round(PEAK_SUPPRESSION_MS / envelope.hopMs);
  const output2 = [];
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
    const left = envelope.env[i - 1], right = envelope.env[i + 1];
    const denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    output2.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output2;
}
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
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
}
function metrics(residuals) {
  const matched = residuals.flatMap((value) => value === null ? [] : [value]);
  const absolute = matched.map(Math.abs).sort((a, b) => a - b);
  return {
    count: residuals.length,
    matched: matched.length,
    within5: absolute.filter((value) => value <= 5).length,
    within5msAll: residuals.length ? absolute.filter((value) => value <= 5).length / residuals.length : null,
    medianAbsMs: quantile(absolute, 0.5),
    p95AbsMs: quantile(absolute, 0.95)
  };
}
function summarize(hits, residuals) {
  const output2 = {};
  for (const scope of ["full", "review"]) {
    for (const region of ["all", "dense", "stable"]) {
      const selected = residuals.filter((_, index) => (scope === "full" || hits[index].inReview) && (region === "all" || hits[index].region === region));
      if (selected.length) output2[`${scope}/${region}`] = metrics(selected);
    }
  }
  return output2;
}
function segmentHits(redline, hits) {
  return hits.flatMap((hit) => hit.timeMs >= redline.timeMs && hit.timeMs < redline.endMs ? [hit.index] : []);
}
function emissions(redlines, hits, envelopes, globalDelay, fold, aggregate, nullControl) {
  return redlines.map((redline) => {
    const indices = segmentHits(redline, hits).filter((index) => fold === "all" || (fold === "even" ? index % 2 === 0 : index % 2 === 1));
    const scores = new Float64Array(Math.round((PHASE_MAX - PHASE_MIN) / PHASE_STEP) + 1);
    for (let shiftIndex = 0; shiftIndex < scores.length; shiftIndex++) {
      const shift = PHASE_MIN + shiftIndex * PHASE_STEP;
      const noteScores = indices.map((index) => {
        const time = (nullControl ? hits[index].jitterMs : hits[index].timeMs) + globalDelay + shift;
        const bandScores = envelopes.map((envelope) => sample(envelope, time)).sort((a, b) => b - a);
        return aggregate === "max" ? bandScores[0] : (bandScores[0] + bandScores[1]) / 2;
      }).sort((a, b) => b - a);
      const keep = Math.max(1, Math.round(noteScores.length * 0.8));
      scores[shiftIndex] = indices.length ? noteScores.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep : 0;
    }
    return { scores, support: indices.length, durationMs: redline.durationMs };
  });
}
function bestPhases(emission) {
  return emission.map((segment) => {
    if (!segment.support) return 0;
    let best = 0;
    for (let i = 1; i < segment.scores.length; i++) if (segment.scores[i] > segment.scores[best]) best = i;
    return PHASE_MIN + best * PHASE_STEP;
  });
}
function dynamicPhases(emission) {
  const count = emission[0]?.scores.length ?? 0;
  if (!count) return [];
  const costs = emission.map(() => new Float64Array(count));
  const back = emission.map(() => new Int32Array(count));
  for (let i = 0; i < count; i++) costs[0][i] = emission[0].support ? -emission[0].scores[i] : 0;
  for (let segment = 1; segment < emission.length; segment++) {
    const transitionPenalty = emission[segment - 1].durationMs <= 1200 && emission[segment].durationMs <= 1200 ? TRANSITION_PENALTY : 0;
    for (let current = 0; current < count; current++) {
      const phase = PHASE_MIN + current * PHASE_STEP;
      let best = Infinity, bestPrevious = 0;
      for (let previous2 = 0; previous2 < count; previous2++) {
        const previousPhase = PHASE_MIN + previous2 * PHASE_STEP;
        const cost = costs[segment - 1][previous2] + transitionPenalty * (phase - previousPhase) ** 2;
        if (cost < best) {
          best = cost;
          bestPrevious = previous2;
        }
      }
      costs[segment][current] = best - (emission[segment].support ? emission[segment].scores[current] : 0);
      back[segment][current] = bestPrevious;
    }
  }
  let state = 0;
  for (let i = 1; i < count; i++) if (costs.at(-1)[i] < costs.at(-1)[state]) state = i;
  const phases = new Array(emission.length).fill(0);
  for (let segment = emission.length - 1; segment >= 0; segment--) {
    phases[segment] = PHASE_MIN + state * PHASE_STEP;
    state = back[segment][state];
  }
  return phases;
}
function nearestResidual(peakTimes, timeMs, globalDelay, phase) {
  const target = timeMs + globalDelay + phase;
  let best = null;
  for (const peak of peakTimes) {
    if (peak < target - GLOBAL_SEARCH_RADIUS_MS) continue;
    if (peak > target + GLOBAL_SEARCH_RADIUS_MS) break;
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - globalDelay - phase - timeMs;
}
var previous = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(v545, "oracle-results.json"), "utf8"));
var output = {
  version: "v547-weak-label-consensus-v2",
  status: "weak_label_consistency_not_independent_acoustic_accuracy",
  protocol: {
    weakLabels: "owner: about 80% of hitobject times have audible onsets; robust emission keeps the top 80% note scores",
    bands: "full + low bins1-8 + mid9-32 + high33-127; 256-sample Hann, hop11, log positive spectral flux",
    aggregation: ["max across four bands", "mean of strongest two bands"],
    phase: "one phase per known redline segment, -30..30 ms by 0.5 ms; independent and DP variants",
    transitionPenalty: `${TRANSITION_PENALTY} only when both adjacent redline durations are <=1200 ms; zero across long segments`,
    validation: "full fit is descriptive; crossFit trains on even hitobject indices and evaluates odd, then vice versa; jitter null follows the identical fit/evaluation path",
    evaluation: "nearest full-band peak after phase correction, 20 ms suppression, +/-10 ms search; unmatched stays in denominator",
    limitation: "Known redline boundaries and hitobject weak labels are used. This measures robust alignment consistency, not fully automatic discovery or independently annotated acoustic-onset accuracy."
  },
  samples: []
};
for (const previousSample of previous.samples) {
  const id = previousSample.id;
  const { samples, sampleRate } = loadAudio(id);
  const envelopes = multiBand(samples, sampleRate);
  const full = envelopes[0];
  const referenceEnvelope = onsetEnvelope(samples, sampleRate, WIN2, HOP2).env;
  let maxDifference = 0;
  for (let i = 0; i < full.env.length; i++) maxDifference = Math.max(maxDifference, Math.abs(full.env[i] - referenceEnvelope[i]));
  const globalDelay = previousSample.features["spectral-flux"].globalDelay.delayMs;
  const fullPeaks = peaks(full);
  const redlines = previousSample.redLines;
  const csv = (0, import_node_fs.readFileSync)((0, import_node_path.join)(v545, "oracle-residuals.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  const hits = csv.filter((row) => row.startsWith(`${id},spectral-flux,hitobject,`)).map((row, index) => {
    const fields = row.split(",");
    const timeMs = Number(fields[5]);
    const magnitude = 15 + (index * 47 + 19) % 81;
    return { timeMs, jitterMs: Math.max(0, timeMs + (index % 2 === 0 ? magnitude : -magnitude)), region: fields[3], inReview: fields[4] === "true", index };
  });
  const sampleOutput = { id, globalDelay, fullEnvelopeMaxAbsDifference: maxDifference, redlines, hitCount: hits.length, configurations: [] };
  for (const aggregate of ["max", "top2"]) {
    const foldEmissions = Object.fromEntries(["all", "even", "odd"].map((fold) => [fold, emissions(redlines, hits, envelopes, globalDelay, fold, aggregate, false)]));
    const nullEmissions = Object.fromEntries(["all", "even", "odd"].map((fold) => [fold, emissions(redlines, hits, envelopes, globalDelay, fold, aggregate, true)]));
    for (const method of ["independent", "dp"]) {
      const solve = (source, fold) => method === "dp" ? dynamicPhases(source[fold]) : bestPhases(source[fold]);
      const actualPhases = { all: solve(foldEmissions, "all"), even: solve(foldEmissions, "even"), odd: solve(foldEmissions, "odd") };
      const nullPhases = { all: solve(nullEmissions, "all"), even: solve(nullEmissions, "even"), odd: solve(nullEmissions, "odd") };
      const evaluate = (nullControl, crossFit) => {
        const phaseSets = nullControl ? nullPhases : actualPhases;
        const residuals = hits.map((hit) => {
          const segment = redlines.findIndex((line) => hit.timeMs >= line.timeMs && hit.timeMs < line.endMs);
          const fold = hit.index % 2 === 0 ? "odd" : "even";
          const phase = crossFit ? phaseSets[fold][segment] ?? 0 : phaseSets.all[segment] ?? 0;
          return nearestResidual(fullPeaks, nullControl ? hit.jitterMs : hit.timeMs, globalDelay, phase);
        });
        return summarize(hits, residuals);
      };
      const phaseAgreement = redlines.map((_, index) => Math.abs(actualPhases.even[index] - actualPhases.odd[index]));
      sampleOutput.configurations.push({
        aggregate,
        method,
        actualFullFit: evaluate(false, false),
        actualCrossFit: evaluate(false, true),
        nullFullFit: evaluate(true, false),
        nullCrossFit: evaluate(true, true),
        phases: { actual: actualPhases, null: nullPhases },
        evenOddMedianAbsDifferenceMs: quantile([...phaseAgreement].sort((a, b) => a - b), 0.5),
        evenOddWithin5msProportion: phaseAgreement.filter((value) => value <= 5).length / phaseAgreement.length
      });
    }
  }
  const baseline = hits.map((hit) => nearestResidual(fullPeaks, hit.timeMs, globalDelay, 0));
  sampleOutput.baselineGlobalOnly = summarize(hits, baseline);
  output.samples.push(sampleOutput);
  console.log(JSON.stringify({ id, hits: hits.length, redlines: redlines.length, fullEnvelopeMaxAbsDifference: maxDifference }));
}
(0, import_node_fs.writeFileSync)((0, import_node_path.join)(root, "consensus-results.json"), JSON.stringify(output, null, 2));
console.log("V547_CONSENSUS_ANALYSIS_WRITTEN");

// v547: 物件时间≈80%含音的弱标签；多频带鲁棒相位 + 奇偶留出 + 打乱对照。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fft, hannWindow } from '../../src/osu/fft';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const v545 = join(root, '../v545');
const HOP = 11;
const WIN = 256;
const GLOBAL_SEARCH_RADIUS_MS = 10;
const PEAK_SUPPRESSION_MS = 20;
const PHASE_MIN = -30;
const PHASE_MAX = 30;
const PHASE_STEP = 0.5;
const TRANSITION_PENALTY = 0.0005;
type BandName = 'full' | 'low' | 'mid' | 'high';
type Aggregate = 'max' | 'top2';
type Fold = 'all' | 'even' | 'odd';
type Region = 'dense' | 'stable';
interface RedLine { timeMs: number; endMs: number; durationMs: number; bpm: number }
interface Hit { timeMs: number; jitterMs: number; region: Region; inReview: boolean; index: number }
interface Envelope { name: BandName; env: Float32Array; hopMs: number; biasMs: number }
interface Metrics { count: number; matched: number; within5: number; within5msAll: number | null; medianAbsMs: number | null; p95AbsMs: number | null }
interface SegmentEmission { scores: Float64Array; support: number; durationMs: number }

function normalize(raw: Float32Array, hopMs: number): Float32Array {
  const width = Math.max(1, Math.round(1000 / hopMs));
  const output = new Float32Array(raw.length);
  const queue: number[] = [];
  let running = 0;
  let maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]); running += raw[i];
    if (queue.length > width) running -= queue.shift()!;
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    output[i] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}

function multiBand(samples: Float32Array, sampleRate: number): Envelope[] {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const raw = Array.from({ length: 4 }, () => new Float32Array(frames));
  const hann = hannWindow(WIN);
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  let previous: Float32Array | null = null;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP;
    for (let i = 0; i < WIN; i++) { re[i] = samples[offset + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const magnitude = new Float32Array(WIN / 2);
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
  const hopMs = HOP / sampleRate * 1000;
  const biasMs = 3 * WIN / 4 / sampleRate * 1000;
  return (['full', 'low', 'mid', 'high'] as BandName[]).map((name, index) => ({ name, env: normalize(raw[index], hopMs), hopMs, biasMs }));
}

function sample(envelope: Envelope, timeMs: number): number {
  const position = (timeMs - envelope.biasMs) / envelope.hopMs;
  const left = Math.floor(position);
  if (left < 0 || left + 1 >= envelope.env.length) return 0;
  const fraction = position - left;
  return envelope.env[left] * (1 - fraction) + envelope.env[left + 1] * fraction;
}

function peaks(envelope: Envelope): number[] {
  const radius = Math.round(PEAK_SUPPRESSION_MS / envelope.hopMs);
  const output: number[] = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < 0.02) continue;
    let maximum = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(envelope.env.length - 1, i + radius); j++) {
      if (envelope.env[j] > center || (envelope.env[j] === center && j < i)) { maximum = false; break; }
    }
    if (!maximum) continue;
    const left = envelope.env[i - 1], right = envelope.env[i + 1];
    const denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    output.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output;
}

function loadAudio(id: string): { samples: Float32Array; sampleRate: number } {
  const directory = join(v541, 'decoded', id);
  const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
}

function metrics(residuals: (number | null)[]): Metrics {
  const matched = residuals.flatMap(value => value === null ? [] : [value]);
  const absolute = matched.map(Math.abs).sort((a, b) => a - b);
  return {
    count: residuals.length,
    matched: matched.length,
    within5: absolute.filter(value => value <= 5).length,
    within5msAll: residuals.length ? absolute.filter(value => value <= 5).length / residuals.length : null,
    medianAbsMs: quantile(absolute, 0.5),
    p95AbsMs: quantile(absolute, 0.95),
  };
}

function summarize(hits: Hit[], residuals: (number | null)[]): Record<string, Metrics> {
  const output: Record<string, Metrics> = {};
  for (const scope of ['full', 'review'] as const) {
    for (const region of ['all', 'dense', 'stable'] as const) {
      const selected = residuals.filter((_, index) => (scope === 'full' || hits[index].inReview) && (region === 'all' || hits[index].region === region));
      if (selected.length) output[`${scope}/${region}`] = metrics(selected);
    }
  }
  return output;
}

function segmentHits(redline: RedLine, hits: Hit[]): number[] {
  return hits.flatMap(hit => hit.timeMs >= redline.timeMs && hit.timeMs < redline.endMs ? [hit.index] : []);
}

function emissions(redlines: RedLine[], hits: Hit[], envelopes: Envelope[], globalDelay: number, fold: Fold, aggregate: Aggregate, nullControl: boolean): SegmentEmission[] {
  return redlines.map(redline => {
    const indices = segmentHits(redline, hits).filter(index => fold === 'all' || (fold === 'even' ? index % 2 === 0 : index % 2 === 1));
    const scores = new Float64Array(Math.round((PHASE_MAX - PHASE_MIN) / PHASE_STEP) + 1);
    for (let shiftIndex = 0; shiftIndex < scores.length; shiftIndex++) {
      const shift = PHASE_MIN + shiftIndex * PHASE_STEP;
      const noteScores = indices.map(index => {
        const time = (nullControl ? hits[index].jitterMs : hits[index].timeMs) + globalDelay + shift;
        const bandScores = envelopes.map(envelope => sample(envelope, time)).sort((a, b) => b - a);
        return aggregate === 'max' ? bandScores[0] : (bandScores[0] + bandScores[1]) / 2;
      }).sort((a, b) => b - a);
      // 所有者弱标签：约80%有音；仅保留得分最高的约80%物件，允许剩余为离群值。
      const keep = Math.max(1, Math.round(noteScores.length * 0.8));
      scores[shiftIndex] = indices.length ? noteScores.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep : 0;
    }
    return { scores, support: indices.length, durationMs: redline.durationMs };
  });
}

function bestPhases(emission: SegmentEmission[]): number[] {
  return emission.map(segment => {
    if (!segment.support) return 0;
    let best = 0;
    for (let i = 1; i < segment.scores.length; i++) if (segment.scores[i] > segment.scores[best]) best = i;
    return PHASE_MIN + best * PHASE_STEP;
  });
}

function dynamicPhases(emission: SegmentEmission[]): number[] {
  const count = emission[0]?.scores.length ?? 0;
  if (!count) return [];
  const costs = emission.map(() => new Float64Array(count));
  const back = emission.map(() => new Int32Array(count));
  for (let i = 0; i < count; i++) costs[0][i] = emission[0].support ? -emission[0].scores[i] : 0;
  for (let segment = 1; segment < emission.length; segment++) {
    // 只有相邻短红线共享相位先验；跨长段/长距离边界允许自由重置。
    const transitionPenalty = emission[segment - 1].durationMs <= 1200 && emission[segment].durationMs <= 1200 ? TRANSITION_PENALTY : 0;
    for (let current = 0; current < count; current++) {
      const phase = PHASE_MIN + current * PHASE_STEP;
      let best = Infinity, bestPrevious = 0;
      for (let previous = 0; previous < count; previous++) {
        const previousPhase = PHASE_MIN + previous * PHASE_STEP;
        const cost = costs[segment - 1][previous] + transitionPenalty * (phase - previousPhase) ** 2;
        if (cost < best) { best = cost; bestPrevious = previous; }
      }
      costs[segment][current] = best - (emission[segment].support ? emission[segment].scores[current] : 0);
      back[segment][current] = bestPrevious;
    }
  }
  let state = 0;
  for (let i = 1; i < count; i++) if (costs.at(-1)![i] < costs.at(-1)![state]) state = i;
  const phases = new Array(emission.length).fill(0);
  for (let segment = emission.length - 1; segment >= 0; segment--) {
    phases[segment] = PHASE_MIN + state * PHASE_STEP;
    state = back[segment][state];
  }
  return phases;
}

function nearestResidual(peakTimes: number[], timeMs: number, globalDelay: number, phase: number): number | null {
  const target = timeMs + globalDelay + phase;
  let best: number | null = null;
  for (const peak of peakTimes) {
    if (peak < target - GLOBAL_SEARCH_RADIUS_MS) continue;
    if (peak > target + GLOBAL_SEARCH_RADIUS_MS) break;
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - globalDelay - phase - timeMs;
}

const previous = JSON.parse(readFileSync(join(v545, 'oracle-results.json'), 'utf8'));
const output: Record<string, unknown> = {
  version: 'v547-weak-label-consensus-v2',
  status: 'weak_label_consistency_not_independent_acoustic_accuracy',
  protocol: {
    weakLabels: 'owner: about 80% of hitobject times have audible onsets; robust emission keeps the top 80% note scores',
    bands: 'full + low bins1-8 + mid9-32 + high33-127; 256-sample Hann, hop11, log positive spectral flux',
    aggregation: ['max across four bands', 'mean of strongest two bands'],
    phase: 'one phase per known redline segment, -30..30 ms by 0.5 ms; independent and DP variants',
    transitionPenalty: `${TRANSITION_PENALTY} only when both adjacent redline durations are <=1200 ms; zero across long segments`,
    validation: 'full fit is descriptive; crossFit trains on even hitobject indices and evaluates odd, then vice versa; jitter null follows the identical fit/evaluation path',
    evaluation: 'nearest full-band peak after phase correction, 20 ms suppression, +/-10 ms search; unmatched stays in denominator',
    limitation: 'Known redline boundaries and hitobject weak labels are used. This measures robust alignment consistency, not fully automatic discovery or independently annotated acoustic-onset accuracy.',
  },
  samples: [] as unknown[],
};

for (const previousSample of previous.samples) {
  const id = previousSample.id as string;
  const { samples, sampleRate } = loadAudio(id);
  const envelopes = multiBand(samples, sampleRate);
  const full = envelopes[0];
  const referenceEnvelope = onsetEnvelope(samples, sampleRate, WIN, HOP).env;
  let maxDifference = 0;
  for (let i = 0; i < full.env.length; i++) maxDifference = Math.max(maxDifference, Math.abs(full.env[i] - referenceEnvelope[i]));
  const globalDelay = previousSample.features['spectral-flux'].globalDelay.delayMs as number;
  const fullPeaks = peaks(full);
  const redlines = previousSample.redLines as RedLine[];
  const csv = readFileSync(join(v545, 'oracle-residuals.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const hits: Hit[] = csv.filter(row => row.startsWith(`${id},spectral-flux,hitobject,`)).map((row, index) => {
    const fields = row.split(',');
    const timeMs = Number(fields[5]);
    const magnitude = 15 + (index * 47 + 19) % 81;
    return { timeMs, jitterMs: Math.max(0, timeMs + (index % 2 === 0 ? magnitude : -magnitude)), region: fields[3] as Region, inReview: fields[4] === 'true', index };
  });
  const sampleOutput: Record<string, unknown> = { id, globalDelay, fullEnvelopeMaxAbsDifference: maxDifference, redlines, hitCount: hits.length, configurations: [] as unknown[] };
  for (const aggregate of ['max', 'top2'] as Aggregate[]) {
    const foldEmissions = Object.fromEntries(['all', 'even', 'odd'].map(fold => [fold, emissions(redlines, hits, envelopes, globalDelay, fold as Fold, aggregate, false)])) as Record<Fold, SegmentEmission[]>;
    const nullEmissions = Object.fromEntries(['all', 'even', 'odd'].map(fold => [fold, emissions(redlines, hits, envelopes, globalDelay, fold as Fold, aggregate, true)])) as Record<Fold, SegmentEmission[]>;
    for (const method of ['independent', 'dp'] as const) {
      const solve = (source: Record<Fold, SegmentEmission[]>, fold: Fold) => method === 'dp' ? dynamicPhases(source[fold]) : bestPhases(source[fold]);
      const actualPhases = { all: solve(foldEmissions, 'all'), even: solve(foldEmissions, 'even'), odd: solve(foldEmissions, 'odd') };
      const nullPhases = { all: solve(nullEmissions, 'all'), even: solve(nullEmissions, 'even'), odd: solve(nullEmissions, 'odd') };
      const evaluate = (nullControl: boolean, crossFit: boolean) => {
        const phaseSets = nullControl ? nullPhases : actualPhases;
        const residuals = hits.map(hit => {
          const segment = redlines.findIndex(line => hit.timeMs >= line.timeMs && hit.timeMs < line.endMs);
          const fold: Fold = hit.index % 2 === 0 ? 'odd' : 'even';
          const phase = crossFit ? phaseSets[fold][segment] ?? 0 : phaseSets.all[segment] ?? 0;
          return nearestResidual(fullPeaks, nullControl ? hit.jitterMs : hit.timeMs, globalDelay, phase);
        });
        return summarize(hits, residuals);
      };
      const phaseAgreement = redlines.map((_, index) => Math.abs(actualPhases.even[index] - actualPhases.odd[index]));
      (sampleOutput.configurations as unknown[]).push({
        aggregate, method,
        actualFullFit: evaluate(false, false),
        actualCrossFit: evaluate(false, true),
        nullFullFit: evaluate(true, false),
        nullCrossFit: evaluate(true, true),
        phases: { actual: actualPhases, null: nullPhases },
        evenOddMedianAbsDifferenceMs: quantile([...phaseAgreement].sort((a, b) => a - b), 0.5),
        evenOddWithin5msProportion: phaseAgreement.filter(value => value <= 5).length / phaseAgreement.length,
      });
    }
  }
  const baseline = hits.map(hit => nearestResidual(fullPeaks, hit.timeMs, globalDelay, 0));
  sampleOutput.baselineGlobalOnly = summarize(hits, baseline);
  (output.samples as unknown[]).push(sampleOutput);
  console.log(JSON.stringify({ id, hits: hits.length, redlines: redlines.length, fullEnvelopeMaxAbsDifference: maxDifference }));
}

writeFileSync(join(root, 'consensus-results.json'), JSON.stringify(output, null, 2));
console.log('V547_CONSENSUS_ANALYSIS_WRITTEN');

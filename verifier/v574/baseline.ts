// v574: 在18张用户指定高offset质量谱面上复建冻结top2/DP与E13输入；不改生产代码。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fft, hannWindow } from '../../src/osu/fft';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const HOP = 11, WIN = 256;
const SEARCH_RADIUS_MS = 10, PEAK_SUPPRESSION_MS = 5;
const PHASE_MIN = -30, PHASE_MAX = 30, PHASE_STEP = 0.5;
const TRANSITION_PENALTY = 0.0005;
type BandName = 'full' | 'low' | 'mid' | 'high';
type Aggregate = 'max' | 'top2';
type Fold = 'all' | 'even' | 'odd';
type Region = 'dense' | 'stable';
interface RedLine { timeMs: number; endMs: number; durationMs: number; bpm: number }
interface Hit { timeMs: number; jitterMs: number; region: Region; index: number }
interface Envelope { name: BandName; env: Float32Array; hopMs: number; biasMs: number }
interface Metrics { count: number; matched: number; within5: number; within5msAll: number | null; medianAbsMs: number | null; p95AbsMs: number | null }
interface SegmentEmission { scores: Float64Array; support: number; durationMs: number }

function normalize(raw: Float32Array, hopMs: number): Float32Array {
  const width = Math.max(1, Math.round(1000 / hopMs));
  const output = new Float32Array(raw.length), queue: number[] = [];
  let running = 0, maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]); running += raw[i];
    if (queue.length > width) running -= queue.shift()!;
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    output[i] = value; maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}

function multiBand(samples: Float32Array, sampleRate: number): Envelope[] {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const raw = Array.from({ length: 4 }, () => new Float32Array(frames));
  const hann = hannWindow(WIN), re = new Float32Array(WIN), im = new Float32Array(WIN);
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
  const hopMs = HOP / sampleRate * 1000, biasMs = 3 * WIN / 4 / sampleRate * 1000;
  return (['full', 'low', 'mid', 'high'] as BandName[]).map((name, index) => ({ name, env: normalize(raw[index], hopMs), hopMs, biasMs }));
}

function sample(envelope: Envelope, timeMs: number): number {
  const position = (timeMs - envelope.biasMs) / envelope.hopMs, left = Math.floor(position);
  if (left < 0 || left + 1 >= envelope.env.length) return 0;
  const fraction = position - left;
  return envelope.env[left] * (1 - fraction) + envelope.env[left + 1] * fraction;
}

function peaks(envelope: Envelope): number[] {
  const radius = Math.round(PEAK_SUPPRESSION_MS / envelope.hopMs), output: number[] = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < 0.02) continue;
    let maximum = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(envelope.env.length - 1, i + radius); j++) {
      if (envelope.env[j] > center || (envelope.env[j] === center && j < i)) { maximum = false; break; }
    }
    if (!maximum) continue;
    const left = envelope.env[i - 1], right = envelope.env[i + 1], denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    output.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output;
}

function estimateGlobalDelay(envelope: Envelope, calibration: number[]): { delayMs: number; score: number; zeroDelayScore: number; calibrationHitCount: number } {
  let best = { delayMs: 0, score: -Infinity }, zeroDelayScore = 0;
  for (let delay = -60; delay <= 60.0001; delay += 0.25) {
    let score = 0;
    for (const hit of calibration) score += sample(envelope, hit + delay);
    score = calibration.length ? score / calibration.length : 0;
    if (delay === 0) zeroDelayScore = score;
    if (score > best.score) best = { delayMs: delay, score };
  }
  return { ...best, zeroDelayScore, calibrationHitCount: calibration.length };
}

function loadAudio(id: string): { samples: Float32Array; sampleRate: number; durationMs: number } {
  const directory = join(root, 'decoded', id), meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate, durationMs: meta.durationMs };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q, lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
}
function metrics(residuals: (number | null)[]): Metrics {
  const matched = residuals.flatMap(value => value === null ? [] : [value]);
  const absolute = matched.map(Math.abs).sort((a, b) => a - b), within5 = absolute.filter(value => value <= 5).length;
  return { count: residuals.length, matched: matched.length, within5, within5msAll: residuals.length ? within5 / residuals.length : null, medianAbsMs: quantile(absolute, 0.5), p95AbsMs: quantile(absolute, 0.95) };
}
function summarize(hits: Hit[], residuals: (number | null)[]): Record<string, Metrics> {
  const output: Record<string, Metrics> = {};
  for (const region of ['all', 'dense', 'stable'] as const) {
    const selected = residuals.filter((_, index) => region === 'all' || hits[index].region === region);
    if (selected.length) output[region] = metrics(selected);
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
  const costs = emission.map(() => new Float64Array(count)), back = emission.map(() => new Int32Array(count));
  for (let i = 0; i < count; i++) costs[0][i] = emission[0].support ? -emission[0].scores[i] : 0;
  for (let segment = 1; segment < emission.length; segment++) {
    const penalty = emission[segment - 1].durationMs <= 1200 && emission[segment].durationMs <= 1200 ? TRANSITION_PENALTY : 0;
    for (let current = 0; current < count; current++) {
      const phase = PHASE_MIN + current * PHASE_STEP;
      let best = Infinity, bestPrevious = 0;
      for (let previous = 0; previous < count; previous++) {
        const previousPhase = PHASE_MIN + previous * PHASE_STEP, cost = costs[segment - 1][previous] + penalty * (phase - previousPhase) ** 2;
        if (cost < best) { best = cost; bestPrevious = previous; }
      }
      costs[segment][current] = best - (emission[segment].support ? emission[segment].scores[current] : 0);
      back[segment][current] = bestPrevious;
    }
  }
  let state = 0;
  for (let i = 1; i < count; i++) if (costs.at(-1)![i] < costs.at(-1)![state]) state = i;
  const phases = new Array(emission.length).fill(0);
  for (let segment = emission.length - 1; segment >= 0; segment--) { phases[segment] = PHASE_MIN + state * PHASE_STEP; state = back[segment][state]; }
  return phases;
}
function nearestResidual(peakTimes: number[], timeMs: number, globalDelay: number, phase: number): number | null {
  const target = timeMs + globalDelay + phase;
  let low = 0, high = peakTimes.length;
  while (low < high) { const middle = (low + high) >> 1; if (peakTimes[middle] < target - SEARCH_RADIUS_MS) low = middle + 1; else high = middle; }
  let best: number | null = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + SEARCH_RADIUS_MS; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - globalDelay - phase - timeMs;
}
function parseHits(osu: string, redlines: RedLine[]): Hit[] {
  const section = osu.split('[HitObjects]')[1]?.split('[')[0] ?? '';
  const times = [...new Set(section.split(/\r?\n/).map(row => Number(row.trim().split(',')[2])).filter(time => Number.isFinite(time) && time >= 0).map(time => Math.round(time)))].sort((a, b) => a - b);
  return times.map((timeMs, index) => {
    let active: RedLine | null = null;
    for (const line of redlines) { if (line.timeMs > timeMs) break; active = line; }
    const magnitude = 15 + (index * 47 + 19) % 81;
    return { timeMs, jitterMs: Math.max(0, timeMs + (index % 2 === 0 ? magnitude : -magnitude)), region: (active?.durationMs ?? Infinity) <= 1200 ? 'dense' : 'stable', index };
  });
}

function parseRedlines(osu: string, durationMs: number): RedLine[] {
  const section = osu.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const lines = section.split(/\r?\n/).flatMap(row => {
    const fields = row.trim().split(','), timeMs = Number(fields[0]), beatLength = Number(fields[1]);
    const uninherited = fields.length < 7 || Number(fields[6]) === 1;
    return uninherited && Number.isFinite(timeMs) && Number.isFinite(beatLength) && beatLength > 0
      ? [{ timeMs, bpm: 60000 / beatLength, beatLength }] : [];
  }).sort((a, b) => a.timeMs - b.timeMs);
  return lines.map((line, index) => {
    const fallbackEnd = line.timeMs + line.beatLength * 4;
    const endMs = index + 1 < lines.length ? lines[index + 1].timeMs : durationMs || fallbackEnd;
    return { timeMs: line.timeMs, endMs, durationMs: Math.max(0, Math.min(endMs, durationMs || endMs) - Math.max(0, line.timeMs)), bpm: line.bpm };
  });
}

const selection = JSON.parse(readFileSync(join(root, 'source-manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const numberArg = (name: string, fallback: number) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const start = Math.max(0, numberArg('start', 0)), limit = Math.max(1, numberArg('limit', 18));
mkdirSync(join(root, 'per-sample'), { recursive: true });
for (const selected of selection.samples.slice(start, start + limit)) {
  const id = selected.id as string;
  const { samples, sampleRate, durationMs } = loadAudio(id);
  const envelopes = multiBand(samples, sampleRate), full = envelopes[0];
  const reference = onsetEnvelope(samples, sampleRate, WIN, HOP).env;
  let maxDifference = 0;
  for (let i = 0; i < full.env.length; i++) maxDifference = Math.max(maxDifference, Math.abs(full.env[i] - reference[i]));
  const osu = readFileSync(selected.workspaceBeatmapPath, 'utf8');
  const redlines = parseRedlines(osu, durationMs);
  const hits = parseHits(osu, redlines), fullPeaks = peaks(full);
  const calibration = hits.filter(hit => hit.region === 'stable' && hit.timeMs >= 1000 && hit.timeMs <= durationMs - 1000).map(hit => hit.timeMs);
  const globalDelay = estimateGlobalDelay(full, calibration);
  const sampleOutput: Record<string, unknown> = {
    id, sourceBeatmapPath: selected.sourceBeatmapPath, workspaceBeatmapPath: selected.workspaceBeatmapPath, tag: selected.tag,
    globalDelay, fullEnvelopeMaxAbsDifference: maxDifference, redlines, hitCount: hits.length, denseHitCount: hits.filter(hit => hit.region === 'dense').length,
    hitTimesMs: hits.map(hit => hit.timeMs), fullPeakMs: fullPeaks,
    configurations: [] as unknown[],
  };
  for (const aggregate of ['max', 'top2'] as Aggregate[]) {
    const actualEmissions = Object.fromEntries(['all', 'even', 'odd'].map(fold => [fold, emissions(redlines, hits, envelopes, globalDelay.delayMs, fold as Fold, aggregate, false)])) as Record<Fold, SegmentEmission[]>;
    const nullEmissions = Object.fromEntries(['all', 'even', 'odd'].map(fold => [fold, emissions(redlines, hits, envelopes, globalDelay.delayMs, fold as Fold, aggregate, true)])) as Record<Fold, SegmentEmission[]>;
    for (const method of ['independent', 'dp'] as const) {
      const solve = (source: Record<Fold, SegmentEmission[]>, fold: Fold) => method === 'dp' ? dynamicPhases(source[fold]) : bestPhases(source[fold]);
      const actualPhases = { all: solve(actualEmissions, 'all'), even: solve(actualEmissions, 'even'), odd: solve(actualEmissions, 'odd') };
      const nullPhases = { all: solve(nullEmissions, 'all'), even: solve(nullEmissions, 'even'), odd: solve(nullEmissions, 'odd') };
      const evaluate = (nullControl: boolean, crossFit: boolean) => {
        const phaseSets = nullControl ? nullPhases : actualPhases;
        const residuals = hits.map(hit => {
          const segment = redlines.findIndex(line => hit.timeMs >= line.timeMs && hit.timeMs < line.endMs);
          const fold: Fold = hit.index % 2 === 0 ? 'odd' : 'even';
          const phase = crossFit ? phaseSets[fold][segment] ?? 0 : phaseSets.all[segment] ?? 0;
          return nearestResidual(fullPeaks, nullControl ? hit.jitterMs : hit.timeMs, globalDelay.delayMs, phase);
        });
        return summarize(hits, residuals);
      };
      const agreement = redlines.map((_, index) => Math.abs(actualPhases.even[index] - actualPhases.odd[index]));
      (sampleOutput.configurations as unknown[]).push({
        aggregate, method, actualFullFit: evaluate(false, false), actualCrossFit: evaluate(false, true), nullFullFit: evaluate(true, false), nullCrossFit: evaluate(true, true),
        phases: { actual: actualPhases, null: nullPhases }, evenOddMedianAbsDifferenceMs: quantile([...agreement].sort((a, b) => a - b), 0.5),
        evenOddWithin5msProportion: agreement.length ? agreement.filter(value => value <= 5).length / agreement.length : null,
      });
    }
  }
  sampleOutput.baselineGlobalOnly = summarize(hits, hits.map(hit => nearestResidual(fullPeaks, hit.timeMs, globalDelay.delayMs, 0)));
  writeFileSync(join(root, 'per-sample', `${id}.json`), JSON.stringify(sampleOutput, null, 2));
  console.log(JSON.stringify({ id, hits: hits.length, denseHits: sampleOutput.denseHitCount, delay: globalDelay.delayMs, envelopeDifference: maxDifference }));
}
console.log(`V574_BASELINE_BATCH_WRITTEN start=${start} limit=${limit}`);

// legacyResidual: 以现有谱面物件为候选位置，用原采样率多带 onset 与交叉拟合相位精修 offset。
// 参数与 verifier/v574 的 top2 + DP + even/odd cross-fit 配置保持一致；只在 worker 中运行。
import { fft, hannWindow } from './fft';
import type { ConstantTempoResult } from './bpmDetect';
import { mixdownMono, type AudioBufferLike } from './waveformData';

const WIN = 256, HOP = 11;
const SEARCH_RADIUS_MS = 10, PEAK_SUPPRESSION_MS = 5;
const PHASE_MIN = -30, PHASE_MAX = 30, PHASE_STEP = 0.5;
const TRANSITION_PENALTY = 0.0005;

type BandName = 'full' | 'low' | 'mid' | 'high';
type Fold = 'all' | 'even' | 'odd';
type Region = 'dense' | 'stable';

export interface LegacyResidual {
  /** 物件时刻（与输入同一时间轴） */
  timeMs: number;
  /** 最近 onset 换算回物件时间轴后的残差：新红线 offset = 旧 offset + residual */
  residualMs: number;
}

export interface LegacyResidualRedLineInput {
  timeMs: number;
  bpm: number;
}

export interface LegacyResidualInput {
  hitTimesMs: number[];
  redlines: LegacyResidualRedLineInput[];
}

interface RedLine extends LegacyResidualRedLineInput {
  endMs: number;
  durationMs: number;
  beatLength: number;
}

interface Hit {
  timeMs: number;
  region: Region;
  index: number;
}

interface Envelope {
  name: BandName;
  env: Float32Array;
  hopMs: number;
  biasMs: number;
}

interface SegmentEmission {
  scores: Float64Array;
  support: number;
  durationMs: number;
}

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

function estimateGlobalDelay(envelope: Envelope, calibration: number[]): number {
  let best = { delayMs: 0, score: -Infinity };
  for (let delay = -60; delay <= 60.0001; delay += 0.25) {
    let score = 0;
    for (const hit of calibration) score += sample(envelope, hit + delay);
    score = calibration.length ? score / calibration.length : 0;
    if (score > best.score) best = { delayMs: delay, score };
  }
  return best.delayMs;
}

function prepareRedlines(input: LegacyResidualRedLineInput[], durationMs: number): RedLine[] {
  const lines = input
    .filter(line => Number.isFinite(line.timeMs) && Number.isFinite(line.bpm) && line.bpm > 0)
    .map(line => ({ ...line, beatLength: 60000 / line.bpm }))
    .sort((a, b) => a.timeMs - b.timeMs);
  return lines.map((line, index) => {
    const fallbackEnd = line.timeMs + line.beatLength * 4;
    const endMs = index + 1 < lines.length ? lines[index + 1].timeMs : durationMs || fallbackEnd;
    return {
      ...line,
      endMs,
      durationMs: Math.max(0, Math.min(endMs, durationMs || endMs) - Math.max(0, line.timeMs)),
    };
  });
}

function prepareHits(times: number[], redlines: RedLine[]): Hit[] {
  const sorted = [...new Set(times.filter(time => Number.isFinite(time) && time >= 0).map(time => Math.round(time)))].sort((a, b) => a - b);
  return sorted.map((timeMs, index) => {
    let active: RedLine | null = null;
    for (const line of redlines) { if (line.timeMs > timeMs) break; active = line; }
    return { timeMs, region: (active?.durationMs ?? Infinity) <= 1200 ? 'dense' : 'stable', index };
  });
}

function segmentHits(redline: RedLine, hits: Hit[]): number[] {
  return hits.flatMap(hit => hit.timeMs >= redline.timeMs && hit.timeMs < redline.endMs ? [hit.index] : []);
}

function emissions(redlines: RedLine[], hits: Hit[], envelopes: Envelope[], globalDelay: number, fold: Fold): SegmentEmission[] {
  return redlines.map(redline => {
    const indices = segmentHits(redline, hits).filter(index => fold === 'all' || (fold === 'even' ? index % 2 === 0 : index % 2 === 1));
    const scores = new Float64Array(Math.round((PHASE_MAX - PHASE_MIN) / PHASE_STEP) + 1);
    for (let shiftIndex = 0; shiftIndex < scores.length; shiftIndex++) {
      const shift = PHASE_MIN + shiftIndex * PHASE_STEP;
      const noteScores = indices.map(index => {
        const time = hits[index].timeMs + globalDelay + shift;
        const bandScores = envelopes.map(envelope => sample(envelope, time)).sort((a, b) => b - a);
        return (bandScores[0] + bandScores[1]) / 2;
      }).sort((a, b) => b - a);
      const keep = Math.max(1, Math.round(noteScores.length * 0.8));
      scores[shiftIndex] = indices.length ? noteScores.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep : 0;
    }
    return { scores, support: indices.length, durationMs: redline.durationMs };
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
  const lastCosts = costs[costs.length - 1];
  for (let i = 1; i < count; i++) if (lastCosts[i] < lastCosts[state]) state = i;
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

/** 在原采样率音频上计算每个唯一物件时刻的 legacyResidual；缺峰物件不返回。 */
export function computeLegacyResiduals(buf: AudioBufferLike, input: LegacyResidualInput): LegacyResidual[] {
  if (buf.length < WIN || buf.numberOfChannels < 1 || input.hitTimesMs.length < 3 || !input.redlines.length) return [];
  const durationMs = buf.length / buf.sampleRate * 1000;
  const redlines = prepareRedlines(input.redlines, durationMs);
  const hits = prepareHits(input.hitTimesMs, redlines);
  if (hits.length < 3 || !redlines.length) return [];

  const mono = mixdownMono(buf);
  const envelopes = multiBand(mono, buf.sampleRate), full = envelopes[0];
  const fullPeaks = peaks(full);
  const calibration = hits.filter(hit => hit.region === 'stable' && hit.timeMs >= 1000 && hit.timeMs <= durationMs - 1000).map(hit => hit.timeMs);
  const globalDelay = estimateGlobalDelay(full, calibration);
  const phaseSets = {
    all: dynamicPhases(emissions(redlines, hits, envelopes, globalDelay, 'all')),
    even: dynamicPhases(emissions(redlines, hits, envelopes, globalDelay, 'even')),
    odd: dynamicPhases(emissions(redlines, hits, envelopes, globalDelay, 'odd')),
  };

  return hits.flatMap(hit => {
    const segment = redlines.findIndex(line => hit.timeMs >= line.timeMs && hit.timeMs < line.endMs);
    // 与 v574 相同：用另一奇偶折拟合当前物件，避免用物件自身证据过拟合。
    const fold: Fold = hit.index % 2 === 0 ? 'odd' : 'even';
    const phase = phaseSets[fold][segment] ?? 0;
    const residualMs = nearestResidual(fullPeaks, hit.timeMs, globalDelay, phase);
    return residualMs === null || !Number.isFinite(residualMs) ? [] : [{ timeMs: hit.timeMs, residualMs }];
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 用缺峰算缺失的无权重中位数精修实际输出。恒速单线使用全部物件；变速线按时间分段，
 * 每段至少 3 个有效残差才修改，否则完整保留原线，避免把缺候选误当成 0ms。
 */
export function refineConstantTempoOffsets(constant: ConstantTempoResult, residuals: LegacyResidual[]): ConstantTempoResult {
  const valid = residuals.filter(residual => Number.isFinite(residual.timeMs) && Number.isFinite(residual.residualMs));
  if (valid.length < 3) return constant;
  const refinedOffset = constant.offsetMs + median(valid.map(residual => residual.residualMs));
  if (constant.lines.length === 1) {
    return { ...constant, offsetMs: refinedOffset, lines: [{ ...constant.lines[0], time: refinedOffset }] };
  }

  const groups = constant.lines.map(() => [] as number[]);
  const sorted = [...valid].sort((a, b) => a.timeMs - b.timeMs);
  let lineIndex = 0;
  for (const residual of sorted) {
    while (lineIndex + 1 < constant.lines.length && residual.timeMs >= constant.lines[lineIndex + 1].time) lineIndex++;
    if (residual.timeMs >= constant.lines[lineIndex].time) groups[lineIndex].push(residual.residualMs);
  }
  const lines = constant.lines.map((line, index) => groups[index].length >= 3
    ? { ...line, time: line.time + median(groups[index]) }
    : { ...line });
  return { ...constant, offsetMs: refinedOffset, lines };
}


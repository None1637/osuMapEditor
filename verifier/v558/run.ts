// v558: 冻结相位/校准，仅消融差分距离与 SuperFlux 特征；不读取人工标注。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fft, hannWindow } from '../../src/osu/fft';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const v548 = join(root, '../v548');
const v557 = join(root, '../v557');
const config = JSON.parse(readFileSync(join(root, 'experiment.json'), 'utf8')) as {
  sampleIds: string[]; windowSamples: number; hopSamples: number; expectedDifferenceFrames: number;
};
const WIN = config.windowSamples, HOP = config.hopSamples;
const BANDS_PER_OCTAVE = 24, MIN_FREQUENCY = 27.5;

interface Envelope { env: Float32Array; hopMs: number; biasMs: number }
interface RedLine { timeMs: number; endMs: number; durationMs: number; bpm: number }
interface Hit { timeMs: number; index: number; segment: number }
interface SelectedSegment {
  segmentId: string; sampleId: string; referenceMs: number; fullResidualMs: number | null;
}
interface PhaseConfiguration {
  aggregate: string; method: string;
  phases: { actual: Record<'even' | 'odd', number[]> };
}
interface PreviousSample {
  globalDelay: { delayMs: number };
  redlines: RedLine[];
  configurations: PhaseConfiguration[];
}
interface CandidateRow {
  segmentId: string; sampleId: string; referenceMs: number; targetMs: number;
  globalDelayMs: number; phaseMs: number;
  fullResidualMs: number | null; lag5ResidualMs: number | null; superfluxResidualMs: number | null;
  fullGlobalResidualMs: number | null; lag5GlobalResidualMs: number | null; superfluxGlobalResidualMs: number | null;
  baselineResidualAbsDifferenceMs: number;
}
interface FilterBand { weights: { bin: number; weight: number }[] }

function loadAudio(id: string): { samples: Float32Array; sampleRate: number } {
  const directory = join(v541, 'decoded', id), meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')) as {
    length: number; numberOfChannels: number; sampleRate: number;
  };
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}

function normalize(raw: Float32Array, hopMs: number): Float32Array {
  const width = Math.max(1, Math.round(1000 / hopMs));
  const output = new Float32Array(raw.length), queue: number[] = [];
  let running = 0, maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]); running += raw[i];
    if (queue.length > width) running -= queue.shift()!;
    const value = Math.max(0, raw[i] - (running / queue.length) * 0.7);
    output[i] = value; maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}

function derivedDifferenceFrames(): number {
  const hann = hannWindow(WIN), firstAboveHalf = hann.findIndex(value => value > 0.5);
  return Math.max(1, Math.floor((WIN / 2 - firstAboveHalf) / HOP));
}

function createFilterbank(sampleRate: number): FilterBand[] {
  const centers: number[] = [];
  for (let index = 0; ; index++) {
    const center = MIN_FREQUENCY * 2 ** (index / BANDS_PER_OCTAVE);
    if (center > Math.min(16000, sampleRate / 2)) break;
    centers.push(center);
  }
  return centers.map((center, index) => {
    const left = index === 0 ? center / 2 ** (1 / BANDS_PER_OCTAVE) : centers[index - 1];
    const right = index + 1 < centers.length ? centers[index + 1] : center * 2 ** (1 / BANDS_PER_OCTAVE);
    const weights: { bin: number; weight: number }[] = [];
    for (let bin = 0; bin < WIN / 2; bin++) {
      const frequency = bin * sampleRate / WIN;
      if (frequency < left || frequency > right) continue;
      const weight = frequency <= center ? (frequency - left) / (center - left) : (right - frequency) / (right - center);
      if (weight > 0) weights.push({ bin, weight });
    }
    return { weights };
  });
}

function experimentalEnvelopes(samples: Float32Array, sampleRate: number, diffFrames: number): {
  adjacent: Envelope; lag5: Envelope; superflux: Envelope; filterbankBandCount: number;
} {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const rawAdjacent = new Float32Array(frames), rawLag = new Float32Array(frames), rawSuper = new Float32Array(frames);
  const hann = hannWindow(WIN), re = new Float32Array(WIN), im = new Float32Array(WIN);
  const filterbank = createFilterbank(sampleRate);
  const currentHistory = new Array<Float32Array>(diffFrames + 1), superHistory = new Array<Float32Array>(diffFrames + 1);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP;
    for (let i = 0; i < WIN; i++) { re[i] = samples[offset + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const current = new Float32Array(WIN / 2), rawMagnitude = new Float32Array(WIN / 2);
    for (let bin = 0; bin < current.length; bin++) {
      // 与生产 onsetEnvelope 保持同一运算顺序；rawMagnitude 仅供 SuperFlux 使用。
      current[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]) / (1 + bin / 24));
      rawMagnitude[bin] = Math.hypot(re[bin], im[bin]);
    }
    const filtered = new Float32Array(filterbank.length);
    for (let band = 0; band < filterbank.length; band++) {
      let sum = 0;
      for (const { bin, weight } of filterbank[band].weights) sum += rawMagnitude[bin] * weight;
      filtered[band] = Math.log10(1 + sum);
    }
    const slot = frame % (diffFrames + 1);
    if (frame > 0) {
      const previous = currentHistory[(frame - 1) % (diffFrames + 1)];
      let sum = 0;
      for (let bin = 0; bin < current.length; bin++) sum += Math.max(0, current[bin] - previous[bin]);
      rawAdjacent[frame] = sum;
    }
    if (frame >= diffFrames) {
      const previous = currentHistory[(frame - diffFrames) % (diffFrames + 1)];
      const previousFiltered = superHistory[(frame - diffFrames) % (diffFrames + 1)];
      let lagSum = 0, superSum = 0;
      for (let bin = 0; bin < current.length; bin++) lagSum += Math.max(0, current[bin] - previous[bin]);
      for (let band = 0; band < filtered.length; band++) {
        const previousMaximum = Math.max(
          previousFiltered[Math.max(0, band - 1)], previousFiltered[band], previousFiltered[Math.min(filtered.length - 1, band + 1)],
        );
        superSum += Math.max(0, filtered[band] - previousMaximum);
      }
      rawLag[frame] = lagSum; rawSuper[frame] = superSum;
    }
    currentHistory[slot] = current; superHistory[slot] = filtered;
  }
  const hopMs = HOP / sampleRate * 1000, biasMs = 3 * WIN / 4 / sampleRate * 1000;
  return {
    adjacent: { env: normalize(rawAdjacent, hopMs), hopMs, biasMs },
    lag5: { env: normalize(rawLag, hopMs), hopMs, biasMs },
    superflux: { env: normalize(rawSuper, hopMs), hopMs, biasMs },
    filterbankBandCount: filterbank.length,
  };
}

function peaks(envelope: Envelope): number[] {
  const radius = Math.round(5 / envelope.hopMs), output: number[] = [];
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

function nearest(peakTimes: number[], target: number): number | null {
  let low = 0, high = peakTimes.length;
  while (low < high) { const middle = (low + high) >> 1; if (peakTimes[middle] < target - 10) low = middle + 1; else high = middle; }
  let best: number | null = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + 10; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - target;
}

function parseHits(osu: string, redlines: RedLine[]): Hit[] {
  const section = osu.split('[HitObjects]')[1]?.split('[')[0] ?? '';
  const times = [...new Set(section.split(/\r?\n/).map(row => Number(row.trim().split(',')[2])).filter(time => Number.isFinite(time) && time >= 0).map(time => Math.round(time)))].sort((a, b) => a - b);
  return times.map((timeMs, index) => {
    let segment = -1;
    for (let i = 0; i < redlines.length; i++) if (timeMs >= redlines[i].timeMs && timeMs < redlines[i].endMs) { segment = i; break; }
    return { timeMs, index, segment };
  });
}

const selection = JSON.parse(readFileSync(join(v557, 'selection.json'), 'utf8')) as { segments: SelectedSegment[] };
const diffFrames = derivedDifferenceFrames();
if (diffFrames !== config.expectedDifferenceFrames) throw new Error(`差分距离推导变化: ${diffFrames}`);
mkdirSync(join(root, 'per-sample'), { recursive: true });
const allRows: CandidateRow[] = [];
for (const id of config.sampleIds) {
  const selectedSegments = selection.segments.filter(segment => segment.sampleId === id);
  const selectedBeatmap = JSON.parse(readFileSync(join(v548, 'selection.json'), 'utf8')) as {
    samples: { id: string; beatmapFile: string }[];
  };
  const beatmapFile = selectedBeatmap.samples.find(item => item.id === id)!.beatmapFile;
  const previous = JSON.parse(readFileSync(join(v548, 'per-sample', `${id}.json`), 'utf8')) as PreviousSample;
  const chosen = previous.configurations.find(item => item.aggregate === 'top2' && item.method === 'dp')!;
  const { samples, sampleRate } = loadAudio(id);
  const full: Envelope = { ...onsetEnvelope(samples, sampleRate, WIN, HOP), biasMs: 3 * WIN / 4 / sampleRate * 1000 };
  const experimental = experimentalEnvelopes(samples, sampleRate, diffFrames);
  let adjacentDifference = 0;
  if (experimental.adjacent.env.length !== full.env.length) throw new Error(`${id} 相邻帧包络长度不一致`);
  for (let i = 0; i < full.env.length; i++) adjacentDifference = Math.max(adjacentDifference, Math.abs(full.env[i] - experimental.adjacent.env[i]));
  if (adjacentDifference !== 0) throw new Error(`${id} 相邻帧实现与生产包络不一致: ${adjacentDifference}`);
  const fullPeaks = peaks(full), lagPeaks = peaks(experimental.lag5), superPeaks = peaks(experimental.superflux);
  const osu = readFileSync(join(v541, 'samples', id, beatmapFile), 'utf8');
  const hits = parseHits(osu, previous.redlines), hitByTime = new Map(hits.map(hit => [hit.timeMs, hit]));
  const rows: CandidateRow[] = selectedSegments.map(segment => {
    const hit = hitByTime.get(segment.referenceMs);
    if (!hit) throw new Error(`${segment.segmentId} 找不到谱面物件`);
    const fold = hit.index % 2 === 0 ? 'odd' : 'even';
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0;
    const target = hit.timeMs + previous.globalDelay.delayMs + phase;
    const fullResidualMs = nearest(fullPeaks, target);
    const stored = segment.fullResidualMs;
    const baselineDifference = fullResidualMs === null || stored === null
      ? (fullResidualMs === stored ? 0 : Infinity) : Math.abs(fullResidualMs - stored);
    if (baselineDifference !== 0) throw new Error(`${segment.segmentId} full 基线复现失败: ${baselineDifference}`);
    return {
      segmentId: segment.segmentId, sampleId: id, referenceMs: segment.referenceMs, targetMs: target,
      globalDelayMs: previous.globalDelay.delayMs, phaseMs: phase,
      fullResidualMs, lag5ResidualMs: nearest(lagPeaks, target), superfluxResidualMs: nearest(superPeaks, target),
      fullGlobalResidualMs: nearest(fullPeaks, hit.timeMs + previous.globalDelay.delayMs),
      lag5GlobalResidualMs: nearest(lagPeaks, hit.timeMs + previous.globalDelay.delayMs),
      superfluxGlobalResidualMs: nearest(superPeaks, hit.timeMs + previous.globalDelay.delayMs),
      baselineResidualAbsDifferenceMs: baselineDifference,
    };
  });
  allRows.push(...rows);
  writeFileSync(join(root, 'per-sample', `${id}.json`), JSON.stringify({
    id, differenceFrames: diffFrames, differenceMs: diffFrames * HOP / sampleRate * 1000,
    filterbankBandCount: experimental.filterbankBandCount, fullAdjacentMaxAbsDifference: adjacentDifference,
    peakCounts: { full: fullPeaks.length, lag5: lagPeaks.length, superflux: superPeaks.length }, rows,
  }, null, 2));
  console.log(JSON.stringify({ id, objects: rows.length, differenceFrames: diffFrames, bands: experimental.filterbankBandCount,
    peaks: { full: fullPeaks.length, lag5: lagPeaks.length, superflux: superPeaks.length }, adjacentDifference }));
}
writeFileSync(join(root, 'candidates.json'), JSON.stringify({
  version: 'v558-superflux-e1-candidates-v1', configuration: config, differenceFrames: diffFrames, rows: allRows,
}, null, 2));
console.log(`V558_CANDIDATES_WRITTEN objects=${allRows.length} diffFrames=${diffFrames}`);

// v549: 分解 80% 目标差距；事后 oracle 仅用于估计峰值/相位上限，不是预测精度。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const v548 = join(root, '../v548');
const HOP = 11, WIN = 256;
const PHASE_MIN = -30, PHASE_MAX = 30, PHASE_STEP = 0.5;
const SEARCH_RADIUS_MS = 10;
type Region = 'all' | 'stable' | 'dense';
interface RedLine { timeMs: number; endMs: number; durationMs: number }
interface Hit { timeMs: number; index: number; segment: number; region: Exclude<Region, 'all'> }
interface Metrics { count: number; matched: number; within5: number }
interface Summary { all: Metrics; stable: Metrics; dense?: Metrics }
interface Envelope { env: Float32Array; hopMs: number; biasMs: number }
interface PeakConfig { name: string; suppressionMs: number; threshold: number }

const peakConfigs: PeakConfig[] = [
  { name: 'sup20-th020-current', suppressionMs: 20, threshold: 0.02 },
  { name: 'sup10-th020', suppressionMs: 10, threshold: 0.02 },
  { name: 'sup05-th020', suppressionMs: 5, threshold: 0.02 },
  { name: 'sup00-th020', suppressionMs: 0, threshold: 0.02 },
  { name: 'sup10-th010', suppressionMs: 10, threshold: 0.01 },
  { name: 'sup05-th010', suppressionMs: 5, threshold: 0.01 },
  { name: 'sup10-th005', suppressionMs: 10, threshold: 0.005 },
  { name: 'sup05-th005', suppressionMs: 5, threshold: 0.005 },
];
function loadAudio(id: string): { samples: Float32Array; sampleRate: number; durationMs: number } {
  const directory = join(v541, 'decoded', id), meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate, durationMs: meta.durationMs };
}
function peaks(envelope: Envelope, config: PeakConfig): number[] {
  const radius = Math.round(config.suppressionMs / envelope.hopMs), output: number[] = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < config.threshold) continue;
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
function nearest(peakTimes: number[], target: number, radius: number): number | null {
  let low = 0, high = peakTimes.length;
  while (low < high) { const middle = (low + high) >> 1; if (peakTimes[middle] < target - radius) low = middle + 1; else high = middle; }
  let best: number | null = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + radius; index++) {
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
    const active = segment >= 0 ? redlines[segment] : undefined;
    return { timeMs, index, segment, region: (active?.durationMs ?? Infinity) <= 1200 ? 'dense' : 'stable' };
  });
}
function metrics(residuals: (number | null)[]): Metrics {
  const matched = residuals.filter(value => value !== null) as number[];
  return { count: residuals.length, matched: matched.length, within5: matched.filter(value => Math.abs(value) <= 5).length };
}
function summarize(hits: Hit[], residuals: (number | null)[]): Summary {
  const output: Summary = { all: metrics(residuals), stable: metrics(residuals.filter((_, index) => hits[index].region === 'stable')) };
  const dense = residuals.filter((_, index) => hits[index].region === 'dense');
  if (dense.length) output.dense = metrics(dense);
  return output;
}
function sumMetrics(target: Metrics, source: Metrics | undefined) {
  if (!source) return;
  target.count += source.count; target.matched += source.matched; target.within5 += source.within5;
}
function emptySummary(hasDense = true): Summary {
  const empty = () => ({ count: 0, matched: 0, within5: 0 });
  const output: Summary = { all: empty(), stable: empty() };
  if (hasDense) output.dense = empty();
  return output;
}
function addSummary(target: Summary, source: Summary) {
  sumMetrics(target.all, source.all); sumMetrics(target.stable, source.stable); sumMetrics(target.dense, source.dense);
}
function finalizeSummary(summary: Summary) {
  for (const region of ['all', 'stable', 'dense'] as Region[]) {
    const item = summary[region];
    if (!item) continue;
    Object.assign(item, {
      within5msAll: item.count ? item.within5 / item.count : null,
      matchCoverage: item.count ? item.matched / item.count : null,
    });
  }
  return summary;
}
function segmentOracle(hits: Hit[], peakTimes: number[], delay: number): (number | null)[] {
  const output = new Array<number | null>(hits.length).fill(null);
  const segments = new Map<number, number[]>();
  hits.forEach((hit, index) => {
    if (!segments.has(hit.segment)) segments.set(hit.segment, []);
    segments.get(hit.segment)!.push(index);
  });
  for (const [segment, indices] of segments) {
    if (segment < 0) {
      for (const index of indices) output[index] = nearest(peakTimes, hits[index].timeMs + delay, SEARCH_RADIUS_MS);
      continue;
    }
    let bestPhase = 0, bestCount = -1, bestResiduals: (number | null)[] = [];
    for (let phase = PHASE_MIN; phase <= PHASE_MAX + 1e-9; phase += PHASE_STEP) {
      const residuals = indices.map(index => nearest(peakTimes, hits[index].timeMs + delay + phase, SEARCH_RADIUS_MS));
      const count = residuals.filter(value => value !== null && Math.abs(value) <= 5).length;
      if (count > bestCount) { bestCount = count; bestPhase = phase; bestResiduals = residuals; }
    }
    indices.forEach((hitIndex, i) => { output[hitIndex] = bestResiduals[i]; });
    void bestPhase;
  }
  return output;
}

const selection = JSON.parse(readFileSync(join(v548, 'selection.json'), 'utf8'));
const samples = [];
for (const selected of selection.samples) {
  const id = selected.id as string;
  const previous = JSON.parse(readFileSync(join(v548, 'per-sample', `${id}.json`), 'utf8'));
  const redlines: RedLine[] = previous.redlines;
  const delay = previous.globalDelay.delayMs;
  const chosen = previous.configurations.find((config: { aggregate: string; method: string }) => config.aggregate === 'top2' && config.method === 'dp');
  const { samples: audio, sampleRate, durationMs } = loadAudio(id);
  const rawEnvelope = onsetEnvelope(audio, sampleRate, WIN, HOP);
  const envelope: Envelope = { ...rawEnvelope, biasMs: 3 * WIN / 4 / sampleRate * 1000 };
  const osu = readFileSync(join(v541, 'samples', id, selected.beatmapFile), 'utf8');
  const hits = parseHits(osu, redlines);
  const configurations = [];
  for (const config of peakConfigs) {
    const peakTimes = peaks(envelope, config);
    const actualResiduals = hits.map(hit => {
      const fold = hit.index % 2 === 0 ? 'odd' : 'even';
      const phase = chosen.phases.actual[fold][hit.segment] ?? 0;
      return nearest(peakTimes, hit.timeMs + delay + phase, SEARCH_RADIUS_MS);
    });
    const baselineResiduals = hits.map(hit => nearest(peakTimes, hit.timeMs + delay, SEARCH_RADIUS_MS));
    // 每个音都允许事后独立选相位：只要 ±35ms 内有峰，就可把该峰残差修正为 0。
    const noteOracleResiduals = hits.map(hit => nearest(peakTimes, hit.timeMs + delay, PHASE_MAX + 5) === null ? null : 0);
    const output: Record<string, unknown> = {
      ...config, peakCount: peakTimes.length,
      actual: summarize(hits, actualResiduals), baseline: summarize(hits, baselineResiduals), noteOracle: summarize(hits, noteOracleResiduals),
    };
    if (config.name === 'sup20-th020-current') output.segmentOracle = summarize(hits, segmentOracle(hits, peakTimes, delay));
    configurations.push(output);
  }
  samples.push({ id, selectionGroup: selected.selectionGroup, referenceVariable: selected.referenceVariable, globalDelay: previous.globalDelay, hitCount: hits.length, denseHitCount: hits.filter(hit => hit.region === 'dense').length, configurations });
  console.log(JSON.stringify({ id, hits: hits.length, current: configurations[0].actual.all, segmentOracle: configurations[0].segmentOracle.all, noteOracle: configurations[0].noteOracle.all }));
}
const aggregate = [];
for (const config of peakConfigs) {
  for (const subset of ['all', 'calibrationNormal'] as const) {
    const selectedSamples = samples.filter(sample => subset === 'all' || Math.abs(sample.globalDelay.delayMs) < 60 && sample.globalDelay.delayMs >= 0);
    const combined: Record<string, Summary> = { actual: emptySummary(), baseline: emptySummary(), noteOracle: emptySummary() };
    if (config.name === 'sup20-th020-current') combined.segmentOracle = emptySummary();
    for (const sample of selectedSamples) {
      const source = sample.configurations.find(item => item.name === config.name)!;
      for (const kind of Object.keys(combined)) addSummary(combined[kind], source[kind]);
    }
    for (const kind of Object.keys(combined)) finalizeSummary(combined[kind]);
    aggregate.push({ name: config.name, subset, songCount: selectedSamples.length, ...combined });
  }
}
const output = {
  version: 'v549-ceiling-diagnostic-v1',
  status: 'post_hoc_oracle_and_peak_sensitivity_not_independent_accuracy',
  target: '80% of hitobject onset measurements within 5 ms',
  phaseSource: 'v548 top2/dp actualCrossFit; no refitting in this diagnostic',
  oracleDefinition: 'segmentOracle chooses the best phase on the same notes being scored; noteOracle chooses an independent phase for every note; neither is a valid predictor',
  sampleCount: samples.length,
  aggregate,
  samples,
};
writeFileSync(join(root, 'ceiling-results.json'), JSON.stringify(output, null, 2));
console.log('V549_CEILING_ANALYSIS_WRITTEN');

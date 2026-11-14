// v573: 在六首预登记保留歌曲上复建 E13 输入、full 峰与分层盲标样本。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fft, hannWindow } from '../../src/osu/fft';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const SAMPLE_IDS = ['sample-017', 'sample-047', 'sample-054', 'sample-067', 'sample-077', 'sample-099'];
const PER_STRATUM = 10, MIN_SPACING_MS = 200;
const PRE_MS = 500, POST_MS = 500, HOP = 11, WIN = 256;
type Stratum = 'both-within5' | 'only-high-within5' | 'neither-within5';
interface RedLine { timeMs: number; endMs: number; durationMs: number; bpm: number }
interface Hit { timeMs: number; index: number; segment: number; region: 'stable' | 'dense'; bpm: number | null }
interface Candidate extends Hit { stratum: Stratum; fullResidualMs: number | null; highResidualMs: number | null }
interface Envelope { env: Float32Array; hopMs: number; biasMs: number }

function loadAudio(id: string): { samples: Float32Array; sampleRate: number } {
  const directory = join(v541, 'decoded', id), meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
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
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    output[i] = value; maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < output.length; i++) output[i] /= maximum;
  return output;
}
function highEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const raw = new Float32Array(frames), hann = hannWindow(WIN), re = new Float32Array(WIN), im = new Float32Array(WIN);
  let previous: Float32Array | null = null;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP;
    for (let i = 0; i < WIN; i++) { re[i] = samples[offset + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const magnitude = new Float32Array(WIN / 2);
    for (let bin = 0; bin < magnitude.length; bin++) magnitude[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]) / (1 + bin / 24));
    if (previous !== null) {
      let sum = 0;
      for (let bin = 33; bin < magnitude.length; bin++) sum += Math.max(0, magnitude[bin] - previous[bin]);
      raw[frame] = sum;
    }
    previous = magnitude;
  }
  const hopMs = HOP / sampleRate * 1000;
  return { env: normalize(raw, hopMs), hopMs, biasMs: 3 * WIN / 4 / sampleRate * 1000 };
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
    const active = segment >= 0 ? redlines[segment] : undefined;
    return { timeMs, index, segment, region: (active?.durationMs ?? Infinity) <= 1200 ? 'dense' : 'stable', bpm: active?.bpm ?? null };
  });
}
const hash = (id: string, timeMs: number) => createHash('sha256').update(`v557:${id}:${timeMs}`).digest('hex');
const clock = (ms: number) => {
  const total = Math.round(ms), minutes = Math.floor(total / 60000), remainder = total % 60000;
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(remainder / 1000)).padStart(2, '0')}.${String(remainder % 1000).padStart(3, '0')}`;
};
const manifest = JSON.parse(readFileSync(join(v541, 'manifest.json'), 'utf8'));
const selection = JSON.parse(readFileSync(join(root, '../v559/confirmation-selection.json'), 'utf8'));
const actualIds = selection.samples.map((item: { id: string }) => item.id);
if (JSON.stringify(actualIds) !== JSON.stringify(SAMPLE_IDS)) throw new Error(`固定选曲复核失败: ${actualIds.join(',')}`);
const segments = [];
const population = [];
mkdirSync(join(root, 'peaks'), { recursive: true });
for (const id of SAMPLE_IDS) {
  const selected = selection.samples.find((item: { id: string }) => item.id === id);
  const previous = JSON.parse(readFileSync(join(root, 'per-sample', `${id}.json`), 'utf8'));
  const chosen = previous.configurations.find((config: { aggregate: string; method: string }) => config.aggregate === 'top2' && config.method === 'dp');
  if (!chosen) throw new Error(`${id} 缺少冻结 top2/dp 配置`);
  const delay = previous.globalDelay.delayMs, redlines: RedLine[] = previous.redlines;
  const { samples, sampleRate } = loadAudio(id);
  const full: Envelope = { ...onsetEnvelope(samples, sampleRate, WIN, HOP), biasMs: 3 * WIN / 4 / sampleRate * 1000 };
  const fullPeaks = peaks(full), highPeaks = peaks(highEnvelope(samples, sampleRate));
  writeFileSync(join(root, 'peaks', `${id}.json`), JSON.stringify({ sampleId: id, fullPeakMs: fullPeaks }, null, 2));
  const osu = readFileSync(join(v541, 'samples', id, selected.beatmapFile), 'utf8');
  const hits = parseHits(osu, redlines);
  const candidates: Candidate[] = hits.map(hit => {
    const fold = hit.index % 2 === 0 ? 'odd' : 'even';
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0, target = hit.timeMs + delay + phase;
    const fullResidualMs = nearest(fullPeaks, target), highResidualMs = nearest(highPeaks, target);
    const fullGood = fullResidualMs !== null && Math.abs(fullResidualMs) <= 5;
    const highGood = highResidualMs !== null && Math.abs(highResidualMs) <= 5;
    const stratum: Stratum = fullGood && highGood ? 'both-within5' : highGood ? 'only-high-within5' : 'neither-within5';
    return { ...hit, stratum, fullResidualMs, highResidualMs };
  });
  const manifestItem = manifest.samples.find((item: { id: string }) => item.id === id);
  const originalAudioPath = `${manifestItem.sourceDirectory}\\${manifestItem.originalAudioFilename}`;
  const selectedForSample: Candidate[] = [];
  const strata = ['both-within5', 'only-high-within5', 'neither-within5'] as Stratum[];
  const pools = Object.fromEntries(strata.map(stratum => [stratum, candidates.filter(candidate => candidate.stratum === stratum).sort((a, b) => hash(id, a.timeMs).localeCompare(hash(id, b.timeMs)))])) as Record<Stratum, Candidate[]>;
  const quotas = Object.fromEntries(strata.map(stratum => [stratum, Math.min(PER_STRATUM, pools[stratum].length)])) as Record<Stratum, number>;
  while (strata.reduce((sum, stratum) => sum + quotas[stratum], 0) < 30) {
    const stratum = strata.filter(item => quotas[item] < pools[item].length).sort((a, b) => pools[b].length - pools[a].length || strata.indexOf(a) - strata.indexOf(b))[0];
    quotas[stratum]++;
  }
  for (const stratum of [...strata].sort((a, b) => quotas[a] - quotas[b] || strata.indexOf(a) - strata.indexOf(b))) {
    const pool = pools[stratum], quota = quotas[stratum];
    let count = 0;
    for (const candidate of pool) {
      if (selectedForSample.some(other => Math.abs(other.timeMs - candidate.timeMs) < MIN_SPACING_MS)) continue;
      const fold = candidate.index % 2 === 0 ? 'odd' : 'even';
      const phaseMs = chosen.phases.actual[fold][candidate.segment] ?? 0;
      const targetMs = candidate.timeMs + delay + phaseMs;
      segments.push({
        segmentId: `${id}_h${candidate.timeMs}`, sampleId: id,
        directoryName: selected.directoryName, beatmapFile: selected.beatmapFile, originalAudioPath,
        referenceMs: candidate.timeMs, referenceClock: clock(candidate.timeMs),
        clipStartMs: candidate.timeMs - PRE_MS, clipEndMs: candidate.timeMs + POST_MS,
        clipStartClock: clock(candidate.timeMs - PRE_MS), clipEndClock: clock(candidate.timeMs + POST_MS),
        stratum, stratumPopulation: pool.length, stratumSelected: quota, stratumWeight: pool.length / quota,
        selectionHash: hash(id, candidate.timeMs), region: candidate.region, bpm: candidate.bpm,
        hitIndex: candidate.index, fold, targetMs, globalDelayMs: delay, phaseMs,
        fullResidualMs: candidate.fullResidualMs, highResidualMs: candidate.highResidualMs,
        reviewedActualOnsetMs: null, confidence: null,
      });
      selectedForSample.push(candidate); count++;
      if (count === quota) break;
    }
    population.push({ sampleId: id, stratum, population: pool.length, selected: count, weight: pool.length / quota });
    if (count !== quota) throw new Error(`${id}/${stratum} 仅选到 ${count}/${quota}`);
  }
  console.log(JSON.stringify({ id, hits: hits.length, selected: selectedForSample.length, population: population.filter(item => item.sampleId === id) }));
}
writeFileSync(join(root, 'selection.json'), JSON.stringify({
  version: 'v573-e13-independent-song-confirmation-selection-v1', groundTruthStatus: 'pending_independent_review',
  target: 'confirm frozen E13 population-weighted clear+approximate +/-5 ms correct rate on six reserved songs',
  selectedSampleRule: 'exact v559 confirmation-selection.json sample ids and order; two constant, two variable-dense and two variable-other songs',
  selectionRule: '30 per song; each stratum min(10,population), rare strata selected first, deficits assigned one at a time to the largest non-full stratum; sha256(v557:sample-id:hit-time) order; at least 200 ms spacing; weights use actual stratum sample counts',
  strata: ['both-within5', 'only-high-within5', 'neither-within5'],
  clipPolicy: 'workspace decoded PCM to 16-bit WAV; reference -500 ms to +500 ms; no time stretching; algorithm onset candidates hidden from review plots',
  population, segments,
}, null, 2));
console.log(`V573_SELECTION_WRITTEN segments=${segments.length}`);

// v550: 按当前20ms与5ms峰设置的分歧分层，固定哈希抽取独立 onset 精标物件。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const v548 = join(root, '../v548');
const SAMPLE_IDS = ['sample-003', 'sample-042', 'sample-095'];
const PER_STRATUM = 10, MIN_SPACING_MS = 200;
const PRE_MS = 500, POST_MS = 500, HOP = 11, WIN = 256;
type Stratum = 'both-within5' | 'only-sup5-within5' | 'neither-within5';
interface RedLine { timeMs: number; endMs: number; durationMs: number; bpm: number }
interface Hit { timeMs: number; index: number; segment: number; region: 'stable' | 'dense'; bpm: number | null }
interface Candidate extends Hit { stratum: Stratum; currentResidualMs: number | null; sup5ResidualMs: number | null }
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
function peaks(envelope: Envelope, suppressionMs: number): number[] {
  const radius = Math.round(suppressionMs / envelope.hopMs), output: number[] = [];
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
const hash = (id: string, timeMs: number) => createHash('sha256').update(`v550:${id}:${timeMs}`).digest('hex');
const clock = (ms: number) => {
  const total = Math.round(ms), minutes = Math.floor(total / 60000), remainder = total % 60000;
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(remainder / 1000)).padStart(2, '0')}.${String(remainder % 1000).padStart(3, '0')}`;
};
const manifest = JSON.parse(readFileSync(join(v541, 'manifest.json'), 'utf8'));
const selection = JSON.parse(readFileSync(join(v548, 'selection.json'), 'utf8'));
const segments = [];
const population = [];
for (const id of SAMPLE_IDS) {
  const selected = selection.samples.find((item: { id: string }) => item.id === id);
  const previous = JSON.parse(readFileSync(join(v548, 'per-sample', `${id}.json`), 'utf8'));
  const chosen = previous.configurations.find((config: { aggregate: string; method: string }) => config.aggregate === 'top2' && config.method === 'dp');
  const delay = previous.globalDelay.delayMs, redlines: RedLine[] = previous.redlines;
  const { samples, sampleRate } = loadAudio(id);
  const rawEnvelope = onsetEnvelope(samples, sampleRate, WIN, HOP);
  const envelope: Envelope = { ...rawEnvelope, biasMs: 3 * WIN / 4 / sampleRate * 1000 };
  const currentPeaks = peaks(envelope, 20), sup5Peaks = peaks(envelope, 5);
  const osu = readFileSync(join(v541, 'samples', id, selected.beatmapFile), 'utf8');
  const hits = parseHits(osu, redlines);
  const candidates: Candidate[] = hits.map(hit => {
    const fold = hit.index % 2 === 0 ? 'odd' : 'even';
    const phase = chosen.phases.actual[fold][hit.segment] ?? 0, target = hit.timeMs + delay + phase;
    const currentResidualMs = nearest(currentPeaks, target), sup5ResidualMs = nearest(sup5Peaks, target);
    const currentGood = currentResidualMs !== null && Math.abs(currentResidualMs) <= 5;
    const sup5Good = sup5ResidualMs !== null && Math.abs(sup5ResidualMs) <= 5;
    const stratum: Stratum = currentGood && sup5Good ? 'both-within5' : sup5Good ? 'only-sup5-within5' : 'neither-within5';
    return { ...hit, stratum, currentResidualMs, sup5ResidualMs };
  });
  const manifestItem = manifest.samples.find((item: { id: string }) => item.id === id);
  const originalAudioPath = `${manifestItem.sourceDirectory}\\${manifestItem.originalAudioFilename}`;
  const selectedForSample: Candidate[] = [];
  for (const stratum of ['both-within5', 'only-sup5-within5', 'neither-within5'] as Stratum[]) {
    const pool = candidates.filter(candidate => candidate.stratum === stratum).sort((a, b) => hash(id, a.timeMs).localeCompare(hash(id, b.timeMs)));
    let count = 0;
    for (const candidate of pool) {
      if (selectedForSample.some(other => Math.abs(other.timeMs - candidate.timeMs) < MIN_SPACING_MS)) continue;
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
        confidence: null,
      });
      selectedForSample.push(candidate); count++;
      if (count === PER_STRATUM) break;
    }
    population.push({ sampleId: id, stratum, population: pool.length, selected: count, weight: pool.length / PER_STRATUM });
    if (count !== PER_STRATUM) throw new Error(`${id}/${stratum} 仅选到 ${count}/${PER_STRATUM}`);
  }
  console.log(JSON.stringify({ id, hits: hits.length, selected: selectedForSample.length, population: population.filter(item => item.sampleId === id) }));
}
const output = {
  version: 'v550-stratified-independent-onset-review-v1',
  groundTruthStatus: 'pending_independent_review',
  target: 'independently verify whether 20 ms and 5 ms peak settings achieve 80% within 5 ms',
  selectionRule: 'for each of 003/042/095, sha256(v550:sample-id:hit-time) order; 10 per stratum; at least 200 ms between selected references in one song',
  strata: ['both-within5', 'only-sup5-within5', 'neither-within5'],
  clipPolicy: 'workspace decoded PCM to 16-bit WAV; reference -500 ms to +500 ms; no time stretching; algorithm onset candidates hidden from review plots',
  population,
  segments,
};
writeFileSync(join(root, 'selection.json'), JSON.stringify(output, null, 2));
console.log(`V550_SELECTION_WRITTEN segments=${segments.length}`);

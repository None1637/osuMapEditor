// v545: 已知谱面时间先验下的 onset 精修可行性（oracle），不是全自动变速检测评估。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const sampleRoot = join(root, '../v541');
const ids = ['sample-001', 'sample-058'] as const;
type SampleId = typeof ids[number];
type FeatureName = 'energy' | 'spectral-flux';
type ReferenceKind = 'hitobject' | 'redline';
type Region = 'all' | 'dense' | 'stable';
type Scope = 'full' | 'review';

interface RedLine { timeMs: number; beatLengthMs: number; bpm: number; endMs: number; durationMs: number }
interface DecodeMeta { sampleRate: number; length: number; numberOfChannels: number; durationMs: number }
interface ManifestSample { id: string; sourceDirectory: string; beatmapFile: string; originalAudioFilename: string }
interface Envelope { name: FeatureName; env: Float32Array; hopMs: number; biasMs: number; threshold: number }
interface Peak { timeMs: number; strength: number }
interface Match { referenceMs: number; onsetMs: number | null; residualMs: number | null; strength: number; region: Exclude<Region, 'all'>; inReview: boolean }
interface DelayEstimate { delayMs: number; score: number; zeroDelayScore: number; separatedRunnerUpDelayMs: number | null; separatedRunnerUpScore: number | null; calibrationHitCount: number }
interface Metrics {
  count: number;
  matched: number;
  unmatched: number;
  matchCoverage: number | null;
  within5msAll: number;
  within5msMatched: number | null;
  medianAbsMs: number | null;
  p90AbsMs: number | null;
  p95AbsMs: number | null;
  medianSignedMs: number | null;
}

const SEARCH_RADIUS_MS = 15;
const PEAK_SUPPRESSION_RADIUS_MS = 20;
const DENSE_REDLINE_MAX_MS = 1200;
const reviewRanges: Record<SampleId, [number, number]> = {
  'sample-001': [175728, 185719],
  'sample-058': [31950, 45935],
};

function parseSections(osu: string, section: string): string[] {
  return (osu.split(`[${section}]`)[1]?.split('[')[0] ?? '').split(/\r?\n/);
}

function readRedLines(osu: string, audioDurationMs: number): RedLine[] {
  const lines = parseSections(osu, 'TimingPoints').map(row => row.trim().split(',')).filter(fields => {
    const time = Number(fields[0]);
    const beatLength = Number(fields[1]);
    return fields.length >= 2 && Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0 && (fields.length < 7 || Number(fields[6]) === 1);
  }).map(fields => ({ timeMs: Number(fields[0]), beatLengthMs: Number(fields[1]), bpm: 60000 / Number(fields[1]) }))
    .sort((a, b) => a.timeMs - b.timeMs);
  return lines.map((line, index) => {
    const endMs = Math.min(audioDurationMs, lines[index + 1]?.timeMs ?? audioDurationMs);
    return { ...line, endMs, durationMs: Math.max(0, endMs - line.timeMs) };
  });
}

function readHitObjects(osu: string): number[] {
  // 同一时间的同时音符/长键只保留一个：音频 onset 无法区分 chord 内各键。
  return [...new Set(parseSections(osu, 'HitObjects').map(row => Number(row.trim().split(',')[2]))
    .filter(time => Number.isFinite(time) && time >= 0).map(time => Math.round(time)))].sort((a, b) => a - b);
}

function loadAudio(id: SampleId): { samples: Float32Array; meta: DecodeMeta } {
  const directory = join(sampleRoot, 'decoded', id);
  const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')) as DecodeMeta;
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, meta };
}

function normalizeEnvelope(raw: Float32Array, hopMs: number): Float32Array {
  const width = Math.max(1, Math.round(1000 / hopMs));
  const normalized = new Float32Array(raw.length);
  const queue: number[] = [];
  let running = 0;
  let maximum = 0;
  for (let i = 0; i < raw.length; i++) {
    queue.push(raw[i]);
    running += raw[i];
    if (queue.length > width) running -= queue.shift()!;
    const value = Math.max(0, raw[i] - 0.7 * running / queue.length);
    normalized[i] = value;
    maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < normalized.length; i++) normalized[i] /= maximum;
  return normalized;
}

function energyEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const hop = 11;
  const halfWindow = Math.round(sampleRate * 0.005);
  const frames = Math.max(0, Math.floor((samples.length - 2 * halfWindow) / hop) + 1);
  const raw = new Float32Array(frames);
  let previous = 0;
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    let square = 0;
    for (let i = 0; i < 2 * halfWindow; i++) square += samples[start + i] ** 2;
    const logEnergy = Math.log1p(1000 * Math.sqrt(square / (2 * halfWindow)));
    raw[frame] = frame === 0 ? 0 : Math.max(0, logEnergy - previous);
    previous = logEnergy;
  }
  const hopMs = hop / sampleRate * 1000;
  return { name: 'energy', env: normalizeEnvelope(raw, hopMs), hopMs, biasMs: halfWindow / sampleRate * 1000, threshold: 0.02 };
}

function spectralEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const window = 256; // 23.22 ms；hop 11 ≈ 0.998 ms。
  const hop = 11;
  const result = onsetEnvelope(samples, sampleRate, window, hop);
  return { name: 'spectral-flux', env: result.env, hopMs: result.hopMs, biasMs: 3 * window / 4 / sampleRate * 1000, threshold: 0.02 };
}

function sampleEnvelope(envelope: Envelope, timeMs: number): number {
  const position = (timeMs - envelope.biasMs) / envelope.hopMs;
  const left = Math.floor(position);
  if (left < 0 || left + 1 >= envelope.env.length) return 0;
  const fraction = position - left;
  return envelope.env[left] * (1 - fraction) + envelope.env[left + 1] * fraction;
}

function estimateGlobalDelay(envelope: Envelope, calibrationHits: number[]): DelayEstimate {
  const candidates: { delayMs: number; score: number }[] = [];
  for (let delayMs = -60; delayMs <= 60.0001; delayMs += 0.25) {
    let score = 0;
    for (const hit of calibrationHits) score += sampleEnvelope(envelope, hit + delayMs);
    candidates.push({ delayMs, score: calibrationHits.length ? score / calibrationHits.length : 0 });
  }
  const best = candidates.reduce((a, b) => b.score > a.score ? b : a);
  const alternatives = candidates.filter(candidate => Math.abs(candidate.delayMs - best.delayMs) >= 5 && candidate.delayMs !== 0);
  const runnerUp = alternatives.length ? alternatives.reduce((a, b) => b.score > a.score ? b : a) : null;
  return {
    delayMs: best.delayMs,
    score: best.score,
    zeroDelayScore: candidates.find(candidate => candidate.delayMs === 0)?.score ?? 0,
    separatedRunnerUpDelayMs: runnerUp?.delayMs ?? null,
    separatedRunnerUpScore: runnerUp?.score ?? null,
    calibrationHitCount: calibrationHits.length,
  };
}

interface PhaseFit { shiftMs: number | null; score: number | null; zeroShiftScore: number | null }
interface LocalPhaseRecord {
  timeMs: number;
  bpm: number;
  durationMs: number;
  region: Exclude<Region, 'all'>;
  inReview: boolean;
  supportHitCount: number;
  actual: PhaseFit;
  jitterNull: PhaseFit;
}

function fitPhase(envelope: Envelope, hits: number[], globalDelayMs: number): PhaseFit {
  if (!hits.length) return { shiftMs: null, score: null, zeroShiftScore: null };
  let best = { shiftMs: 0, score: -Infinity };
  let zeroShiftScore = 0;
  for (let shiftMs = -30; shiftMs <= 30.0001; shiftMs += 0.25) {
    let score = 0;
    for (const hit of hits) score += sampleEnvelope(envelope, hit + globalDelayMs + shiftMs);
    score /= hits.length;
    if (Math.abs(shiftMs) < 1e-6) zeroShiftScore = score;
    if (score > best.score) best = { shiftMs, score };
  }
  return { ...best, zeroShiftScore };
}

function localPhase(envelope: Envelope, redLines: RedLine[], hitobjects: number[], jitteredHits: number[], globalDelayMs: number, reviewRange: [number, number]): LocalPhaseRecord[] {
  return redLines.map(line => {
    const indices = hitobjects.flatMap((time, index) => time >= line.timeMs && time < line.endMs ? [index] : []);
    return {
      timeMs: line.timeMs,
      bpm: line.bpm,
      durationMs: line.durationMs,
      region: line.durationMs <= DENSE_REDLINE_MAX_MS ? 'dense' : 'stable',
      inReview: line.timeMs >= reviewRange[0] && line.timeMs <= reviewRange[1],
      supportHitCount: indices.length,
      actual: fitPhase(envelope, indices.map(index => hitobjects[index]), globalDelayMs),
      jitterNull: fitPhase(envelope, indices.map(index => jitteredHits[index]), globalDelayMs),
    };
  });
}

function phaseMetrics(records: LocalPhaseRecord[], kind: 'actual' | 'jitterNull'): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const scope of ['full', 'review'] as Scope[]) {
    for (const region of ['all', 'dense', 'stable'] as Region[]) {
      for (const minimumSupport of [0, 1, 2, 4]) {
        const selected = records.filter(record => (scope === 'full' || record.inReview) &&
          (region === 'all' || record.region === region) && record.supportHitCount >= minimumSupport);
        if (!selected.length) continue;
        const shifts = selected.flatMap(record => record[kind].shiftMs === null ? [] : [record[kind].shiftMs!]);
        const absolute = shifts.map(Math.abs).sort((a, b) => a - b);
        const within5 = absolute.filter(value => value <= 5).length;
        output[`${scope}/${region}/support>=${minimumSupport}`] = {
          count: selected.length,
          supported: shifts.length,
          within5msAll: within5 / selected.length,
          within5msSupported: shifts.length ? within5 / shifts.length : null,
          medianAbsMs: quantile(absolute, 0.5),
          p95AbsMs: quantile(absolute, 0.95),
          medianSignedMs: quantile([...shifts].sort((a, b) => a - b), 0.5),
        };
      }
    }
  }
  return output;
}

function pickPeaks(envelope: Envelope, suppressionMs = PEAK_SUPPRESSION_RADIUS_MS): Peak[] {
  const peaks: Peak[] = [];
  const radius = Math.max(1, Math.round(suppressionMs / envelope.hopMs));
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < envelope.threshold) continue;
    let isMaximum = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(envelope.env.length - 1, i + radius); j++) {
      if (envelope.env[j] > center || (envelope.env[j] === center && j < i)) { isMaximum = false; break; }
    }
    if (!isMaximum) continue;
    const left = envelope.env[i - 1];
    const right = envelope.env[i + 1];
    const denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    peaks.push({ timeMs: (i + delta) * envelope.hopMs + envelope.biasMs, strength: center });
  }
  return peaks;
}

function activeRedLine(redLines: RedLine[], timeMs: number): RedLine | null {
  let active: RedLine | null = null;
  for (const line of redLines) {
    if (line.timeMs > timeMs) break;
    active = line;
  }
  return active;
}

function matchReferences(peaks: Peak[], references: number[], redLines: RedLine[], kind: ReferenceKind, delayMs: number, reviewRange: [number, number], forcedDelay = false, searchRadiusMs = SEARCH_RADIUS_MS): Match[] {
  const effectiveDelay = forcedDelay ? 0 : delayMs;
  return references.map(referenceMs => {
    const targetMs = referenceMs + effectiveDelay;
    let best: Peak | null = null;
    for (const peak of peaks) {
      if (peak.timeMs < targetMs - searchRadiusMs) continue;
      if (peak.timeMs > targetMs + searchRadiusMs) break;
      if (!best || Math.abs(peak.timeMs - targetMs) < Math.abs(best.timeMs - targetMs) ||
          (Math.abs(peak.timeMs - targetMs) === Math.abs(best.timeMs - targetMs) && peak.strength > best.strength)) best = peak;
    }
    const active = activeRedLine(redLines, referenceMs);
    const dense = kind === 'redline'
      ? (redLines.find(line => line.timeMs === referenceMs)?.durationMs ?? Infinity) <= DENSE_REDLINE_MAX_MS
      : (active?.durationMs ?? Infinity) <= DENSE_REDLINE_MAX_MS;
    return {
      referenceMs,
      onsetMs: best ? best.timeMs - effectiveDelay : null,
      residualMs: best ? best.timeMs - effectiveDelay - referenceMs : null,
      strength: best?.strength ?? 0,
      region: dense ? 'dense' : 'stable',
      inReview: referenceMs >= reviewRange[0] && referenceMs <= reviewRange[1],
    };
  });
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + (sorted[Math.min(lower + 1, sorted.length - 1)] * fraction);
}

function metrics(matches: Match[]): Metrics {
  const residuals = matches.flatMap(match => match.residualMs === null ? [] : [match.residualMs]);
  const absolute = residuals.map(Math.abs).sort((a, b) => a - b);
  const within5 = absolute.filter(value => value <= 5).length;
  return {
    count: matches.length,
    matched: residuals.length,
    unmatched: matches.length - residuals.length,
    matchCoverage: matches.length ? residuals.length / matches.length : null,
    within5msAll: matches.length ? within5 / matches.length : null,
    within5msMatched: residuals.length ? within5 / residuals.length : null,
    medianAbsMs: quantile(absolute, 0.5),
    p90AbsMs: quantile(absolute, 0.9),
    p95AbsMs: quantile(absolute, 0.95),
    medianSignedMs: quantile([...residuals].sort((a, b) => a - b), 0.5),
  };
}

function summarize(matches: Match[]): Record<string, Metrics> {
  const output: Record<string, Metrics> = {};
  for (const scope of ['full', 'review'] as Scope[]) {
    const scoped = matches.filter(match => scope === 'full' || match.inReview);
    for (const region of ['all', 'dense', 'stable'] as Region[]) {
      const regional = scoped.filter(match => region === 'all' || match.region === region);
      for (const strength of ['all', 'strong', 'weak'] as const) {
        const selected = regional.filter(match => strength === 'all' || (strength === 'strong' ? match.strength >= 0.1 : match.strength < 0.1));
        if (selected.length) output[`${scope}/${region}/${strength}`] = metrics(selected);
      }
    }
  }
  return output;
}

function syntheticValidation(feature: FeatureName): { metrics: Metrics; eventCount: number; forcedZeroDelay: boolean } {
  const sampleRate = 11025;
  const samples = new Float32Array(sampleRate * 12);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.03 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
  const events: number[] = [];
  const intervals = [137, 181, 93, 223, 151];
  let time = 432.1;
  for (let event = 0; event < 60; event++) {
    events.push(time);
    const start = Math.round(time / 1000 * sampleRate);
    for (let i = 0; i < 0.08 * sampleRate && start + i < samples.length; i++) {
      const t = i / sampleRate;
      samples[start + i] += 0.8 * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * 160 * t);
    }
    time += intervals[event % intervals.length];
  }
  const envelope = feature === 'energy' ? energyEnvelope(samples, sampleRate) : spectralEnvelope(samples, sampleRate);
  const matches = matchReferences(pickPeaks(envelope), events, [], 'hitobject', 0, [-Infinity, Infinity], true);
  return { metrics: metrics(matches), eventCount: events.length, forcedZeroDelay: true };
}

const manifest = JSON.parse(readFileSync(join(sampleRoot, 'manifest.json'), 'utf8')) as { samples: ManifestSample[] };
const labels = JSON.parse(readFileSync(join(root, 'label-review.json'), 'utf8'));
const output: Record<string, unknown> = {
  version: 'v545-oracle-onset-v5',
  status: 'oracle_agreement_not_automatic_detection_accuracy',
  labels,
  protocol: {
    audioSampleRateHz: 11025,
    energy: 'mono, centered 10 ms RMS, log positive difference, 11-sample hop (~0.998 ms)',
    spectralFlux: 'mono, 256-sample Hann STFT, log positive spectral difference, 11-sample hop; time bias=3*window/4',
    globalDelay: 'one delay per song/feature estimated on hitobjects outside both dense redline regions and the owner-reviewed interval; range +/-60 ms, step 0.25 ms',
    localRefinement: 'nearest non-maximum-suppressed peak within +/-15 ms of reference+globalDelay; parabolic subframe interpolation; no per-note delay fitting',
    peakPicking: 'local maximum over +/-20 ms (ties keep the earliest), amplitude >= 0.02; chosen to permit up to 50 onsets/s and reject the v2 peak-density artifact',
    significantPeakThreshold: 0.02,
    strongPeakThreshold: 0.1,
    denseDefinition: `active positive redline duration <= ${DENSE_REDLINE_MAX_MS} ms`,
    simultaneousHitobjects: 'deduplicated by integer millisecond',
    denominator: 'within5msAll includes unmatched references as failures; within5msMatched is conditional and not sufficient alone',
    jitterNull: 'each hitobject shifted by a deterministic nonzero offset in +/-15..95 ms; this tests accidental nearest-peak agreement but preserves neither acoustic labels nor rhythmic structure',
    parameterSweep: 'spectral-flux only: suppression 5/10/15/20 ms x search radius 10/15/20/30 ms; all 16 configurations are reported, no post-hoc best configuration is promoted',
    localPhase: 'per known redline segment, one phase in +/-30 ms (0.25 ms step) maximizes mean raw onset envelope at its hitobjects; stratified by 1/2/4 supporting notes and paired with jittered-hit null; no per-note phase fitting',
    limitation: 'Residual means agreement with mapper hitobject/redline times, not independently annotated acoustic-onset error. Redlines and hitobjects are oracle priors. No claim of automatic tempo discovery or per-note offset accuracy follows from these metrics alone.',
  },
  syntheticZeroDelayValidation: {
    energy: syntheticValidation('energy'),
    spectralFlux: syntheticValidation('spectral-flux'),
  },
  samples: [] as unknown[],
};
const detailRows = ['id,feature,kind,region,inReview,referenceMs,onsetMs,residualMs,strength,matched'];

for (const id of ids) {
  const item = manifest.samples.find(sample => sample.id === id);
  if (!item) throw new Error(`Missing manifest item ${id}`);
  const osuPath = join(sampleRoot, 'samples', id, item.beatmapFile);
  if (!existsSync(osuPath)) throw new Error(`Missing beatmap ${osuPath}`);
  const osu = readFileSync(osuPath, 'utf8');
  const { samples, meta } = loadAudio(id);
  const redLines = readRedLines(osu, meta.durationMs);
  const hitobjects = readHitObjects(osu);
  const [reviewStart, reviewEnd] = reviewRanges[id];
  const calibrationHits = hitobjects.filter(time => time >= 1000 && time <= meta.durationMs - 1000 &&
    (time < reviewStart || time > reviewEnd) && (activeRedLine(redLines, time)?.durationMs ?? Infinity) > DENSE_REDLINE_MAX_MS);
  const durations = redLines.map(line => line.durationMs).filter(duration => duration > 0).sort((a, b) => a - b);
  const sampleOutput: Record<string, unknown> = {
    id,
    sourceDirectory: item.sourceDirectory,
    originalAudioPath: join(item.sourceDirectory, item.originalAudioFilename),
    beatmapFile: item.beatmapFile,
    reviewRangeMs: reviewRanges[id],
    reviewExcludedFromGlobalDelayCalibration: true,
    audioDurationMs: meta.durationMs,
    redLineCount: redLines.length,
    denseRedLineCount: redLines.filter(line => line.durationMs <= DENSE_REDLINE_MAX_MS).length,
    redLineDurationMs: { median: quantile(durations, 0.5), p10: quantile(durations, 0.1), p90: quantile(durations, 0.9), minimum: durations[0] ?? null, maximum: durations.at(-1) ?? null },
    uniqueHitobjectTimeCount: hitobjects.length,
    calibrationHitCount: calibrationHits.length,
    redLines,
    features: {} as Record<string, unknown>,
  };
  for (const envelope of [energyEnvelope(samples, meta.sampleRate), spectralEnvelope(samples, meta.sampleRate)]) {
    console.log(JSON.stringify({ id, feature: envelope.name, frames: envelope.env.length }));
    const delay = estimateGlobalDelay(envelope, calibrationHits);
    const peaks = pickPeaks(envelope);
    const hitMatches = matchReferences(peaks, hitobjects, redLines, 'hitobject', delay.delayMs, reviewRanges[id]);
    const redlineMatches = matchReferences(peaks, redLines.map(line => line.timeMs), redLines, 'redline', delay.delayMs, reviewRanges[id]);
    const jitteredHits = hitobjects.map((time, index) => {
      const magnitude = 15 + (index * 47 + 19) % 81;
      return Math.max(0, Math.min(meta.durationMs, time + (index % 2 === 0 ? magnitude : -magnitude)));
    });
    const nullMatches = matchReferences(peaks, jitteredHits, redLines, 'hitobject', delay.delayMs, reviewRanges[id]);
    const parameterSweep: unknown[] = [];
    if (envelope.name === 'spectral-flux') {
      for (const suppressionMs of [5, 10, 15, 20]) {
        const sweepPeaks = pickPeaks(envelope, suppressionMs);
        for (const searchRadiusMs of [10, 15, 20, 30]) {
          const actual = matchReferences(sweepPeaks, hitobjects, redLines, 'hitobject', delay.delayMs, reviewRanges[id], false, searchRadiusMs);
          const nullControl = matchReferences(sweepPeaks, jitteredHits, redLines, 'hitobject', delay.delayMs, reviewRanges[id], false, searchRadiusMs);
          parameterSweep.push({
            suppressionMs,
            searchRadiusMs,
            peaksPerSecond: sweepPeaks.length / (meta.durationMs / 1000),
            actualReview: metrics(actual.filter(match => match.inReview)),
            nullReview: metrics(nullControl.filter(match => match.inReview)),
            actualReviewDense: metrics(actual.filter(match => match.inReview && match.region === 'dense')),
            nullReviewDense: metrics(nullControl.filter(match => match.inReview && match.region === 'dense')),
            actualFull: metrics(actual),
            nullFull: metrics(nullControl),
          });
        }
      }
    }
    const phaseRecords = localPhase(envelope, redLines, hitobjects, jitteredHits, delay.delayMs, reviewRanges[id]);
    (sampleOutput.features as Record<string, unknown>)[envelope.name] = {
      globalDelay: delay,
      significantPeakCount: peaks.length,
      significantPeaksPerSecond: peaks.length / (meta.durationMs / 1000),
      hitobject: summarize(hitMatches),
      hitobjectJitterNull: summarize(nullMatches),
      redline: summarize(redlineMatches),
      parameterSweep,
      localPhase: {
        actual: phaseMetrics(phaseRecords, 'actual'),
        jitterNull: phaseMetrics(phaseRecords, 'jitterNull'),
        records: phaseRecords,
      },
    };
    for (const [kind, matches] of [['hitobject', hitMatches], ['redline', redlineMatches]] as const) {
      for (const match of matches) detailRows.push([id, envelope.name, kind, match.region, match.inReview, match.referenceMs, match.onsetMs ?? '', match.residualMs ?? '', match.strength, match.residualMs !== null].join(','));
    }
  }
  (output.samples as unknown[]).push(sampleOutput);
}

writeFileSync(join(root, 'oracle-results.json'), JSON.stringify(output, null, 2));
writeFileSync(join(root, 'oracle-residuals.csv'), `${detailRows.join('\n')}\n`);
console.log('V545_ORACLE_ANALYSIS_WRITTEN');

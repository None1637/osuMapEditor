// v544: 开发集候选漏斗；区分未生成、三连音过滤和 RMS 复核，不改阈值、不使用第二组调参。
import fs from 'node:fs';
import path from 'node:path';
import { detectBpmHypothesis, variableTempoEvidence, type LocalTempoPoint, type VariableTempoEvidence } from '../../src/osu/bpmResearch';
import { inspectVariableEvidence } from '../../src/osu/bpmVariableVerifier';
import type { AudioBufferLike } from '../../src/osu/waveformData';

interface RedLine { time: number; beatLength: number; bpm: number; durationMs: number }
const root = __dirname;
const sourceRoot = path.join(root, '../v541');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const numberArg = (name: string, fallback: number) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const start = Math.max(0, numberArg('start', 0));
const limit = Math.max(1, numberArg('limit', 100));
const outputRoot = path.join(root, 'funnel-records-v3');
fs.mkdirSync(outputRoot, { recursive: true });

function redLines(osu: string, audioDurationMs: number | null): RedLine[] {
  const section = osu.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const lines: Omit<RedLine, 'durationMs'>[] = [];
  for (const row of section.split(/\r?\n/)) {
    const fields = row.trim().split(',');
    if (fields.length < 2) continue;
    const time = Number(fields[0]), beatLength = Number(fields[1]);
    const uninherited = fields.length < 7 || Number(fields[6]) === 1;
    if (uninherited && Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0) lines.push({ time, beatLength, bpm: 60000 / beatLength });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.map((line, index) => {
    const end = index + 1 < lines.length ? lines[index + 1].time : audioDurationMs ?? line.time + line.beatLength * 4;
    return { ...line, durationMs: Math.max(0, Math.min(end, audioDurationMs ?? end) - Math.max(0, line.time)) };
  });
}
function loadDecoded(id: string): { buf: AudioBufferLike; durationMs: number } | null {
  const directory = path.join(sourceRoot, 'decoded', id);
  if (!fs.existsSync(path.join(directory, 'meta.json'))) return null;
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
    const raw = fs.readFileSync(path.join(directory, `ch${channel}.f32`));
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  });
  return { durationMs: meta.durationMs, buf: { sampleRate: meta.sampleRate, length: meta.length, numberOfChannels: meta.numberOfChannels, getChannelData: channel => channels[channel] } };
}
function overlapMs(start: number, end: number, lines: RedLine[]): number {
  return lines.reduce((sum, line) => sum + Math.max(0, Math.min(end, line.time + line.durationMs) - Math.max(start, line.time)), 0);
}
function flagged(point: LocalTempoPoint, bpm: number): boolean {
  return Math.abs(Math.log(point.bpm / bpm)) >= Math.log(1.08) && point.support >= 0.045 && point.supportRatio >= 1.15 && point.onsetCount >= 6;
}
const key = (item: VariableTempoEvidence) => `${item.startMs}:${item.endMs}:${item.bpm}`;

for (const sample of manifest.samples.slice(start, start + limit)) {
  const outputPath = path.join(outputRoot, `${sample.id}.json`);
  if (fs.existsSync(outputPath)) { console.log(JSON.stringify({ id: sample.id, status: 'reused' })); continue; }
  const decoded = loadDecoded(sample.id);
  const osu = fs.readFileSync(path.join(sourceRoot, 'samples', sample.id, sample.beatmapFile), 'utf8');
  const lines = redLines(osu, decoded?.durationMs ?? null);
  const coverage = new Map<number, number>();
  for (const line of lines) coverage.set(line.bpm, (coverage.get(line.bpm) ?? 0) + line.durationMs);
  const dominant = [...coverage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const variableLines = dominant === null ? [] : lines.filter(line => Math.abs(line.bpm / dominant - 1) > 0.02);
  if (!decoded || dominant === null) {
    fs.writeFileSync(outputPath, JSON.stringify({ id: sample.id, directoryName: sample.directoryName, status: 'unavailable', referenceVariable: variableLines.length > 0 }));
    console.log(JSON.stringify({ id: sample.id, status: 'unavailable' }));
    continue;
  }
  const result = detectBpmHypothesis(decoded.buf);
  if (!result) {
    fs.writeFileSync(outputPath, JSON.stringify({ id: sample.id, directoryName: sample.directoryName, status: 'no_result', referenceVariable: variableLines.length > 0 }));
    continue;
  }
  const raw = variableTempoEvidence(result.local, result.bpm, false);
  const afterTriplet = variableTempoEvidence(result.local, result.bpm, true);
  const inspection = inspectVariableEvidence(decoded.buf, afterTriplet, result.bpm);
  const inspectionMap = new Map(inspection.map(item => [key(item), item]));
  const rawInspectionMap = new Map(inspectVariableEvidence(decoded.buf, raw, result.bpm).map(item => [key(item), item]));
  const afterKeys = new Set(afterTriplet.map(key));
  const candidates = raw.map(item => {
    const checked = rawInspectionMap.get(key(item));
    const variableOverlapMs = overlapMs(item.startMs, item.endMs, variableLines);
    return {
      ...item,
      rejection: !afterKeys.has(key(item)) ? 'triplet' : checked?.rejection ?? 'unknown',
      independentMainScore: checked?.independentMainScore ?? null,
      independentLocalScore: checked?.independentLocalScore ?? null,
      variableOverlapMs,
      overlapsVariable: variableOverlapMs > 0,
      tripletVotes: result.local.filter(point => point.timeMs >= item.startMs + 2000 && point.timeMs <= item.endMs - 2000)
        .map(point => ({ timeMs: point.timeMs, bpm: point.bpm, localGridCoverage: point.localGridCoverage, tripletGridCoverage: point.tripletGridCoverage, tripletGridHalfCoverage: point.tripletGridHalfCoverage, tripletGridDoubleCoverage: point.tripletGridDoubleCoverage })),
    };
  });
  const flaggedLocal = result.local.filter(point => flagged(point, result.bpm));
  const record = {
    id: sample.id,
    directoryName: sample.directoryName,
    sourceDirectory: sample.sourceDirectory,
    status: 'ok',
    referenceBpm: dominant,
    referenceVariable: variableLines.length > 0,
    predictedBpm: result.bpm,
    predictedVariable: result.variable,
    variableLines,
    trueVariableMs: variableLines.reduce((sum, line) => sum + line.durationMs, 0),
    flaggedWindowCount: flaggedLocal.length,
    flaggedWindowsOnVariable: flaggedLocal.filter(point => variableLines.some(line => point.timeMs >= line.time && point.timeMs <= line.time + line.durationMs)).length,
    rawCandidateCount: raw.length,
    rawCandidatesOnVariable: candidates.filter(item => item.overlapsVariable).length,
    finalEvidenceCount: result.evidence.length,
    finalEvidenceOnVariable: inspection.filter(item => item.accepted && overlapMs(item.startMs, item.endMs, variableLines) > 0).length,
    candidates,
  };
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id: sample.id, referenceVariable: record.referenceVariable, raw: raw.length, rawOnVariable: record.rawCandidatesOnVariable, final: result.evidence.length, finalOnVariable: record.finalEvidenceOnVariable }));
}

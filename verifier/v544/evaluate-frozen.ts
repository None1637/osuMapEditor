// v544: 验证三连音长段独立周期救回规则；v543 预测保持只读。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectBpmHypothesis } from '../../src/osu/bpmResearch';
import { extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

interface ManifestSample {
  id: string;
  directoryName: string;
  beatmapFile: string;
  localAudioFile: string | null;
}
interface RedLine { time: number; beatLength: number; bpm: number; durationMs: number }
interface DecodeMeta { sampleRate: number; length: number; numberOfChannels: number; durationMs: number }

const root = join(__dirname, '../v541');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { samples: ManifestSample[] };
const args = process.argv.slice(2);
const numberArg = (name: string, fallback: number): number => {
  const item = args.find(arg => arg.startsWith(`--${name}=`));
  return item ? Number(item.slice(name.length + 3)) : fallback;
};
const start = Math.max(0, numberArg('start', 0));
const limit = Math.max(1, numberArg('limit', 5));
const outputRoot = join(__dirname, 'frozen-predictions-final');
mkdirSync(outputRoot, { recursive: true });

function metadata(osu: string): Record<string, string> {
  const section = osu.split('[Metadata]')[1]?.split('[')[0] ?? '';
  const out: Record<string, string> = {};
  for (const row of section.split(/\r?\n/)) {
    const colon = row.indexOf(':');
    if (colon > 0) out[row.slice(0, colon).trim()] = row.slice(colon + 1).trim();
  }
  const mode = osu.match(/^\s*Mode\s*:\s*(\d+)\s*$/m);
  if (mode) out.Mode = mode[1];
  return out;
}

export function readReferenceRedLines(osu: string, audioDurationMs: number | null): RedLine[] {
  const section = osu.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const lines: Omit<RedLine, 'durationMs'>[] = [];
  for (const row of section.split(/\r?\n/)) {
    const fields = row.trim().split(',');
    if (fields.length < 2) continue;
    const time = Number(fields[0]);
    const beatLength = Number(fields[1]);
    const uninherited = fields.length < 7 || Number(fields[6]) === 1;
    if (uninherited && Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0) {
      lines.push({ time, beatLength, bpm: 60000 / beatLength });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.map((line, index) => {
    const nextTime = index + 1 < lines.length ? lines[index + 1].time : null;
    const fallbackEnd = line.time + line.beatLength * 4;
    const end = nextTime ?? audioDurationMs ?? fallbackEnd;
    return { ...line, durationMs: Math.max(0, Math.min(end, audioDurationMs ?? end) - Math.max(0, line.time)) };
  });
}

function loadDecoded(id: string): { buf: AudioBufferLike; meta: DecodeMeta } | null {
  const directory = join(root, 'decoded', id);
  const metaPath = join(directory, 'meta.json');
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as DecodeMeta;
  const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return new Float32Array(copy);
  });
  return {
    meta,
    buf: {
      sampleRate: meta.sampleRate,
      length: meta.length,
      numberOfChannels: meta.numberOfChannels,
      getChannelData: channel => channels[channel],
    },
  };
}

for (const sample of manifest.samples.slice(start, start + limit)) {
  const outputPath = join(outputRoot, `${sample.id}.json`);
  if (existsSync(outputPath)) {
    console.log(JSON.stringify({ id: sample.id, status: 'reused' }));
    continue;
  }
  const started = Date.now();
  const osu = readFileSync(join(root, 'samples', sample.id, sample.beatmapFile), 'utf8');
  const decoded = loadDecoded(sample.id);
  const redLines = readReferenceRedLines(osu, decoded?.meta.durationMs ?? null);
  const coverage = new Map<number, number>();
  for (const line of redLines) coverage.set(line.bpm, (coverage.get(line.bpm) ?? 0) + line.durationMs);
  const dominant = [...coverage.entries()].sort((a, b) => b[1] - a[1])[0];
  const referenceBpm = dominant?.[0] ?? null;
  const referenceVariable = referenceBpm === null ? null
    : redLines.some(line => Math.abs(line.bpm / referenceBpm - 1) > 0.02);
  const baseRecord: Record<string, unknown> = {
    id: sample.id,
    directoryName: sample.directoryName,
    beatmapFile: sample.beatmapFile,
    metadata: metadata(osu),
    audioDurationMs: decoded?.meta.durationMs ?? null,
    redLines,
    referenceBpm,
    referenceVariable,
    referenceRedLineCount: redLines.length,
    referenceCoverageMs: dominant?.[1] ?? 0,
  };
  if (!decoded) {
    writeFileSync(outputPath, JSON.stringify({ ...baseRecord, status: 'decode_unavailable', prediction: null, evaluationMs: Date.now() - started }, null, 2));
    console.log(JSON.stringify({ id: sample.id, status: 'decode_unavailable' }));
    continue;
  }
  try {
    const result = detectBpmHypothesis(decoded.buf);
    if (!result) {
      writeFileSync(outputPath, JSON.stringify({ ...baseRecord, status: 'no_result', prediction: null, evaluationMs: Date.now() - started }, null, 2));
      console.log(JSON.stringify({ id: sample.id, status: 'no_result' }));
      continue;
    }
    const constant = extractConstantTempo(result.base);
    const prediction = {
      bpm: result.bpm,
      offsetMs: result.offsetMs,
      variable: result.variable,
      evidence: result.evidence,
      localPointCount: result.local.length,
      rawBpm: constant?.bpm ?? null,
      rawSegmentCount: result.base.segments.length,
    };
    writeFileSync(outputPath, JSON.stringify({ ...baseRecord, status: 'ok', prediction, evaluationMs: Date.now() - started }, null, 2));
    console.log(JSON.stringify({ id: sample.id, status: 'ok', referenceBpm, referenceVariable, bpm: result.bpm, variable: result.variable, evaluationMs: Date.now() - started }));
  } catch (error) {
    writeFileSync(outputPath, JSON.stringify({ ...baseRecord, status: 'evaluation_error', error: String(error), prediction: null, evaluationMs: Date.now() - started }, null, 2));
    console.log(JSON.stringify({ id: sample.id, status: 'evaluation_error', error: String(error) }));
  }
}

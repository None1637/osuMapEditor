// v542: 对 v541 恒速标签误报 cohort 做独立时域瞬态/对象网格复核，不修改检测阈值。
import fs from 'node:fs';
import path from 'node:path';
import { detectBpmHypothesis } from '../../src/osu/bpmResearch';
import type { AudioBufferLike } from '../../src/osu/waveformData';

interface Evidence { startMs: number; endMs: number; bpm: number; points: number; maxSupport: number }
interface FrozenRecord {
  id: string;
  directoryName: string;
  beatmapFile: string;
  audioDurationMs: number;
  referenceBpm: number;
  referenceVariable: boolean | null;
  prediction: { bpm: number; variable: boolean; evidence: Evidence[] } | null;
}

const root = __dirname;
const v541 = path.resolve(root, '../v541');
const frozen = fs.readFileSync(path.join(v541, 'results.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as FrozenRecord);
const cohort = frozen.filter(record => record.referenceVariable === false && record.prediction?.variable);
const args = process.argv.slice(2);
const numberArg = (name: string, fallback: number) => {
  const item = args.find(arg => arg.startsWith(`--${name}=`));
  return item ? Number(item.slice(name.length + 3)) : fallback;
};
const start = Math.max(0, numberArg('start', 0));
const limit = Math.max(1, numberArg('limit', cohort.length));
const outputRoot = path.join(root, 'evidence-independent-v2');
fs.mkdirSync(outputRoot, { recursive: true });

function loadDecoded(id: string): AudioBufferLike {
  const directory = path.join(v541, 'decoded', id);
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
    const raw = fs.readFileSync(path.join(directory, `ch${channel}.f32`));
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  });
  return {
    sampleRate: meta.sampleRate,
    length: meta.length,
    numberOfChannels: meta.numberOfChannels,
    getChannelData: channel => channels[channel],
  };
}

/** 独立于原 STFT 频谱通量：20ms RMS、10ms hop 的时域能量正差分。 */
function timeDomainEnvelope(buf: AudioBufferLike, startMs: number, endMs: number): { env: Float32Array; hopMs: number } {
  const sr = buf.sampleRate;
  const hopMs = 10;
  const hop = Math.max(1, Math.round(sr * hopMs / 1000));
  const win = Math.max(hop, Math.round(sr * 0.02));
  const begin = Math.max(0, Math.floor(startMs / 1000 * sr));
  const finish = Math.min(buf.length, Math.ceil(endMs / 1000 * sr));
  const channels = Array.from({ length: buf.numberOfChannels }, (_, channel) => buf.getChannelData(channel));
  const energy: number[] = [];
  for (let offset = begin; offset + win < finish; offset += hop) {
    let sum = 0;
    for (const pcm of channels) {
      for (let i = offset; i < offset + win; i++) sum += pcm[i] * pcm[i];
    }
    energy.push(Math.log1p(100 * Math.sqrt(sum / (win * channels.length))));
  }
  const env = new Float32Array(Math.max(0, energy.length - 1));
  for (let i = 1; i < energy.length; i++) {
    // v542: 正差分即 onset；不能减去绝对 RMS 均值，否则持续响亮段会全部钳成零。
    env[i - 1] = Math.max(0, energy[i] - energy[i - 1]);
  }
  let max = 0;
  for (const value of env) max = Math.max(max, value);
  if (max > 0) for (let i = 0; i < env.length; i++) env[i] /= max;
  return { env, hopMs };
}

function correlation(env: Float32Array, lag: number): number | null {
  const base = Math.floor(lag);
  if (base < 2 || env.length < lag * 4 + 2) return null;
  let mean = 0;
  for (const value of env) mean += value;
  mean /= env.length;
  let numerator = 0, left = 0, right = 0, count = 0;
  for (let i = 0; i + base + 1 < env.length; i++) {
    const a = env[i] - mean;
    const fraction = lag - base;
    const b = (env[i + base] * (1 - fraction) + env[i + base + 1] * fraction) - mean;
    numerator += a * b;
    left += a * a;
    right += b * b;
    count++;
  }
  return count && left > 0 && right > 0 ? numerator / Math.sqrt(left * right) : null;
}
function periodicity(env: Float32Array, hopMs: number, bpm: number) {
  const lag = 60000 / bpm / hopMs;
  const first = correlation(env, lag);
  const second = correlation(env, lag * 2);
  const weighted = [{ value: first, weight: 0.67 }, { value: second, weight: 0.33 }]
    .filter((item): item is { value: number; weight: number } => item.value !== null);
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  return {
    lag,
    first,
    second,
    combined: weightSum ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum : null,
  };
}

function objectTimes(osu: string): number[] {
  const section = osu.split('[HitObjects]')[1] ?? '';
  return section.split(/\r?\n/).map(row => Number(row.split(',')[2])).filter(Number.isFinite);
}
function gridCoverage(times: number[], bpm: number, subdivision: number): number | null {
  if (times.length < 4) return null;
  const grid = 60000 / bpm / subdivision;
  let best = 0;
  for (let step = 0; step < 48; step++) {
    const phase = grid * step / 48;
    let matched = 0;
    for (const time of times) {
      const distance = ((time - phase) % grid + grid) % grid;
      if (Math.min(distance, grid - distance) <= 15) matched++;
    }
    best = Math.max(best, matched / times.length);
  }
  return best;
}

for (const record of cohort.slice(start, start + limit)) {
  const outputPath = path.join(outputRoot, `${record.id}.json`);
  if (fs.existsSync(outputPath)) {
    console.log(JSON.stringify({ id: record.id, status: 'reused' }));
    continue;
  }
  const started = Date.now();
  const buf = loadDecoded(record.id);
  const result = detectBpmHypothesis(buf);
  if (!result) throw new Error(`${record.id}: 冻结算法重跑为空`);
  const osu = fs.readFileSync(path.join(v541, 'samples', record.id, record.beatmapFile), 'utf8');
  const objects = objectTimes(osu);
  const evidence = result.evidence.map((item, index) => {
    const { env, hopMs } = timeDomainEnvelope(buf, item.startMs, item.endMs);
    const localPoints = result.local.filter(point => point.timeMs >= item.startMs + 2000 && point.timeMs <= item.endMs - 2000);
    const objectWindow = objects.filter(time => time >= item.startMs && time <= item.endMs);
    return {
      ...item,
      index,
      ratioToPredictedMain: item.bpm / result.bpm,
      ratioToAnnotatedMain: item.bpm / record.referenceBpm,
      boundary: item.startMs < 10000 ? 'start' : item.endMs > record.audioDurationMs - 10000 ? 'end' : 'interior',
      localBpmMin: localPoints.length ? Math.min(...localPoints.map(point => point.bpm)) : null,
      localBpmMax: localPoints.length ? Math.max(...localPoints.map(point => point.bpm)) : null,
      medianSupport: localPoints.length ? [...localPoints].sort((a, b) => a.support - b.support)[localPoints.length >> 1].support : null,
      timeDomain: {
        predictedMain: periodicity(env, hopMs, result.bpm),
        annotatedMain: periodicity(env, hopMs, record.referenceBpm),
        evidenceBpm: periodicity(env, hopMs, item.bpm),
      },
      objectCount: objectWindow.length,
      objectGrid: {
        predictedMainHalf: gridCoverage(objectWindow, result.bpm, 2),
        annotatedMainHalf: gridCoverage(objectWindow, record.referenceBpm, 2),
        evidenceHalf: gridCoverage(objectWindow, item.bpm, 2),
      },
    };
  });
  const output = {
    id: record.id,
    directoryName: record.directoryName,
    beatmapFile: record.beatmapFile,
    referenceBpm: record.referenceBpm,
    predictedBpm: result.bpm,
    frozenBpm: record.prediction?.bpm,
    deterministicEvidence: JSON.stringify(result.evidence) === JSON.stringify(record.prediction?.evidence),
    evidence,
    analysisMs: Date.now() - started,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ id: record.id, evidence: evidence.length, deterministic: output.deterministicEvidence, analysisMs: output.analysisMs }));
}

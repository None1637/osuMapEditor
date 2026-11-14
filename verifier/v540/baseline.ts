// v540: BPM 研究基线 — 严格检查 BPM 数值、唯一输出和变速误报，不接受倍速等价答案。
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

export interface SynthOptions {
  sr?: number;
  offbeat?: number;
  accentEvery?: number;
  noise?: number;
  drone?: number;
  jitterMs?: number;
  dropout?: number;
  seed?: number;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function constantBeats(bpm: number, count: number, startMs = 500): number[] {
  const period = 60000 / bpm;
  return Array.from({ length: count }, (_, i) => startMs + i * period);
}

export function segmentBeats(segments: { bpm: number; beats: number }[], startMs = 500): { beats: number[]; starts: number[] } {
  const beats: number[] = [];
  const starts: number[] = [];
  let t = startMs;
  for (const segment of segments) {
    starts.push(t);
    const period = 60000 / segment.bpm;
    for (let i = 0; i < segment.beats; i++) {
      beats.push(t);
      t += period;
    }
  }
  return { beats, starts };
}

export function rampBeats(bpm0: number, bpm1: number, count: number, startMs = 500): number[] {
  const beats: number[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    beats.push(t);
    const bpm = bpm0 + (bpm1 - bpm0) * (i / Math.max(1, count - 1));
    t += 60000 / bpm;
  }
  return beats;
}

/** 独立合成器：参考拍点在检测前已知，不由检测结果或 onset 峰反推。 */
export function synth(beats: number[], tailMs = 600, options: SynthOptions = {}): AudioBufferLike {
  const sr = options.sr ?? 11025;
  const random = rng(options.seed ?? 540);
  const n = Math.ceil((beats[beats.length - 1] + tailMs) / 1000 * sr);
  const data = new Float32Array(n);
  const put = (timeMs: number, amp: number, frequency: number, decay: number) => {
    const start = Math.max(0, Math.round(timeMs / 1000 * sr));
    const length = Math.min(n - start, Math.ceil(0.08 * sr));
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const attack = Math.min(1, i / 8);
      data[start + i] += attack * amp * Math.exp(-t / decay) * (
        Math.sin(2 * Math.PI * frequency * t) + 0.35 * Math.sin(2 * Math.PI * frequency * 1.97 * t)
      );
    }
  };
  const jittered = beats.filter(() => random() >= (options.dropout ?? 0)).map(t => {
    const jitter = (random() * 2 - 1) * (options.jitterMs ?? 0);
    return t + jitter;
  });
  for (let i = 0; i < jittered.length; i++) {
    const t = jittered[i];
    const accent = options.accentEvery && i % options.accentEvery === 0 ? 1.35 : 1;
    put(t, 0.55 * accent, i % 4 === 0 ? 120 : 180, 0.018);
    if (options.offbeat) {
      const next = jittered[i + 1] ?? t + 300;
      put((t + next) / 2, 0.55 * options.offbeat, 1800, 0.007);
    }
  }
  if (options.drone) {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      data[i] += options.drone * (Math.sin(2 * Math.PI * 55 * t) + 0.5 * Math.sin(2 * Math.PI * 110 * t));
    }
  }
  if (options.noise) for (let i = 0; i < n; i++) data[i] += (random() * 2 - 1) * options.noise;
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => data };
}

function gridErrorMs(beats: number[], bpm: number, offset: number): number {
  const period = 60000 / bpm;
  const errors = beats.map(t => Math.abs(t - offset - Math.round((t - offset) / period) * period));
  errors.sort((a, b) => a - b);
  return errors[Math.floor(errors.length / 2)] ?? Infinity;
}

export function runCurrent(name: string, expectedBpm: number | null, beats: number[], buf: AudioBufferLike) {
  const started = Date.now();
  const result = detectBpm(buf);
  const constant = extractConstantTempo(result);
  const bpm = constant?.bpm ?? NaN;
  const errorPct = expectedBpm && constant ? (bpm - expectedBpm) / expectedBpm * 100 : NaN;
  const gridError = constant && expectedBpm ? gridErrorMs(beats, bpm, constant.offsetMs) : NaN;
  const row = {
    name,
    expectedBpm,
    bpm: constant?.bpm,
    errorPct: Number.isFinite(errorPct) ? +errorPct.toFixed(3) : null,
    gridErrorMs: Number.isFinite(gridError) ? +gridError.toFixed(2) : null,
    lines: constant?.lines.length ?? 0,
    rawSegments: result.segments.length,
    variableSections: constant?.variableSections.length ?? 0,
    beats: result.beats.length,
    elapsedMs: Date.now() - started,
  };
  console.log(JSON.stringify(row));
  return row;
}

const only = process.argv[2];
const constants: { name: string; bpm: number; options?: SynthOptions }[] = [
  { name: 'plain-60', bpm: 60 },
  { name: 'plain-90', bpm: 90 },
  { name: 'plain-120', bpm: 120 },
  { name: 'plain-128', bpm: 128, options: { offbeat: 0.35 } },
  { name: 'plain-137.5', bpm: 137.5, options: { offbeat: 0.35 } },
  { name: 'plain-140.8', bpm: 140.8, options: { offbeat: 0.35 } },
  { name: 'plain-174', bpm: 174, options: { offbeat: 0.35 } },
  { name: 'plain-180', bpm: 180, options: { offbeat: 0.35 } },
  { name: 'plain-220', bpm: 220, options: { offbeat: 0.35 } },
  { name: 'plain-300', bpm: 300, options: { offbeat: 0.35 } },
  { name: 'plain-360', bpm: 360, options: { offbeat: 0.35 } },
  { name: 'strong-128', bpm: 128 },
  { name: 'strong-137.5', bpm: 137.5 },
  { name: 'strong-140.8', bpm: 140.8 },
  { name: 'strong-174', bpm: 174 },
  { name: 'strong-180', bpm: 180 },
  { name: 'strong-360', bpm: 360 },
  { name: 'accent-128', bpm: 128, options: { offbeat: 0.35, accentEvery: 4 } },
  { name: 'noise-drone-128', bpm: 128, options: { offbeat: 0.35, noise: 0.025, drone: 0.04 } },
  { name: 'jitter-dropout-128', bpm: 128, options: { offbeat: 0.35, jitterMs: 8, dropout: 0.08 } },
];
for (const test of constants) {
  if (only && only !== test.name) continue;
  const beats = constantBeats(test.bpm, 64);
  runCurrent(test.name, test.bpm, beats, synth(beats, 600, test.options));
}

const variableTests = [
  { name: 'step-128-173', beats: segmentBeats([{ bpm: 128, beats: 48 }, { bpm: 173, beats: 48 }]).beats },
  { name: 'ramp-120-180', beats: rampBeats(120, 180, 96) },
];
for (const test of variableTests) {
  if (only && only !== test.name) continue;
  runCurrent(test.name, null, test.beats, synth(test.beats, 600, { offbeat: 0.35 }));
}

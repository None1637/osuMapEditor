// v540: 独立合成验收 — 主 BPM 数值、恒速不误报、阶跃/渐变速可检。
import { detectBpmHypothesis, normalizePrimaryBpm, variableTempoEvidence, type LocalTempoPoint } from '../../src/osu/bpmResearch';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) { failures++; console.error('FAIL:', message); }
}
function randomFactory(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}
function beatsOf(bpm: number, count: number, start = 500) {
  return Array.from({ length: count }, (_, i) => start + i * 60000 / bpm);
}
function synth(beats: number[], options: { offbeat?: number; noise?: number; drone?: number; jitter?: number; dropout?: number; accent?: number } = {}): AudioBufferLike {
  const sr = 11025;
  const random = randomFactory(540);
  const data = new Float32Array(Math.ceil((beats[beats.length - 1] + 600) / 1000 * sr));
  const put = (ms: number, amplitude: number, frequency: number) => {
    const start = Math.max(0, Math.round(ms / 1000 * sr));
    for (let i = 0; i < 0.06 * sr && start + i < data.length; i++) {
      const t = i / sr;
      data[start + i] += amplitude * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * frequency * t);
    }
  };
  const actual = beats.filter(() => random() >= (options.dropout ?? 0)).map(t => t + (random() * 2 - 1) * (options.jitter ?? 0));
  for (let i = 0; i < actual.length; i++) {
    const accent = options.accent && i % options.accent === 0 ? 1.4 : 1;
    put(actual[i], 0.7 * accent, i % 4 === 0 ? 130 : 180);
    if (options.offbeat) put((actual[i] + (actual[i + 1] ?? actual[i] + 200)) / 2, 0.7 * options.offbeat, 1600);
  }
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] += (options.drone ?? 0) * Math.sin(2 * Math.PI * 55 * t) + (random() * 2 - 1) * (options.noise ?? 0);
  }
  return { sampleRate: sr, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}
function gridError(beats: number[], bpm: number, offset: number) {
  const period = 60000 / bpm;
  const errors = beats.map(t => Math.abs(t - offset - Math.round((t - offset) / period) * period)).sort((a, b) => a - b);
  return errors[errors.length >> 1];
}
function run(name: string, bpm: number | null, expectedVariable: boolean, beats: number[], options: Parameters<typeof synth>[1] = {}) {
  const result = detectBpmHypothesis(synth(beats, options));
  assert(!!result, `${name}: 结果非空`);
  if (!result) return;
  if (bpm !== null) {
    const expected = normalizePrimaryBpm(bpm);
    const error = Math.abs(result.bpm - expected) / expected;
    const offsetError = gridError(beats, result.bpm, result.offsetMs);
    assert(error <= 0.002, `${name}: BPM ${result.bpm} / 期望 ${expected}`);
    if (bpm <= 240) assert(offsetError <= 15, `${name}: offset 中位误差 ${offsetError.toFixed(2)}ms`);
    console.log(JSON.stringify({ name, expectedBpm: expected, bpm: result.bpm, offsetError: +offsetError.toFixed(2), variable: result.variable, evidence: result.evidence }));
  } else {
    console.log(JSON.stringify({ name, mainBpm: result.bpm, variable: result.variable, evidence: result.evidence }));
  }
  assert(result.variable === expectedVariable, `${name}: variable=${result.variable} / 期望 ${expectedVariable}`);
}

for (const bpm of [60, 90, 120, 128, 137.5, 140.8, 174, 180, 220]) run(`constant-${bpm}`, bpm, false, beatsOf(bpm, 64));
run('offbeat-128', 128, false, beatsOf(128, 96), { offbeat: 0.35 });
run('accent-128', 128, false, beatsOf(128, 96), { offbeat: 0.35, accent: 4 });
run('noise-drone-128', 128, false, beatsOf(128, 96), { offbeat: 0.35, noise: 0.02, drone: 0.04 });
run('jitter-dropout-128', 128, false, beatsOf(128, 96), { offbeat: 0.35, jitter: 8, dropout: 0.08 });
run('sparse-breakdown-128', 128, false, beatsOf(128, 96).filter((_, i) => i < 32 || i >= 64 || i % 2 === 0), { offbeat: 0.25 });
const shifted = beatsOf(128, 96).map((t, i) => i >= 40 && i < 64 ? t + 60000 / 128 * 0.2 : t);
run('phase-reset-128', 128, false, shifted, { offbeat: 0.25 });
// 显式倍程先验：高 BPM 只验证归一行为，不宣称从等间隔 click 恢复音乐拍号。
run('prior-fold-300', 300, false, beatsOf(300, 96));
run('prior-fold-360', 360, false, beatsOf(360, 96));

const step: number[] = [];
let t = 500;
for (const segment of [{ bpm: 128, beats: 48 }, { bpm: 173, beats: 48 }]) {
  for (let i = 0; i < segment.beats; i++) { step.push(t); t += 60000 / segment.bpm; }
}
run('step-128-173', null, true, step, { offbeat: 0.35 });
const ramp: number[] = [];
t = 500;
for (let i = 0; i < 96; i++) { ramp.push(t); t += 60000 / (120 + 60 * i / 95); }
run('ramp-120-180', null, true, ramp, { offbeat: 0.35 });
const shortStep = [...beatsOf(128, 40), ...beatsOf(173, 20, 500 + 40 * 60000 / 128)];
run('short-step-128-173', null, true, shortStep);

// 分类器单元测试：排除随机跳变，保留稳定新周期和连续渐变。
const point = (timeMs: number, bpm: number): LocalTempoPoint => ({ timeMs, bpm, support: 0.1, globalSupport: 0.04, supportRatio: 2.5, onsetCount: 20, globalGridCoverage: 0.7 });
assert(variableTempoEvidence([60, 82, 61, 140].map((bpm, i) => point(2000 + i * 1000, bpm)), 140).length === 0, '分类器: 随机跳变不报');
assert(variableTempoEvidence([170, 172, 174].map((bpm, i) => point(2000 + i * 1000, bpm)), 140).length === 1, '分类器: 稳定新周期应报');
assert(variableTempoEvidence([155, 168, 182].map((bpm, i) => point(2000 + i * 1000, bpm)), 140).length === 1, '分类器: 连续渐变应报');

console.log(failures ? `V540_SYNTH_FAILED: ${failures}` : 'V540_SYNTH_PASSED');
process.exit(failures ? 1 : 0);

// v543: 三连音不报变速；真实 1.5×/2/3 tempo 阶跃仍必须报；三首人工复核样本回归。
import fs from 'node:fs';
import path from 'node:path';
import { detectBpmHypothesis, isTripletRhythm, variableTempoEvidence, type LocalTempoPoint } from '../../src/osu/bpmResearch';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
}
function synth(events: { time: number; amplitude?: number }[]): AudioBufferLike {
  const sr = 11025;
  const data = new Float32Array(Math.ceil((events[events.length - 1].time + 1000) / 1000 * sr));
  for (const event of events) {
    const start = Math.round(event.time / 1000 * sr);
    for (let i = 0; i < 0.06 * sr && start + i < data.length; i++) {
      const t = i / sr;
      data[start + i] += (event.amplitude ?? 0.8) * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * 160 * t);
    }
  }
  return { sampleRate: sr, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}
function constantTriplet(bpm: number, subdivision: 3 | 6): AudioBufferLike {
  const events: { time: number; amplitude?: number }[] = [];
  const period = 60000 / bpm;
  for (let beat = 0; beat < 80; beat++) {
    for (let part = 0; part < subdivision; part++) events.push({ time: 500 + (beat + part / subdivision) * period, amplitude: part === 0 ? 1 : 0.42 });
  }
  return synth(events);
}
function tempoStep(from: number, to: number): AudioBufferLike {
  const events: { time: number }[] = [];
  let time = 500;
  for (const bpm of [from, to]) {
    for (let beat = 0; beat < 56; beat++) { events.push({ time }); time += 60000 / bpm; }
  }
  return synth(events);
}
function loadReal(id: string): AudioBufferLike {
  const directory = path.join(__dirname, '../v541/decoded', id);
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
    const raw = fs.readFileSync(path.join(directory, `ch${channel}.f32`));
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  });
  return { sampleRate: meta.sampleRate, numberOfChannels: meta.numberOfChannels, length: meta.length, getChannelData: channel => channels[channel] };
}
function point(timeMs: number, bpm: number, tripletGridCoverage: number): LocalTempoPoint {
  return { timeMs, bpm, support: 0.1, globalSupport: 0.04, supportRatio: 2.5, onsetCount: 20, globalGridCoverage: 0.7, tripletGridCoverage };
}
assert(isTripletRhythm(point(2000, 180, 0.9), 120), '1.5× 且 1/3、1/6 网格覆盖：三连音');
assert(!isTripletRhythm(point(2000, 180, 0.2), 120), '仅 1.5× 比值、无三连音网格：不能封杀');
assert(!isTripletRhythm({ ...point(2000, 172.266, 0.47), tripletGridHalfCoverage: 1, tripletGridDoubleCoverage: 1, localGridCoverage: 0.52 }, 128), '双倍基准不得把真实 4/3 阶跃解释为三连音');
assert(variableTempoEvidence([180, 180, 180, 180].map((bpm, i) => point(2000 + i * 1000, bpm, 0.9)), 120).length === 0, '连续三连音候选不报');
assert(variableTempoEvidence([180, 180, 180, 180].map((bpm, i) => point(2000 + i * 1000, bpm, 0.2)), 120).length === 1, '连续真实新周期候选保留');

for (const subdivision of [3, 6] as const) {
  const result = detectBpmHypothesis(constantTriplet(120, subdivision));
  assert(!!result && !result.variable, `恒速 1/${subdivision} 三连音：variable=${result?.variable}, bpm=${result?.bpm}`);
}
for (const [from, to] of [[120, 180], [120, 80]] as const) {
  const result = detectBpmHypothesis(tempoStep(from, to));
  assert(!!result?.variable, `真实 ${from}→${to} 阶跃必须报变速；evidence=${JSON.stringify(result?.evidence)}`);
}
for (const id of ['sample-032', 'sample-034', 'sample-088']) {
  const result = detectBpmHypothesis(loadReal(id));
  assert(!!result && !result.variable, `${id} 人工确认恒速；evidence=${JSON.stringify(result?.evidence)}`);
}
console.log(failures ? `V543_SYNTH_FAILED: ${failures}` : 'V543_SYNTH_PASSED');
process.exit(failures ? 1 : 0);

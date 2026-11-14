// v543: 诊断带 offbeat 的 128→173 阶跃，检查候选与独立 RMS 分数。
import { detectBpmHypothesis, variableTempoEvidence } from '../../src/osu/bpmResearch';
import { verifyVariableEvidence } from '../../src/osu/bpmVariableVerifier';
import type { AudioBufferLike } from '../../src/osu/waveformData';

function synth(beats: number[]): AudioBufferLike {
  const sr = 11025;
  const data = new Float32Array(Math.ceil((beats[beats.length - 1] + 600) / 1000 * sr));
  const put = (ms: number, amplitude: number, frequency: number) => {
    const start = Math.max(0, Math.round(ms / 1000 * sr));
    for (let i = 0; i < 0.06 * sr && start + i < data.length; i++) {
      const t = i / sr;
      data[start + i] += amplitude * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * frequency * t);
    }
  };
  for (let i = 0; i < beats.length; i++) {
    put(beats[i], 0.7, i % 4 === 0 ? 130 : 180);
    put((beats[i] + (beats[i + 1] ?? beats[i] + 200)) / 2, 0.7 * 0.35, 1600);
  }
  return { sampleRate: sr, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}
const beats: number[] = [];
let time = 500;
for (const segment of [{ bpm: 128, beats: 48 }, { bpm: 173, beats: 48 }]) {
  for (let i = 0; i < segment.beats; i++) { beats.push(time); time += 60000 / segment.bpm; }
}
const buf = synth(beats);
const result = detectBpmHypothesis(buf)!;
const candidates = variableTempoEvidence(result.local, result.bpm);
const independent = verifyVariableEvidence(buf, candidates.map(candidate => ({ ...candidate, localGridCoverage: 1 })), result.bpm);
console.log(JSON.stringify({ main: result.bpm, final: result.evidence, candidates, independent, local: result.local.map(point => ({ timeMs: point.timeMs, bpm: point.bpm, support: point.support, supportRatio: point.supportRatio, localGridCoverage: point.localGridCoverage, tripletGridCoverage: point.tripletGridCoverage })) }, null, 2));

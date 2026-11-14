// v543: 诊断真实 Carnival 候选在哪一层被过滤，不修改 fixture 或旧验收。
import fs from 'node:fs';
import path from 'node:path';
import { detectBpmHypothesis, variableTempoEvidence } from '../../src/osu/bpmResearch';
import { verifyVariableEvidence } from '../../src/osu/bpmVariableVerifier';

const directory = path.join(__dirname, '../v540/decoded/t+pazolite - Kick-ass Kung-fu Carnival');
const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
  const raw = fs.readFileSync(path.join(directory, `ch${channel}.f32`));
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
});
const buf = { sampleRate: meta.sampleRate, numberOfChannels: meta.numberOfChannels, length: meta.length, getChannelData: (channel: number) => channels[channel] };
const result = detectBpmHypothesis(buf)!;
const candidates = variableTempoEvidence(result.local, result.bpm);
const independent = verifyVariableEvidence(buf, candidates.map(candidate => ({ ...candidate, localGridCoverage: 1 })), result.bpm);
console.log(JSON.stringify({ main: result.bpm, final: result.evidence, candidates, independent }, null, 2));
for (const evidence of candidates) {
  console.log(JSON.stringify({
    evidence,
    points: result.local.filter(point => point.timeMs >= evidence.startMs + 2000 && point.timeMs <= evidence.endMs - 2000)
      .map(point => ({ timeMs: point.timeMs, bpm: point.bpm, support: point.support, supportRatio: point.supportRatio, localGridCoverage: point.localGridCoverage, tripletGridCoverage: point.tripletGridCoverage })),
  }, null, 2));
}
console.log(JSON.stringify({ trueRange: result.local.filter(point => point.timeMs >= 185000 && point.timeMs <= 205000)
  .map(point => ({ timeMs: point.timeMs, bpm: point.bpm, support: point.support, supportRatio: point.supportRatio, localGridCoverage: point.localGridCoverage, tripletGridCoverage: point.tripletGridCoverage, tripletHalf: point.tripletGridHalfCoverage, tripletDouble: point.tripletGridDoubleCoverage })) }, null, 2));

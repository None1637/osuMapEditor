// v543: 比较人工恒速样本的低网格候选与独立 RMS 证据，防止为 Carnival 放松规则后回潮。
import fs from 'node:fs';
import path from 'node:path';
import { detectBpmHypothesis, variableTempoEvidence } from '../../src/osu/bpmResearch';
import { verifyVariableEvidence } from '../../src/osu/bpmVariableVerifier';

for (const id of ['sample-032', 'sample-034', 'sample-088']) {
  const directory = path.join(__dirname, '../v541/decoded', id);
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  const channels = Array.from({ length: meta.numberOfChannels }, (_, channel) => {
    const raw = fs.readFileSync(path.join(directory, `ch${channel}.f32`));
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  });
  const buf = { sampleRate: meta.sampleRate, numberOfChannels: meta.numberOfChannels, length: meta.length, getChannelData: (channel: number) => channels[channel] };
  const result = detectBpmHypothesis(buf)!;
  const candidates = variableTempoEvidence(result.local, result.bpm);
  const independent = verifyVariableEvidence(buf, candidates.map(candidate => ({ ...candidate, localGridCoverage: 1 })), result.bpm);
  console.log(JSON.stringify({ id, main: result.bpm, candidates, independent }));
}

// v566: 独立遍历包络，复核每个原始上升沿索引、斜率和绝对时间。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const config = JSON.parse(readFileSync(join(root, 'experiment.json'), 'utf8'));
const payload = JSON.parse(readFileSync(join(root, 'raw-candidates.json'), 'utf8'));
const failures: string[] = [];
let refinedCount = 0;
let maximumTimeDifferenceMs = 0;
for (const id of config.sampleIds) {
  const directory = join(root, '../v541/decoded', id);
  const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  const envelope = onsetEnvelope(samples, meta.sampleRate, config.windowSamples, config.hopSamples);
  const biasMs = 3 * config.windowSamples / 4 / meta.sampleRate * 1000;
  for (const row of payload.rows.filter((item: any) => item.sampleId === id)) {
    if (row.fullCandidateAbsoluteMs === null) {
      if (row.e7RawCandidateAbsoluteMs !== null || row.e7RawSlopeIndex !== null) failures.push(`${row.segmentId}/缺失候选被新增`);
      continue;
    }
    const eligible: number[] = [];
    for (let i = 1; i < envelope.env.length; i++) {
      const timeMs = i * envelope.hopMs + biasMs;
      if (timeMs >= row.fullCandidateAbsoluteMs - config.localRuleParameters.risingSearchMs && timeMs <= row.fullCandidateAbsoluteMs) eligible.push(i);
      if (timeMs > row.fullCandidateAbsoluteMs) break;
    }
    if (!eligible.length) { failures.push(`${row.segmentId}/无有效帧`); continue; }
    const expectedSlope = Math.max(...eligible.map(i => envelope.env[i] - envelope.env[i - 1]));
    const expectedIndex = eligible.find(i => envelope.env[i] - envelope.env[i - 1] === expectedSlope)!;
    const expectedTime = (expectedIndex - 0.5) * envelope.hopMs + biasMs;
    if (row.e7RawSlopeIndex !== expectedIndex) failures.push(`${row.segmentId}/斜率索引 ${row.e7RawSlopeIndex} != ${expectedIndex}`);
    if (row.e7RawSlopeValue !== expectedSlope) failures.push(`${row.segmentId}/斜率值不一致`);
    const difference = Math.abs(row.e7RawCandidateAbsoluteMs - expectedTime);
    maximumTimeDifferenceMs = Math.max(maximumTimeDifferenceMs, difference);
    if (difference > 1e-9) failures.push(`${row.segmentId}/绝对时间差 ${difference}`);
    if (Math.abs(row.e7RawResidualMs - (expectedTime - row.targetMs)) > 1e-9) failures.push(`${row.segmentId}/残差错误`);
    refinedCount++;
  }
}
if (payload.rows.length !== 90 || refinedCount !== 83) failures.push(`数量错误 ${payload.rows.length}/${refinedCount}`);
writeFileSync(join(root, 'raw-validation.json'), JSON.stringify({
  version: 'v566-raw-rising-edge-independent-recheck-v1', passed: failures.length === 0,
  objects: payload.rows.length, refinedCount, maximumTimeDifferenceMs, failures,
}, null, 2));
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`ok: 90行原始候选，83个上升沿均从音频独立重建，最大时间差=${maximumTimeDifferenceMs}`);
console.log('V566_RAW_CANDIDATES_VALIDATION_PASSED');

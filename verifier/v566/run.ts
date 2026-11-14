// v566: 从冻结 full 峰提取唯一局部上升沿候选；不使用标签选择窗口或阈值。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const v541 = join(root, '../v541');
const v563 = join(root, '../v563');
const config = JSON.parse(readFileSync(join(root, 'experiment.json'), 'utf8')) as {
  sampleIds: string[]; windowSamples: number; hopSamples: number; productionCodeChanged: boolean;
  localRuleParameters: { risingSearchMs: number };
};
if (config.productionCodeChanged !== false) throw new Error('生产代码标志改变');
const source = JSON.parse(readFileSync(join(v563, 'calibrated-candidates.json'), 'utf8')) as {
  rows: { segmentId: string; sampleId: string; fullCandidateAbsoluteMs: number | null; [key: string]: unknown }[];
};

function loadAudio(id: string): { samples: Float32Array; sampleRate: number } {
  const directory = join(v541, 'decoded', id);
  const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')) as {
    length: number; numberOfChannels: number; sampleRate: number;
  };
  const samples = new Float32Array(meta.length);
  for (let channel = 0; channel < meta.numberOfChannels; channel++) {
    const raw = readFileSync(join(directory, `ch${channel}.f32`));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / meta.numberOfChannels;
  }
  return { samples, sampleRate: meta.sampleRate };
}

const outputRows: Record<string, unknown>[] = [];
for (const id of config.sampleIds) {
  const { samples, sampleRate } = loadAudio(id);
  const envelope = onsetEnvelope(samples, sampleRate, config.windowSamples, config.hopSamples);
  const biasMs = 3 * config.windowSamples / 4 / sampleRate * 1000;
  let refinedCount = 0;
  for (const row of source.rows.filter(item => item.sampleId === id)) {
    const original = row.fullCandidateAbsoluteMs;
    if (original === null) {
      outputRows.push({ ...row, e7RawSlopeIndex: null, e7RawSlopeValue: null,
        e7RawCandidateAbsoluteMs: null, e7RawResidualMs: null });
      continue;
    }
    let bestIndex: number | null = null, bestSlope = -Infinity;
    for (let i = 1; i < envelope.env.length; i++) {
      const timeMs = i * envelope.hopMs + biasMs;
      if (timeMs < original - config.localRuleParameters.risingSearchMs) continue;
      if (timeMs > original) break;
      const slope = envelope.env[i] - envelope.env[i - 1];
      if (slope > bestSlope) { bestSlope = slope; bestIndex = i; }
    }
    if (bestIndex === null) throw new Error(`${row.segmentId} 原峰前窗口没有包络帧`);
    const refined = (bestIndex - 0.5) * envelope.hopMs + biasMs;
    const targetMs = row.targetMs as number;
    outputRows.push({ ...row, e7RawSlopeIndex: bestIndex, e7RawSlopeValue: bestSlope,
      e7RawCandidateAbsoluteMs: refined, e7RawResidualMs: refined - targetMs });
    refinedCount++;
  }
  console.log(JSON.stringify({ id, refinedCount, hopMs: envelope.hopMs, biasMs }));
}
writeFileSync(join(root, 'raw-candidates.json'), JSON.stringify({
  version: 'v566-local-rising-edge-e7-raw-candidates-v1', configuration: config, rows: outputRows,
}, null, 2));
console.log(`V566_RAW_CANDIDATES_WRITTEN objects=${outputRows.length}`);

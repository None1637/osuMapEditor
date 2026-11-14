// v571: 导出冻结full峰并逐件校验v558候选parity；不读取人工标注。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onsetEnvelope } from '../../src/osu/bpmDetect';

const root = __dirname;
const config = JSON.parse(readFileSync(join(root, 'experiment.json'), 'utf8')) as {
  sampleIds: string[]; productionCodeChanged: boolean; status: string;
};
if (config.status !== 'frozen_before_diagnostic_evaluation' || config.productionCodeChanged !== false) {
  throw new Error('E12冻结配置改变');
}
const oldRows = JSON.parse(readFileSync(join(root, '../v558/candidates.json'), 'utf8')) as {
  rows: { segmentId: string; sampleId: string; targetMs: number; fullResidualMs: number | null }[];
};
interface Envelope { env: Float32Array; hopMs: number; biasMs: number }
function loadAudio(id: string): { samples: Float32Array; sampleRate: number } {
  const directory = join(root, '../v541/decoded', id);
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
function peaks(envelope: Envelope): number[] {
  const radius = Math.round(5 / envelope.hopMs), output: number[] = [];
  for (let i = 1; i + 1 < envelope.env.length; i++) {
    const center = envelope.env[i];
    if (center < 0.02) continue;
    let maximum = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(envelope.env.length - 1, i + radius); j++) {
      if (envelope.env[j] > center || (envelope.env[j] === center && j < i)) { maximum = false; break; }
    }
    if (!maximum) continue;
    const left = envelope.env[i - 1], right = envelope.env[i + 1], denominator = left - 2 * center + right;
    const delta = Math.abs(denominator) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0;
    output.push((i + delta) * envelope.hopMs + envelope.biasMs);
  }
  return output;
}
function nearest(peakTimes: number[], target: number): number | null {
  let low = 0, high = peakTimes.length;
  while (low < high) { const middle = (low + high) >> 1; if (peakTimes[middle] < target - 10) low = middle + 1; else high = middle; }
  let best: number | null = null;
  for (let index = low; index < peakTimes.length && peakTimes[index] <= target + 10; index++) {
    const peak = peakTimes[index];
    if (best === null || Math.abs(peak - target) < Math.abs(best - target)) best = peak;
  }
  return best === null ? null : best - target;
}
mkdirSync(join(root, 'per-sample'), { recursive: true });
const parityRows: Record<string, unknown>[] = [];
for (const id of config.sampleIds) {
  const { samples, sampleRate } = loadAudio(id);
  const full = { ...onsetEnvelope(samples, sampleRate, 256, 11), biasMs: 3 * 256 / 4 / sampleRate * 1000 };
  const fullPeaks = peaks(full);
  const rows = oldRows.rows.filter(row => row.sampleId === id);
  for (const row of rows) {
    const reproduced = nearest(fullPeaks, row.targetMs);
    const equal = reproduced === null || row.fullResidualMs === null
      ? reproduced === row.fullResidualMs : reproduced === row.fullResidualMs;
    if (!equal) throw new Error(`${row.segmentId} full parity失败: ${reproduced} != ${row.fullResidualMs}`);
    parityRows.push({ segmentId: row.segmentId, expectedResidualMs: row.fullResidualMs, reproducedResidualMs: reproduced });
  }
  writeFileSync(join(root, 'per-sample', `${id}.json`), JSON.stringify({
    sampleId: id, sampleRate, envelopeFrames: full.env.length, peakCount: fullPeaks.length, fullPeakMs: fullPeaks,
  }), 'utf8');
  console.log(JSON.stringify({ sampleId: id, frames: full.env.length, fullPeaks: fullPeaks.length, parityObjects: rows.length }));
}
if (parityRows.length !== 90) throw new Error(`parity物件数=${parityRows.length}`);
writeFileSync(join(root, 'peak-export-parity.json'), JSON.stringify({
  version: 'v571-full-peak-export-parity-v1', passed: true, comparisonRows: parityRows.length,
  exactResidualEquality: true, rows: parityRows,
}, null, 2), 'utf8');
console.log('V571_FULL_PEAKS_EXPORTED exactParityObjects=90');

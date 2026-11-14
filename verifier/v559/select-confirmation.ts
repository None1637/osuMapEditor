// v559: 为后续版本预登记全新确认集；不运行E2候选，不读取任何onset指标。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = __dirname;
const v541 = join(root, '../v541');
const v548 = join(root, '../v548');
const manifest = JSON.parse(readFileSync(join(v541, 'manifest.json'), 'utf8'));
const previous = JSON.parse(readFileSync(join(v548, 'selection.json'), 'utf8'));
const excluded = new Set<string>(['sample-001', 'sample-058', ...previous.samples.map((item: { id: string }) => item.id)]);
interface Candidate {
  id: string; referenceVariable: boolean; denseRedLineCount: number; redLineCount: number;
  referenceBpm: number | null; directoryName: string; beatmapFile: string;
}
const candidates: Candidate[] = [];
for (const item of manifest.samples) {
  if (excluded.has(item.id) || !existsSync(join(v541, 'decoded', item.id, 'meta.json'))) continue;
  const predictionPath = join(v541, 'predictions', `${item.id}.json`);
  if (!existsSync(predictionPath)) continue;
  const prediction = JSON.parse(readFileSync(predictionPath, 'utf8'));
  if (typeof prediction.referenceVariable !== 'boolean' || !Array.isArray(prediction.redLines)) continue;
  candidates.push({
    id: item.id, referenceVariable: prediction.referenceVariable,
    denseRedLineCount: prediction.redLines.filter((line: { durationMs: number }) => line.durationMs > 0 && line.durationMs <= 1200).length,
    redLineCount: prediction.redLines.length, referenceBpm: prediction.referenceBpm,
    directoryName: item.directoryName, beatmapFile: item.beatmapFile,
  });
}
const digest = (id: string) => createHash('sha256').update(`v559-confirmation:${id}`).digest('hex');
const hashOrder = (a: Candidate, b: Candidate) => digest(a.id).localeCompare(digest(b.id));
const pick = (pool: Candidate[], selectionGroup: string) => pool.sort(hashOrder).slice(0, 2)
  .map(item => ({ ...item, selectionGroup }));
const constant = pick(candidates.filter(item => !item.referenceVariable), 'constant-hash');
const variableDense = pick(candidates.filter(item => item.referenceVariable && item.denseRedLineCount >= 2), 'variable-dense-hash');
const variableOther = pick(candidates.filter(item => item.referenceVariable && item.denseRedLineCount < 2), 'variable-other-hash');
const samples = [...constant, ...variableDense, ...variableOther].sort((a, b) => a.id.localeCompare(b.id));
if (samples.length !== 6 || constant.length !== 2 || variableDense.length !== 2 || variableOther.length !== 2) throw new Error('确认集分层不足');
if (samples.some(item => excluded.has(item.id))) throw new Error('确认集混入旧开发/评估歌曲');
const output = {
  version: 'v559-future-independent-confirmation-selection-v1',
  status: 'reserved_not_decoded_by_v559_not_evaluated_not_labeled',
  selectionUsesOnlyBeatmapLabels: true,
  excludedDevelopmentAndEvaluationSamples: [...excluded].sort(),
  rule: 'From the original frozen 100-song sample, exclude 001/058 and all v548 songs; select two constant, two dense-variable and two other-variable songs by hash',
  hashNamespace: 'sha256(v559-confirmation:sample-id), lexicographic',
  denseDefinition: 'positive-duration uninherited redline with durationMs <=1200',
  intendedObjectsPerSong: 30,
  intendedTotalObjects: 180,
  samples,
};
writeFileSync(join(root, 'confirmation-selection.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ count: samples.length, constant: constant.map(item => item.id), variableDense: variableDense.map(item => item.id), variableOther: variableOther.map(item => item.id) }, null, 2));
console.log('V559_CONFIRMATION_SELECTION_WRITTEN');

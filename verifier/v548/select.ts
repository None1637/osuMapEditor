// v548: 固定20首泛化集；选择只看谱面标签，不看精修结果。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = __dirname;
const v541 = join(root, '../v541');
const manifest = JSON.parse(readFileSync(join(v541, 'manifest.json'), 'utf8'));
const excluded = new Set(['sample-001', 'sample-058']);
const forcedConstant = ['sample-032', 'sample-034', 'sample-088'];
interface Candidate { id: string; referenceVariable: boolean; denseRedLineCount: number; redLineCount: number; referenceBpm: number | null; directoryName: string; beatmapFile: string }
const candidates: Candidate[] = [];
for (const item of manifest.samples) {
  if (excluded.has(item.id) || !existsSync(join(v541, 'decoded', item.id, 'meta.json'))) continue;
  const predictionPath = join(v541, 'predictions', `${item.id}.json`);
  if (!existsSync(predictionPath)) continue;
  const prediction = JSON.parse(readFileSync(predictionPath, 'utf8'));
  if (typeof prediction.referenceVariable !== 'boolean' || !Array.isArray(prediction.redLines)) continue;
  candidates.push({
    id: item.id,
    referenceVariable: prediction.referenceVariable,
    denseRedLineCount: prediction.redLines.filter((line: { durationMs: number }) => line.durationMs > 0 && line.durationMs <= 1200).length,
    redLineCount: prediction.redLines.length,
    referenceBpm: prediction.referenceBpm,
    directoryName: item.directoryName,
    beatmapFile: item.beatmapFile,
  });
}
const hashOrder = (a: Candidate, b: Candidate) => createHash('sha256').update(`v548:${a.id}`).digest('hex').localeCompare(createHash('sha256').update(`v548:${b.id}`).digest('hex'));
const forced = forcedConstant.map(id => {
  const item = candidates.find(candidate => candidate.id === id);
  if (!item || item.referenceVariable) throw new Error(`人工恒速样本不可用：${id}`);
  return { ...item, selectionGroup: 'owner-confirmed-constant' };
});
const constantPool = candidates.filter(item => !item.referenceVariable && !forcedConstant.includes(item.id)).sort(hashOrder).slice(0, 7)
  .map(item => ({ ...item, selectionGroup: 'constant-hash' }));
const variableDense = candidates.filter(item => item.referenceVariable && item.denseRedLineCount >= 2).sort(hashOrder).slice(0, 5)
  .map(item => ({ ...item, selectionGroup: 'variable-dense-hash' }));
const variableOther = candidates.filter(item => item.referenceVariable && item.denseRedLineCount < 2).sort(hashOrder).slice(0, 5)
  .map(item => ({ ...item, selectionGroup: 'variable-other-hash' }));
const samples = [...forced, ...constantPool, ...variableDense, ...variableOther].sort((a, b) => a.id.localeCompare(b.id));
if (samples.length !== 20 || samples.filter(item => !item.referenceVariable).length !== 10 || samples.filter(item => item.referenceVariable).length !== 10 || variableDense.length !== 5 || variableOther.length !== 5) {
  throw new Error(`分层选样失败：${samples.length}，dense=${variableDense.length}，other=${variableOther.length}`);
}
const output = {
  version: 'v548-generalization-selection-v1',
  selectionUsesOnlyBeatmapLabels: true,
  excludedDevelopmentSamples: [...excluded],
  rule: '3 owner-confirmed constant + 7 hash-selected constant + 5 hash-selected variable with >=2 dense redlines + 5 hash-selected other variable; dense duration <=1200 ms',
  hashNamespace: 'sha256(v548:sample-id), lexicographic',
  samples,
};
writeFileSync(join(root, 'selection.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ count: samples.length, constant: 10, variable: 10, variableDense: variableDense.map(item => item.id), variableOther: variableOther.map(item => item.id), constantIds: samples.filter(item => !item.referenceVariable).map(item => item.id) }, null, 2));
console.log('V548_SELECTION_WRITTEN');

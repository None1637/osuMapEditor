// v544: 汇总候选过滤漏斗，分别统计全部候选和与谱面变速区相交的候选。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const records = fs.readdirSync(path.join(root, 'funnel-records')).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(fs.readFileSync(path.join(root, 'funnel-records', name), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));
const ok = records.filter(record => record.status === 'ok');
const variable = ok.filter(record => record.referenceVariable);
const constant = ok.filter(record => !record.referenceVariable);
const candidateCounts = (group, alignedOnly) => {
  const counts = {};
  for (const record of group) for (const candidate of record.candidates) {
    if (alignedOnly && !candidate.overlapsVariable) continue;
    counts[candidate.rejection] = (counts[candidate.rejection] ?? 0) + 1;
  }
  return counts;
};
const missed = variable.filter(record => !record.predictedVariable).map(record => ({
  id: record.id,
  directoryName: record.directoryName,
  sourceDirectory: record.sourceDirectory,
  referenceBpm: record.referenceBpm,
  predictedBpm: record.predictedBpm,
  flaggedWindowCount: record.flaggedWindowCount,
  flaggedWindowsOnVariable: record.flaggedWindowsOnVariable,
  rawCandidateCount: record.rawCandidateCount,
  rawCandidatesOnVariable: record.rawCandidatesOnVariable,
  alignedRejections: candidateCounts([record], true),
  variableLines: record.variableLines,
}));
const metrics = {
  version: 'v544-funnel',
  recordCount: records.length,
  evaluated: ok.length,
  variableSongs: variable.length,
  constantSongs: constant.length,
  variableSongFunnel: {
    flaggedWindowOnVariable: variable.filter(record => record.flaggedWindowsOnVariable > 0).length,
    rawCandidateOnVariable: variable.filter(record => record.rawCandidatesOnVariable > 0).length,
    finalDetection: variable.filter(record => record.predictedVariable).length,
    finalEvidenceOnVariable: variable.filter(record => record.finalEvidenceOnVariable > 0).length,
  },
  variableCandidates: {
    all: candidateCounts(variable, false),
    overlappingReferenceVariable: candidateCounts(variable, true),
  },
  constantCandidates: { all: candidateCounts(constant, false) },
  missedVariableSongs: missed,
};
fs.writeFileSync(path.join(root, 'funnel-metrics.json'), JSON.stringify(metrics, null, 2));
const lines = [
  '# v544：开发集变速候选漏斗', '',
  `- 成功分析 ${ok.length} 首，其中谱面变速 ${variable.length}、恒速 ${constant.length}。`,
  `- 变速歌曲：变速区有偏离窗 ${metrics.variableSongFunnel.flaggedWindowOnVariable}/${variable.length}；有原始候选 ${metrics.variableSongFunnel.rawCandidateOnVariable}/${variable.length}；最终检出 ${metrics.variableSongFunnel.finalDetection}/${variable.length}；最终证据与变速区相交 ${metrics.variableSongFunnel.finalEvidenceOnVariable}/${variable.length}。`, '',
  '## 候选拒绝原因', '',
  '```json', JSON.stringify({ variable: metrics.variableCandidates, constant: metrics.constantCandidates }, null, 2), '```', '',
  `## 未检出的变速歌曲（${missed.length}）`, '',
  '| ID | 偏离窗/变速区偏离窗 | 原始候选/变速区候选 | 变速区候选拒绝原因 |', '|---|---:|---:|---|',
  ...missed.map(record => `| ${record.id} | ${record.flaggedWindowCount} / ${record.flaggedWindowsOnVariable} | ${record.rawCandidateCount} / ${record.rawCandidatesOnVariable} | ${JSON.stringify(record.alignedRejections)} |`), '',
  '> “与变速区相交”只表示时间重叠，不证明候选 BPM 等于红线 BPM；用于定位过滤阶段，不作为精确段级正确率。', '',
];
fs.writeFileSync(path.join(root, 'funnel-summary.md'), lines.join('\n'));
console.log(JSON.stringify(metrics, null, 2));

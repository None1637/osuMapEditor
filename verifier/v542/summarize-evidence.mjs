// v542: 汇总独立复核，不把空值当零、不把谱面对象特征当作生产算法输入。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(path.join(root, 'evidence-independent-v2')).filter(name => name.endsWith('.json')).sort();
const records = files.map(name => JSON.parse(fs.readFileSync(path.join(root, 'evidence-independent-v2', name), 'utf8')));
const flat = records.flatMap(record => record.evidence.map(evidence => ({ id: record.id, directoryName: record.directoryName, referenceBpm: record.referenceBpm, ...evidence })));
const strongMainGrid = item => item.objectGrid.annotatedMainHalf !== null && item.objectGrid.evidenceHalf !== null
  && item.objectGrid.annotatedMainHalf >= 0.8 && item.objectGrid.annotatedMainHalf >= item.objectGrid.evidenceHalf + 0.2;
const strongEvidenceGrid = item => item.objectGrid.annotatedMainHalf !== null && item.objectGrid.evidenceHalf !== null
  && item.objectGrid.evidenceHalf >= 0.8 && item.objectGrid.evidenceHalf >= item.objectGrid.annotatedMainHalf + 0.2;
const points = {};
for (const item of flat) points[item.points] = (points[item.points] ?? 0) + 1;
const boundary = {};
for (const item of flat) boundary[item.boundary] = (boundary[item.boundary] ?? 0) + 1;
const metrics = {
  samples: records.length,
  evidence: flat.length,
  deterministic: records.every(record => record.deterministicEvidence && record.bpmMatchesFrozen !== false && record.predictedBpm === record.frozenBpm),
  points,
  minimumThreePointEvidence: flat.filter(item => item.points === 3).length,
  boundary,
  timeDomain: {
    mainAtLeastLocal: flat.filter(item => item.timeDomain.annotatedMain.combined >= item.timeDomain.evidenceBpm.combined).length,
    localAboveMain: flat.filter(item => item.timeDomain.annotatedMain.combined < item.timeDomain.evidenceBpm.combined).length,
    nullCombined: flat.filter(item => item.timeDomain.annotatedMain.combined === null || item.timeDomain.evidenceBpm.combined === null).length,
  },
  objectGrid: {
    strongMainEvidence: flat.filter(strongMainGrid).length,
    strongLocalEvidence: flat.filter(strongEvidenceGrid).length,
    strongLocal: flat.filter(strongEvidenceGrid).map(item => ({ id: item.id, index: item.index, bpm: item.bpm, mainBpm: item.referenceBpm, ratio: item.ratioToAnnotatedMain })),
  },
  samplesWithStrongMainGrid: records.filter(record => record.evidence.some(strongMainGrid)).length,
  samplesOnlyMinimumThreePointEvidence: records.filter(record => record.evidence.every(item => item.points === 3)).length,
  tripletCandidates: flat.filter(item => Math.abs(item.ratioToAnnotatedMain / 1.5 - 1) <= 0.01)
    .map(item => ({ id: item.id, index: item.index, bpm: item.bpm, mainBpm: item.referenceBpm, ratio: item.ratioToAnnotatedMain })),
};
fs.writeFileSync(path.join(root, 'evidence-summary.json'), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));

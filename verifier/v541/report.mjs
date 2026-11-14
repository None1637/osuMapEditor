// v541: 汇总冻结样本；所有率均以 100 为主分母，另给可评估子集，失败不剔除。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const records = manifest.samples.map(sample => {
  const file = path.join(root, 'predictions', `${sample.id}.json`);
  const record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    ...sample,
    status: 'not_evaluated',
    referenceBpm: null,
    referenceVariable: null,
    referenceRedLineCount: 0,
    prediction: null,
  };
  const reference = Number(record.referenceBpm);
  const predicted = Number(record.prediction?.bpm);
  const hasReference = Number.isFinite(reference) && reference > 0;
  const hasPrediction = Number.isFinite(predicted) && predicted > 0;
  const relativeBpmError = hasReference && hasPrediction ? Math.abs(predicted / reference - 1) : null;
  const strictCorrect = relativeBpmError !== null && relativeBpmError <= 0.002;
  let octaveOnly = false;
  if (!strictCorrect && hasReference && hasPrediction) {
    const octave = Math.round(Math.log2(predicted / reference));
    octaveOnly = octave !== 0 && Math.abs(predicted / (reference * 2 ** octave) - 1) <= 0.002;
  }
  const classCorrect = typeof record.referenceVariable === 'boolean' && typeof record.prediction?.variable === 'boolean'
    && record.referenceVariable === record.prediction.variable;
  const bothCorrect = strictCorrect && classCorrect;
  let category = 'correct';
  if (!hasReference) category = 'invalid_reference';
  else if (record.status !== 'ok') category = record.status;
  else if (!strictCorrect && !classCorrect) category = 'bpm_and_classification_error';
  else if (!strictCorrect) category = octaveOnly ? 'octave_error' : 'bpm_error';
  else if (!classCorrect) category = record.referenceVariable ? 'variable_false_negative' : 'variable_false_positive';
  return {
    ...record,
    evaluation: {
      relativeBpmError,
      strictCorrect,
      octaveOnly,
      classCorrect,
      bothCorrect,
      category,
    },
  };
});

const total = records.length;
const validReference = records.filter(r => Number(r.referenceBpm) > 0).length;
const evaluated = records.filter(r => r.status === 'ok' && Number(r.referenceBpm) > 0);
const count = predicate => records.filter(predicate).length;
const strictCorrect = count(r => r.evaluation.strictCorrect);
const octaveOnly = count(r => r.evaluation.octaveOnly);
const classCorrect = count(r => r.evaluation.classCorrect);
const bothCorrect = count(r => r.evaluation.bothCorrect);
const subset = predicate => evaluated.filter(predicate).length;
const percent = (numerator, denominator) => denominator ? +(100 * numerator / denominator).toFixed(1) : null;
const fraction = (numerator, denominator) => ({ numerator, denominator, percent: percent(numerator, denominator) });
const statusCounts = {};
const categoryCounts = {};
for (const record of records) {
  statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
  categoryCounts[record.evaluation.category] = (categoryCounts[record.evaluation.category] ?? 0) + 1;
}
const confusion = {
  constant: { constant: 0, variable: 0, unavailable: 0 },
  variable: { constant: 0, variable: 0, unavailable: 0 },
  invalid_reference: { constant: 0, variable: 0, unavailable: 0 },
};
for (const record of records) {
  const actual = typeof record.referenceVariable === 'boolean' ? (record.referenceVariable ? 'variable' : 'constant') : 'invalid_reference';
  const predicted = typeof record.prediction?.variable === 'boolean' ? (record.prediction.variable ? 'variable' : 'constant') : 'unavailable';
  confusion[actual][predicted]++;
}
const algorithmFrozen = Object.entries(manifest.algorithm).every(([relative, expected]) => {
  const absolute = path.resolve(root, '../..', relative);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  return actual === expected.sha256;
});
const byReferenceClass = variable => {
  const group = records.filter(record => record.referenceVariable === variable);
  const decoded = group.filter(record => record.status === 'ok');
  return {
    total: group.length,
    decoded: decoded.length,
    strictMainBpm: fraction(group.filter(record => record.evaluation.strictCorrect).length, group.length),
    variableClassification: fraction(group.filter(record => record.evaluation.classCorrect).length, group.length),
    bothCorrect: fraction(group.filter(record => record.evaluation.bothCorrect).length, group.length),
    decodedStrictMainBpm: fraction(decoded.filter(record => record.evaluation.strictCorrect).length, decoded.length),
  };
};
const metrics = {
  version: 'v541',
  sampleCount: total,
  seed: manifest.seed,
  algorithmFrozen,
  validReference,
  evaluatedWithReference: evaluated.length,
  statusCounts,
  categoryCounts,
  reference: {
    constant: count(r => r.referenceVariable === false),
    variable: count(r => r.referenceVariable === true),
    invalid: count(r => typeof r.referenceVariable !== 'boolean'),
    bpmBelow60: count(r => Number(r.referenceBpm) > 0 && r.referenceBpm < 60),
    bpmAbove240: count(r => r.referenceBpm > 240),
  },
  byReferenceClass: {
    constant: byReferenceClass(false),
    variable: byReferenceClass(true),
  },
  allSamples: {
    strictMainBpm: fraction(strictCorrect, total),
    octaveOnlyAmongAll: fraction(octaveOnly, total),
    variableClassification: fraction(classCorrect, total),
    bothCorrect: fraction(bothCorrect, total),
  },
  evaluatedSubset: {
    strictMainBpm: fraction(subset(r => r.evaluation.strictCorrect), evaluated.length),
    variableClassification: fraction(subset(r => r.evaluation.classCorrect), evaluated.length),
    bothCorrect: fraction(subset(r => r.evaluation.bothCorrect), evaluated.length),
  },
  confusion,
  complete: total === 100 && records.every(r => r.status !== 'not_evaluated'),
};
fs.writeFileSync(path.join(root, 'metrics.json'), JSON.stringify(metrics, null, 2));
fs.writeFileSync(path.join(root, 'results.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');

const displayBpm = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toFixed(3) : '—';
const displayBool = value => typeof value === 'boolean' ? (value ? '变速' : '恒速') : '—';
const row = record => {
  const error = record.evaluation.relativeBpmError;
  return `| ${record.id} | ${record.directoryName.replaceAll('|', '\\|')} | ${displayBpm(record.referenceBpm)} | ${displayBpm(record.prediction?.bpm)} | ${error === null ? '—' : (error * 100).toFixed(3) + '%'} | ${displayBool(record.referenceVariable)} | ${displayBool(record.prediction?.variable)} | ${record.evaluation.category} |`;
};
const failures = records.filter(record => !record.evaluation.bothCorrect);
const lines = [
  '# v541：100 首随机样本冻结算法实测',
  '',
  '## 结论先行',
  '',
  `- **主 BPM 严格正确率：${strictCorrect} / ${total}（${percent(strictCorrect, total)}%）**，容差为相对误差 ≤ 0.2%。`,
  `- **恒速/变速分类准确率：${classCorrect} / ${total}（${percent(classCorrect, total)}%）**。`,
  `- **两项同时正确率：${bothCorrect} / ${total}（${percent(bothCorrect, total)}%）**。`,
  `- 仅倍程不同、但未达到严格正确的样本为 **${octaveOnly} 首**，没有混入严格正确率。`,
  `- 样本与算法完整冻结：${metrics.complete ? '100 首均已有评估记录' : '仍有样本未评估'}；算法哈希${algorithmFrozen ? '未变化' : '**已变化，结果无效**'}。`,
  '',
  '> 正确率以随机选中的 `.osu` 谱面红线为基准，不等于人工听音声学金标准；谱面简化或标错会被计为算法错误。主分母固定为 100，复制/解码失败、无有效红线、空结果均保留。',
  '',
  '## 抽样与判定口径',
  '',
  `- 来源：\`${manifest.sourceRoot}\`；固定种子 ${manifest.seed}，随机排列歌曲目录后取前 100 个含 .osu 的目录。`,
  '- 每个目录随机选一个难度；主 BPM 真值为正 uninherited 红线按实际覆盖时长加权后的主导 BPM。',
  '- 任一红线 BPM 与主导 BPM 相差 > 2% 即标注为变速；同 BPM 相位重置不算变速。',
  '- 严格 BPM 容差 ≤ 0.2%；2×/0.5× 等倍程结果只单列，不算严格正确。本轮不评估 offset 和变速边界。',
  '',
  '## 覆盖与分类混淆矩阵',
  '',
  `- 有效谱面红线：${validReference} / ${total}；成功产生算法结果且有真值：${evaluated.length} / ${total}。`,
  `- 谱面标注恒速 ${metrics.reference.constant}，变速 ${metrics.reference.variable}，无效 ${metrics.reference.invalid}；主 BPM <60：${metrics.reference.bpmBelow60}，>240：${metrics.reference.bpmAbove240}。`,
  '',
  '| 谱面真值 \\ 算法输出 | 恒速 | 变速 | 无结果 |',
  '|---|---:|---:|---:|',
  `| 恒速 | ${confusion.constant.constant} | ${confusion.constant.variable} | ${confusion.constant.unavailable} |`,
  `| 变速 | ${confusion.variable.constant} | ${confusion.variable.variable} | ${confusion.variable.unavailable} |`,
  `| 无有效红线 | ${confusion.invalid_reference.constant} | ${confusion.invalid_reference.variable} | ${confusion.invalid_reference.unavailable} |`,
  '',
  '## 按初期目标分层',
  '',
  '| 谱面子集 | 数量 | 主 BPM 严格正确 | 分类正确 | 两项同时正确 |',
  '|---|---:|---:|---:|---:|',
  `| 恒速 | 81 | ${metrics.byReferenceClass.constant.strictMainBpm.numerator} / 81（${metrics.byReferenceClass.constant.strictMainBpm.percent}%） | ${metrics.byReferenceClass.constant.variableClassification.numerator} / 81（${metrics.byReferenceClass.constant.variableClassification.percent}%） | ${metrics.byReferenceClass.constant.bothCorrect.numerator} / 81（${metrics.byReferenceClass.constant.bothCorrect.percent}%） |`,
  `| 变速 | 19 | ${metrics.byReferenceClass.variable.strictMainBpm.numerator} / 19（${metrics.byReferenceClass.variable.strictMainBpm.percent}%） | ${metrics.byReferenceClass.variable.variableClassification.numerator} / 19（${metrics.byReferenceClass.variable.variableClassification.percent}%） | ${metrics.byReferenceClass.variable.bothCorrect.numerator} / 19（${metrics.byReferenceClass.variable.bothCorrect.percent}%） |`,
  '',
  `恒速歌曲排除 2 首音频不可用后，主 BPM 为 ${metrics.byReferenceClass.constant.decodedStrictMainBpm.numerator} / ${metrics.byReferenceClass.constant.decodedStrictMainBpm.denominator}（${metrics.byReferenceClass.constant.decodedStrictMainBpm.percent}%）。变速歌曲的 17 / 19 是检出率，恒速歌曲的 32 / 81 是未报变速比例；变速歌曲的主 BPM 仅是与时长加权参考值比较，不代表各段红线准确。`,
  '',
  '可评估子集（不作为主指标，失败已从此处分母排除）：',
  '',
  `- 主 BPM：${metrics.evaluatedSubset.strictMainBpm.numerator} / ${metrics.evaluatedSubset.strictMainBpm.denominator}（${metrics.evaluatedSubset.strictMainBpm.percent}%）。`,
  `- 变速分类：${metrics.evaluatedSubset.variableClassification.numerator} / ${metrics.evaluatedSubset.variableClassification.denominator}（${metrics.evaluatedSubset.variableClassification.percent}%）。`,
  `- 两项同时正确：${metrics.evaluatedSubset.bothCorrect.numerator} / ${metrics.evaluatedSubset.bothCorrect.denominator}（${metrics.evaluatedSubset.bothCorrect.percent}%）。`,
  '',
  '## 状态与失败类型',
  '',
  '```json',
  JSON.stringify({ statusCounts, categoryCounts }, null, 2),
  '```',
  '',
  `## 未同时正确的样本（${failures.length}）`,
  '',
  '| ID | 歌曲目录 | 标注 BPM | 输出 BPM | 相对误差 | 标注分类 | 输出分类 | 类型 |',
  '|---|---|---:|---:|---:|---|---|---|',
  ...(failures.length ? failures.map(row) : ['| — | 全部通过 | — | — | — | — | — | — |']),
  '',
  '## 结果解释边界',
  '',
  '- `variable_false_positive/negative` 只表示与谱面红线分类不一致，不能单凭此项证明声学误报/漏报。',
  '- 当前 60–240 BPM 归一先验会折叠更高或更低的标注；这些仍按严格口径算错。',
  '- evidence 是 4 秒分析窗的粗略区间，本轮没有把它当精确红线验收。',
  '- 逐样本完整数据见 `results.jsonl`，随机清单及算法哈希见 `manifest.json`，机器可读统计见 `metrics.json`。',
  '',
];
fs.writeFileSync(path.join(root, 'summary.md'), lines.join('\n'));
console.log(JSON.stringify(metrics, null, 2));

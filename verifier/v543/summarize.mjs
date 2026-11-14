// v543: 统一汇总开发集与独立集；不改预测、不剔除失败、不用人工复核覆盖原始红线统计。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(root, '../..');
const heldoutManifest = JSON.parse(fs.readFileSync(path.join(root, 'heldout/manifest.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(root, '../v541/metrics.json'), 'utf8'));
const review = JSON.parse(fs.readFileSync(path.join(root, '../v542/label-review.json'), 'utf8'));
const percent = (n, d) => d ? +(100 * n / d).toFixed(1) : null;
const fraction = (n, d) => ({ numerator: n, denominator: d, percent: percent(n, d) });
const algorithmFrozen = Object.entries(heldoutManifest.algorithm).every(([relative, expected]) => {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, relative))).digest('hex');
  return actual === expected.sha256;
});

function summarize({ version, manifest, predictionRoot, outputRoot, prefix, isFrozen }) {
  const records = manifest.samples.map(sample => {
    const file = path.join(predictionRoot, `${sample.id}.json`);
    const record = fs.existsSync(file) ? { ...sample, ...JSON.parse(fs.readFileSync(file, 'utf8')) } : {
      ...sample, status: 'not_evaluated', referenceBpm: null, referenceVariable: null, referenceRedLineCount: 0, prediction: null,
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
    return { ...record, evaluation: { relativeBpmError, strictCorrect, octaveOnly, classCorrect, bothCorrect, category } };
  });
  const total = records.length;
  const evaluated = records.filter(r => r.status === 'ok' && Number(r.referenceBpm) > 0);
  const count = predicate => records.filter(predicate).length;
  const statusCounts = {}, categoryCounts = {};
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
  const byReferenceClass = variable => {
    const group = records.filter(r => r.referenceVariable === variable);
    const decoded = group.filter(r => r.status === 'ok');
    return {
      total: group.length,
      decoded: decoded.length,
      strictMainBpm: fraction(group.filter(r => r.evaluation.strictCorrect).length, group.length),
      variableClassification: fraction(group.filter(r => r.evaluation.classCorrect).length, group.length),
      bothCorrect: fraction(group.filter(r => r.evaluation.bothCorrect).length, group.length),
      decodedStrictMainBpm: fraction(decoded.filter(r => r.evaluation.strictCorrect).length, decoded.length),
    };
  };
  const metrics = {
    version,
    sampleCount: total,
    seed: manifest.seed,
    algorithmFrozen,
    algorithmHashBasis: 'verifier/v543/heldout/manifest.json',
    validReference: count(r => Number(r.referenceBpm) > 0),
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
    byReferenceClass: { constant: byReferenceClass(false), variable: byReferenceClass(true) },
    allSamples: {
      strictMainBpm: fraction(count(r => r.evaluation.strictCorrect), total),
      octaveOnlyAmongAll: fraction(count(r => r.evaluation.octaveOnly), total),
      variableClassification: fraction(count(r => r.evaluation.classCorrect), total),
      bothCorrect: fraction(count(r => r.evaluation.bothCorrect), total),
    },
    evaluatedSubset: {
      strictMainBpm: fraction(evaluated.filter(r => r.evaluation.strictCorrect).length, evaluated.length),
      variableClassification: fraction(evaluated.filter(r => r.evaluation.classCorrect).length, evaluated.length),
      bothCorrect: fraction(evaluated.filter(r => r.evaluation.bothCorrect).length, evaluated.length),
    },
    confusion,
    complete: total === 100 && records.every(r => r.status !== 'not_evaluated'),
  };
  if (isFrozen) {
    metrics.baselineV541 = baseline.allSamples;
    metrics.deltaFromBaseline = Object.fromEntries(['strictMainBpm', 'variableClassification', 'bothCorrect'].map(key => [key, {
      numerator: metrics.allSamples[key].numerator - baseline.allSamples[key].numerator,
      percentagePoints: +(metrics.allSamples[key].percent - baseline.allSamples[key].percent).toFixed(1),
    }]));
    metrics.ownerReview = review.reviews.map(item => {
      const record = records.find(r => r.id === item.id);
      const predictedBpm = Number(record?.prediction?.bpm);
      const expectedBpm = Number(item.reviewedLabel.bpm);
      return {
        id: item.id,
        ownerRule: item.ownerResponse,
        expected: item.reviewedLabel,
        predicted: record?.prediction ? { bpm: predictedBpm, variable: record.prediction.variable } : null,
        bpmMatches: Number.isFinite(predictedBpm) && Math.abs(predictedBpm / expectedBpm - 1) <= 0.002,
        classificationMatches: record?.prediction?.variable === item.reviewedLabel.variable,
      };
    });
  } else {
    const overlap = JSON.parse(fs.readFileSync(path.join(outputRoot, 'overlap.json'), 'utf8'));
    const overlapDirectories = new Set(overlap.overlap.map(item => item.sourceDirectory));
    const disjoint = records.filter(record => !overlapDirectories.has(record.sourceDirectory));
    metrics.developmentOverlap = overlap;
    metrics.disjointSensitivity = {
      sampleCount: disjoint.length,
      strictMainBpm: fraction(disjoint.filter(r => r.evaluation.strictCorrect).length, disjoint.length),
      variableClassification: fraction(disjoint.filter(r => r.evaluation.classCorrect).length, disjoint.length),
      bothCorrect: fraction(disjoint.filter(r => r.evaluation.bothCorrect).length, disjoint.length),
    };
  }
  const metricPath = path.join(outputRoot, `${prefix}metrics.json`);
  const resultPath = path.join(outputRoot, `${prefix}results.jsonl`);
  const summaryPath = path.join(outputRoot, `${prefix}summary.md`);
  fs.writeFileSync(metricPath, JSON.stringify(metrics, null, 2));
  fs.writeFileSync(resultPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const bpm = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toFixed(3) : '—';
  const bool = value => typeof value === 'boolean' ? (value ? '变速' : '恒速') : '—';
  const failures = records.filter(r => !r.evaluation.bothCorrect);
  const constant = metrics.byReferenceClass.constant;
  const variable = metrics.byReferenceClass.variable;
  const lines = [
    `# ${version}：100 首${isFrozen ? '冻结开发集复测' : '第二组留出集验收'}`, '',
    '## 结论先行', '',
    `- **主 BPM 严格正确：${metrics.allSamples.strictMainBpm.numerator} / ${total}（${metrics.allSamples.strictMainBpm.percent}%）**。`,
    `- **恒速/变速分类正确：${metrics.allSamples.variableClassification.numerator} / ${total}（${metrics.allSamples.variableClassification.percent}%）**。`,
    `- **两项同时正确：${metrics.allSamples.bothCorrect.numerator} / ${total}（${metrics.allSamples.bothCorrect.percent}%）**。`,
    `- 恒速 ${constant.total} 首中 ${constant.variableClassification.numerator} 首未报变速；变速 ${variable.total} 首中 ${confusion.variable.variable} 首检出变速。`,
    `- 记录完整：${metrics.complete ? '是' : '否'}；当前算法哈希与抽样时冻结值一致：${algorithmFrozen ? '是' : '否'}。`, '',
    '> 真值来自随机难度谱面的正 uninherited 红线，不等于人工声学金标准。主分母固定为 100，解码失败和无结果不剔除。严格 BPM 容差为相对误差 ≤0.2%；倍程单列，不算严格正确。', '',
    '## 混淆矩阵', '',
    '| 谱面真值 \\ 算法输出 | 恒速 | 变速 | 无结果 |', '|---|---:|---:|---:|',
    `| 恒速 | ${confusion.constant.constant} | ${confusion.constant.variable} | ${confusion.constant.unavailable} |`,
    `| 变速 | ${confusion.variable.constant} | ${confusion.variable.variable} | ${confusion.variable.unavailable} |`,
    `| 无有效红线 | ${confusion.invalid_reference.constant} | ${confusion.invalid_reference.variable} | ${confusion.invalid_reference.unavailable} |`, '',
    '## 分层指标', '',
    '| 子集 | 数量 | 主 BPM 严格正确 | 分类正确 | 两项同时正确 |', '|---|---:|---:|---:|---:|',
    `| 恒速 | ${constant.total} | ${constant.strictMainBpm.numerator}（${constant.strictMainBpm.percent}%） | ${constant.variableClassification.numerator}（${constant.variableClassification.percent}%） | ${constant.bothCorrect.numerator}（${constant.bothCorrect.percent}%） |`,
    `| 变速 | ${variable.total} | ${variable.strictMainBpm.numerator}（${variable.strictMainBpm.percent}%） | ${variable.variableClassification.numerator}（${variable.variableClassification.percent}%） | ${variable.bothCorrect.numerator}（${variable.bothCorrect.percent}%） |`, '',
    `- 可评估子集 ${evaluated.length} 首：主 BPM ${metrics.evaluatedSubset.strictMainBpm.numerator}，分类 ${metrics.evaluatedSubset.variableClassification.numerator}，联合 ${metrics.evaluatedSubset.bothCorrect.numerator}；此口径只作补充。`,
    `- 状态统计：\`${JSON.stringify(statusCounts)}\`。`, '',
  ];
  if (isFrozen) {
    lines.push('## 相对 v541 基线', '',
      `- 主 BPM：${baseline.allSamples.strictMainBpm.numerator} → ${metrics.allSamples.strictMainBpm.numerator}。`,
      `- 分类：${baseline.allSamples.variableClassification.numerator} → ${metrics.allSamples.variableClassification.numerator}。`,
      `- 联合：${baseline.allSamples.bothCorrect.numerator} → ${metrics.allSamples.bothCorrect.numerator}。`, '',
      '## 三首人工复核（不覆盖上述红线指标）', '',
      '| ID | 人工真值 | 当前输出 | BPM 符合 | 分类符合 |', '|---|---|---|---|---|',
      ...metrics.ownerReview.map(item => `| ${item.id} | ${bpm(item.expected.bpm)} / ${bool(item.expected.variable)} | ${bpm(item.predicted?.bpm)} / ${bool(item.predicted?.variable)} | ${item.bpmMatches ? '是' : '否'} | ${item.classificationMatches ? '是' : '否'} |`), '');
  } else {
    const sensitivity = metrics.disjointSensitivity;
    lines.push('## 与开发集重叠及敏感性', '',
      `- 第二组有 ${metrics.developmentOverlap.count} 首歌曲目录也出现在开发集，因此严格说只有 ${sensitivity.sampleCount} 首目录级未重叠样本；不把它隐去。`,
      `- 排除重叠样本后：主 BPM ${sensitivity.strictMainBpm.numerator} / ${sensitivity.sampleCount}（${sensitivity.strictMainBpm.percent}%），分类 ${sensitivity.variableClassification.numerator} / ${sensitivity.sampleCount}（${sensitivity.variableClassification.percent}%），联合 ${sensitivity.bothCorrect.numerator} / ${sensitivity.sampleCount}（${sensitivity.bothCorrect.percent}%）。`, '');
  }
  lines.push(`## 未同时正确的样本（${failures.length}）`, '',
    '| ID | 歌曲目录 | 标注 BPM | 输出 BPM | 标注分类 | 输出分类 | 类型 |', '|---|---|---:|---:|---|---|---|',
    ...(failures.length ? failures.map(record => `| ${record.id} | ${String(record.directoryName).replaceAll('|', '\\|')} | ${bpm(record.referenceBpm)} | ${bpm(record.prediction?.bpm)} | ${bool(record.referenceVariable)} | ${bool(record.prediction?.variable)} | ${record.evaluation.category} |`) : ['| — | 全部通过 | — | — | — | — | — |']), '',
    '## 边界', '',
    '- evidence 是粗略 4 秒窗区间，不是精确红线；本轮不验收 offset 或变速边界。',
    '- 60–240 BPM 归一先验会折叠范围外 BPM，仍按严格口径算错。',
    '- 独立集只验收，没有根据其失败样本回调阈值。', '');
  fs.writeFileSync(summaryPath, lines.join('\n'));
  return { metrics, metricPath, resultPath, summaryPath };
}

const frozen = summarize({
  version: 'v543-frozen-dev',
  manifest: JSON.parse(fs.readFileSync(path.join(root, '../v541/manifest.json'), 'utf8')),
  predictionRoot: path.join(root, 'frozen-predictions'), outputRoot: root, prefix: 'frozen-', isFrozen: true,
});
const heldout = summarize({
  version: 'v543-heldout', manifest: heldoutManifest,
  predictionRoot: path.join(root, 'heldout/predictions'), outputRoot: path.join(root, 'heldout'), prefix: '', isFrozen: false,
});
console.log(JSON.stringify({ algorithmFrozen, frozen: frozen.metrics.allSamples, heldout: heldout.metrics.allSamples, frozenConfusion: frozen.metrics.confusion, heldoutConfusion: heldout.metrics.confusion }, null, 2));

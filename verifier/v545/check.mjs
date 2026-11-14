// v545: 重跑 oracle 实验并独立核对计数、比例、逐行残差和被否决的高指标。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v545');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
const close = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;
try {
  execFileSync(esbuild, ['verifier/v545/analyze-oracle.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v545/.analyze-oracle.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
  const stdout = execFileSync(process.execPath, ['verifier/v545/.analyze-oracle.cjs'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  console.log(stdout.trim());
  assert(stdout.includes('V545_ORACLE_ANALYSIS_WRITTEN'), 'v545 实验可重跑');
} catch (error) {
  failures++;
  console.error(`FAIL: v545 实验重跑\n${error.stdout ?? ''}${error.message}`);
}

const result = JSON.parse(readFileSync(path.join(directory, 'oracle-results.json'), 'utf8'));
const rejected = JSON.parse(readFileSync(path.join(directory, 'oracle-results-nearest-raw-v2.json'), 'utf8'));
const labels = JSON.parse(readFileSync(path.join(directory, 'label-review.json'), 'utf8'));
assert(result.version === 'v545-oracle-onset-v5' && result.samples.length === 2, 'v5 两个样本完整');
assert(labels.reviews.length === 2 && labels.reviews.every(review => review.reviewedLabel.variable && review.reviewedLabel.redLinesTrusted), '001/058 人工真实变速与红线可信标签完整');
assert(result.syntheticZeroDelayValidation.energy.metrics.count === 60 && result.syntheticZeroDelayValidation.energy.metrics.within5msAll === 1, '能量合成零偏移对照 60/60');
assert(result.syntheticZeroDelayValidation.spectralFlux.metrics.count === 60 && result.syntheticZeroDelayValidation.spectralFlux.metrics.within5msAll === 1, '谱通量合成零偏移对照 60/60');
const rejected001 = rejected.samples.find(sample => sample.id === 'sample-001').features['spectral-flux'];
assert(rejected001.hitobjectJitterNull['review/all/all'].within5msAll > 0.9, 'v2 原始高指标被 >90% 打乱对照否决');

const rows = readFileSync(path.join(directory, 'oracle-residuals.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
  const [id, feature, kind, region, inReview, referenceMs, onsetMs, residualMs, strength, matched] = line.split(',');
  return { id, feature, kind, region, inReview: inReview === 'true', referenceMs: Number(referenceMs), onsetMs: onsetMs === '' ? null : Number(onsetMs), residualMs: residualMs === '' ? null : Number(residualMs), strength: Number(strength), matched: matched === 'true' };
});
const expectedRowCount = result.samples.reduce((sum, sample) => sum + 2 * (sample.uniqueHitobjectTimeCount + sample.redLineCount), 0);
assert(rows.length === expectedRowCount, `CSV 逐参考行数=${expectedRowCount}`);
assert(rows.every(row => row.matched === (row.residualMs !== null) && row.matched === (row.onsetMs !== null)), 'CSV matched 与空值一致');
assert(rows.every(row => !row.matched || close(row.residualMs, row.onsetMs - row.referenceMs)), 'CSV 每行 residual=onset-reference');

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
}
function summarize(selected) {
  const residuals = selected.flatMap(row => row.residualMs === null ? [] : [row.residualMs]);
  const absolute = residuals.map(Math.abs).sort((a, b) => a - b);
  const within5 = absolute.filter(value => value <= 5).length;
  return {
    count: selected.length,
    matched: residuals.length,
    unmatched: selected.length - residuals.length,
    matchCoverage: selected.length ? residuals.length / selected.length : null,
    within5msAll: selected.length ? within5 / selected.length : null,
    within5msMatched: residuals.length ? within5 / residuals.length : null,
    medianAbsMs: quantile(absolute, 0.5),
    p90AbsMs: quantile(absolute, 0.9),
    p95AbsMs: quantile(absolute, 0.95),
    medianSignedMs: quantile([...residuals].sort((a, b) => a - b), 0.5),
  };
}
function compareMetrics(actual, expected, label) {
  assert(actual.count === expected.count && actual.matched === expected.matched && actual.unmatched === expected.unmatched, `${label} 计数一致`);
  for (const key of ['matchCoverage', 'within5msAll', 'within5msMatched', 'medianAbsMs', 'p90AbsMs', 'p95AbsMs', 'medianSignedMs']) {
    assert(actual[key] === null ? expected[key] === null : close(actual[key], expected[key]), `${label} ${key} 一致`);
  }
}
for (const sample of result.samples) {
  for (const [featureName, feature] of Object.entries(sample.features)) {
    assert(feature.parameterSweep.length === (featureName === 'spectral-flux' ? 16 : 0), `${sample.id}/${featureName} 参数组数正确`);
    for (const kind of ['hitobject', 'hitobjectJitterNull', 'redline']) {
      const csvKind = kind === 'hitobjectJitterNull' ? null : kind;
      if (!csvKind) continue; // 阴性对照由结果计数和关键反例检查，CSV 只保存真实参考。
      for (const [group, expected] of Object.entries(feature[kind])) {
        const [scope, region, strength] = group.split('/');
        const selected = rows.filter(row => row.id === sample.id && row.feature === featureName && row.kind === csvKind &&
          (scope === 'full' || row.inReview) && (region === 'all' || row.region === region) &&
          (strength === 'all' || (strength === 'strong' ? row.strength >= 0.1 : row.strength < 0.1)));
        compareMetrics(summarize(selected), expected, `${sample.id}/${featureName}/${kind}/${group}`);
      }
    }
    for (const kind of ['actual', 'jitterNull']) {
      for (const metrics of Object.values(feature.localPhase[kind])) {
        assert(metrics.supported <= metrics.count, `${sample.id}/${featureName} 相位支持数不超总数`);
        const within5 = Math.round(metrics.within5msAll * metrics.count);
        assert(close(metrics.within5msAll, within5 / metrics.count), `${sample.id}/${featureName} 相位全体比例可核对`);
      }
    }
  }
}
const one = result.samples.find(sample => sample.id === 'sample-001').features['spectral-flux'];
const fiftyEight = result.samples.find(sample => sample.id === 'sample-058').features['spectral-flux'];
const oneDense = one.hitobject['review/dense/all'];
const oneNull = one.hitobjectJitterNull['review/dense/all'];
assert(oneDense.count === 17 && oneDense.matched === 15 && Math.round(oneDense.within5msAll * 17) === 5, '001 主结果：密集音符 5/17，匹配 15/17');
assert(oneNull.count === 18 && Math.round(oneNull.within5msAll * 18) === 6, '001 密集打乱对照为 6/18，未支持高正确率');
const fiftyEightReview = fiftyEight.hitobject['review/all/all'];
assert(fiftyEightReview.count === 84 && fiftyEightReview.matched === 60 && Math.round(fiftyEightReview.within5msAll * 84) === 10, '058 主结果：复核音符 10/84，匹配 60/84');
assert(Math.round(one.localPhase.actual['review/all/support>=0'].within5msAll * 8) === 4, '001 局部相位 4/8');
assert(Math.round(fiftyEight.localPhase.actual['review/all/support>=0'].within5msAll * 2) === 0, '058 局部相位 0/2');
assert(existsSync(path.join(directory, 'RESEARCH.md')), '猜想、反证、限制和下一步已记录');
console.log(failures ? `VERIFIER_V545_FAILED: ${failures}` : 'VERIFIER_V545_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

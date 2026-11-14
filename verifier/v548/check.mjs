// v548: 重跑固定选样和汇总，独立核对逐样本、微合计、宏指标、基线与关键反例。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v548');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
const close = (a, b) => a === null || b === null ? a === b : Math.abs(a - b) < 1e-12;
function run(command, args, marker) {
  try {
    const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(stdout.trim());
    assert(stdout.includes(marker), marker);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${marker}\n${error.stdout ?? ''}${error.message}`);
  }
}
execFileSync(esbuild, ['verifier/v548/select.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v548/.select.cjs', '--log-level=error'], { cwd: root, stdio: 'pipe' });
run(process.execPath, ['verifier/v548/.select.cjs'], 'V548_SELECTION_WRITTEN');
run(process.execPath, ['verifier/v548/summarize.mjs'], 'V548_GENERALIZATION_SUMMARY_WRITTEN');

const selection = JSON.parse(readFileSync(path.join(directory, 'selection.json'), 'utf8'));
const result = JSON.parse(readFileSync(path.join(directory, 'generalization-results.json'), 'utf8'));
const samples = selection.samples.map(selected => ({
  selected,
  data: JSON.parse(readFileSync(path.join(directory, 'per-sample', `${selected.id}.json`), 'utf8')),
}));
assert(selection.version === 'v548-generalization-selection-v1' && selection.selectionUsesOnlyBeatmapLabels, '选样规则固定且只看谱面标签');
assert(selection.excludedDevelopmentSamples.join('/') === 'sample-001/sample-058', '开发样本 001/058 已排除');
assert(result.version === 'v548-generalization-summary-v1' && result.status === 'weak_label_consistency_not_independent_acoustic_accuracy', '结果明确标注弱标签口径');
assert(result.complete && result.sampleCount === 20 && samples.length === 20, '20 首逐样本结果完整');
assert(new Set(samples.map(sample => sample.data.id)).size === 20, '20 首 ID 唯一');
assert(samples.filter(sample => !sample.data.referenceVariable).length === 10 && samples.filter(sample => sample.data.referenceVariable).length === 10, '恒速/变速各 10 首');
assert(samples.filter(sample => sample.data.selectionGroup === 'variable-dense-hash').length === 5, '固定 5 首密集变速选样');
assert(samples.filter(sample => sample.data.selectionGroup === 'variable-other-hash').length === 5, '固定 5 首其他变速选样');
assert(samples.filter(sample => sample.data.selectionGroup === 'owner-confirmed-constant').length === 3, '保留 3 首所有者确认恒速');
assert(result.totalHitCount === 17149 && result.totalDenseHitCount === 254, '总物件 17149、密集物件 254');
const expectedDenseSongs = ['sample-002', 'sample-003', 'sample-025', 'sample-042', 'sample-072', 'sample-095', 'sample-100'];
assert(JSON.stringify(result.songsWithDenseHits) === JSON.stringify(expectedDenseSongs), '密集证据仅来自固定 7 首');

function checkMetrics(metrics, label) {
  assert(Number.isInteger(metrics.count) && metrics.count > 0, `${label} 总数为正整数`);
  assert(Number.isInteger(metrics.matched) && metrics.matched >= 0 && metrics.matched <= metrics.count, `${label} 匹配计数有效`);
  assert(Number.isInteger(metrics.within5) && metrics.within5 >= 0 && metrics.within5 <= metrics.matched, `${label} ±5ms 计数有效`);
  assert(close(metrics.within5msAll, metrics.within5 / metrics.count), `${label} 比例等于计数之比`);
}
for (const { selected, data } of samples) {
  assert(data.id === selected.id && data.beatmapFile === selected.beatmapFile && data.directoryName === selected.directoryName, `${selected.id} 与固定选样一致`);
  assert(data.fullEnvelopeMaxAbsDifference === 0, `${selected.id} full 包络逐点一致`);
  assert(data.hitCount === data.configurations[0].actualCrossFit.all.count, `${selected.id} 物件总数口径一致`);
  assert(data.denseHitCount === data.configurations[0].actualCrossFit.dense?.count || data.denseHitCount === 0, `${selected.id} 密集物件计数一致`);
  assert(data.configurations.length === 4, `${selected.id} 四配置完整`);
  assert(new Set(data.configurations.map(config => `${config.aggregate}/${config.method}`)).size === 4, `${selected.id} 四配置不重复`);
  for (const config of data.configurations) {
    for (const evaluationName of ['actualFullFit', 'actualCrossFit', 'nullFullFit', 'nullCrossFit']) {
      const evaluation = config[evaluationName];
      for (const region of ['all', 'stable', 'dense']) {
        if (region === 'dense' && data.denseHitCount === 0) assert(!evaluation.dense, `${selected.id} 无密集物件时不伪造密集分组`);
        else checkMetrics(evaluation[region], `${selected.id}/${config.aggregate}/${config.method}/${evaluationName}/${region}`);
      }
      if (evaluation.dense) {
        assert(evaluation.all.count === evaluation.stable.count + evaluation.dense.count, `${selected.id} ${evaluationName} 稳定+密集=全部`);
        assert(evaluation.all.within5 === evaluation.stable.within5 + evaluation.dense.within5, `${selected.id} ${evaluationName} 分组 ±5ms 可求和`);
      } else assert(evaluation.all.count === evaluation.stable.count && evaluation.all.within5 === evaluation.stable.within5, `${selected.id} 无密集段时全部=稳定`);
    }
    for (const kind of ['actual', 'null']) {
      for (const fold of ['all', 'even', 'odd']) assert(config.phases[kind][fold].length === data.redlines.length, `${selected.id}/${config.aggregate}/${config.method}/${kind}/${fold} 相位覆盖全部红线`);
    }
    assert(config.evenOddWithin5msProportion === null || config.evenOddWithin5msProportion >= 0 && config.evenOddWithin5msProportion <= 1, `${selected.id} 奇偶折一致率在有效范围`);
  }
  for (const region of ['all', 'stable', 'dense']) {
    if (region === 'dense' && data.denseHitCount === 0) assert(!data.baselineGlobalOnly.dense, `${selected.id} 基线不伪造密集分组`);
    else checkMetrics(data.baselineGlobalOnly[region], `${selected.id}/baseline/${region}`);
  }
}

const subsets = {
  all: samples,
  constant: samples.filter(sample => !sample.data.referenceVariable),
  variable: samples.filter(sample => sample.data.referenceVariable),
  variableDenseSelection: samples.filter(sample => sample.data.selectionGroup === 'variable-dense-hash'),
  ownerConfirmedConstant: samples.filter(sample => sample.data.selectionGroup === 'owner-confirmed-constant'),
  calibrationWarning: samples.filter(sample => Math.abs(sample.data.globalDelay.delayMs) >= 60 || sample.data.globalDelay.delayMs < 0),
  calibrationNormal: samples.filter(sample => Math.abs(sample.data.globalDelay.delayMs) < 60 && sample.data.globalDelay.delayMs >= 0),
};
const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q, lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(lower + 1, sorted.length - 1)] * fraction;
};
function expectedMicro(items, evaluation, region) {
  const total = { count: 0, matched: 0, within5: 0 };
  for (const sample of items) {
    const metrics = evaluation(sample.data)[region];
    if (!metrics) continue;
    total.count += metrics.count; total.matched += metrics.matched; total.within5 += metrics.within5;
  }
  return total;
}
function checkMicro(actual, expected, label) {
  assert(actual.count === expected.count && actual.matched === expected.matched && actual.within5 === expected.within5, `${label} 微合计等于逐样本求和`);
  assert(close(actual.within5msAll, expected.count ? expected.within5 / expected.count : null), `${label} 微合计比例正确`);
  assert(close(actual.matchCoverage, expected.count ? expected.matched / expected.count : null), `${label} 匹配覆盖率正确`);
}
for (const configuration of result.configurations) {
  const { aggregate, method } = configuration;
  for (const [subsetName, items] of Object.entries(subsets)) {
    const group = configuration.groups[subsetName];
    assert(group.sampleCount === items.length, `${aggregate}/${method}/${subsetName} 歌曲数正确`);
    for (const region of ['all', 'stable', 'dense']) {
      const metrics = group[region];
      const findConfig = data => data.configurations.find(config => config.aggregate === aggregate && config.method === method);
      checkMicro(metrics.actual, expectedMicro(items, data => findConfig(data).actualCrossFit, region), `${aggregate}/${method}/${subsetName}/${region}/actual`);
      checkMicro(metrics.null, expectedMicro(items, data => findConfig(data).nullCrossFit, region), `${aggregate}/${method}/${subsetName}/${region}/null`);
      checkMicro(metrics.baseline, expectedMicro(items, data => data.baselineGlobalOnly, region), `${aggregate}/${method}/${subsetName}/${region}/baseline`);
      const eligible = items.filter(sample => findConfig(sample.data).actualCrossFit[region] && findConfig(sample.data).nullCrossFit[region]);
      const actualRates = eligible.map(sample => findConfig(sample.data).actualCrossFit[region].within5msAll);
      const advantages = eligible.map(sample => findConfig(sample.data).actualCrossFit[region].within5msAll - findConfig(sample.data).nullCrossFit[region].within5msAll);
      assert(metrics.macro.songCount === eligible.length, `${aggregate}/${method}/${subsetName}/${region} 宏歌曲数正确`);
      assert(close(metrics.macro.medianActualWithin5msAll, quantile(actualRates, 0.5)), `${aggregate}/${method}/${subsetName}/${region} 宏实际中位数正确`);
      assert(close(metrics.macro.minActualWithin5msAll, quantile(actualRates, 0)), `${aggregate}/${method}/${subsetName}/${region} 宏最小值正确`);
      assert(close(metrics.macro.maxActualWithin5msAll, quantile(actualRates, 1)), `${aggregate}/${method}/${subsetName}/${region} 宏最大值正确`);
      assert(close(metrics.macro.medianActualMinusNull, quantile(advantages, 0.5)), `${aggregate}/${method}/${subsetName}/${region} 宏优势中位数正确`);
      assert(metrics.macro.songsActualGreaterThanNull === advantages.filter(value => value > 1e-12).length, `${aggregate}/${method}/${subsetName}/${region} 胜场正确`);
      assert(metrics.macro.songsActualEqualNull === advantages.filter(value => Math.abs(value) <= 1e-12).length, `${aggregate}/${method}/${subsetName}/${region} 平局正确`);
      assert(metrics.macro.songsActualLessThanNull === advantages.filter(value => value < -1e-12).length, `${aggregate}/${method}/${subsetName}/${region} 负场正确`);
    }
  }
}

const expectedMain = {
  'max/independent': { all: [10863, 4076], stable: [10744, 4012], dense: [119, 64] },
  'max/dp': { all: [10872, 4066], stable: [10746, 4012], dense: [126, 54] },
  'top2/independent': { all: [10873, 4051], stable: [10749, 3984], dense: [124, 67] },
  'top2/dp': { all: [10876, 4038], stable: [10751, 3984], dense: [125, 54] },
};
for (const [key, regions] of Object.entries(expectedMain)) {
  const [aggregate, method] = key.split('/');
  const configuration = result.configurations.find(config => config.aggregate === aggregate && config.method === method);
  for (const [region, [actual, nullControl]] of Object.entries(regions)) {
    assert(configuration.groups.all[region].actual.within5 === actual && configuration.groups.all[region].null.within5 === nullControl, `${key}/${region} 关键实际/打乱=${actual}/${nullControl}`);
  }
  assert(configuration.groups.all.all.baseline.within5 === 10812 && configuration.groups.all.stable.baseline.within5 === 10688 && configuration.groups.all.dense.baseline.within5 === 124, `${key} 全局基线计数固定`);
}
const top2dp = result.configurations.find(config => config.aggregate === 'top2' && config.method === 'dp');
const maxdp = result.configurations.find(config => config.aggregate === 'max' && config.method === 'dp');
assert(top2dp.groups.calibrationNormal.all.actual.within5 === 10487 && top2dp.groups.calibrationNormal.all.baseline.within5 === 10499, '校准正常 17 首 top2 DP 低于基线 12 个');
assert(top2dp.groups.variableDenseSelection.dense.actual.within5 === 119 && top2dp.groups.variableDenseSelection.dense.baseline.within5 === 120, '选定密集变速 top2 DP 119/247 对基线 120');
assert(maxdp.groups.variableDenseSelection.dense.actual.within5 === 120 && maxdp.groups.variableDenseSelection.dense.baseline.within5 === 120, '选定密集变速 max DP 与基线同为 120/247');
assert(top2dp.groups.all.all.macro.songsActualGreaterThanNull === 20 && top2dp.groups.all.all.macro.songsActualLessThanNull === 0, 'top2 DP 全曲 20 首均优于破坏性对照');
assert(top2dp.groups.all.dense.macro.songsActualGreaterThanNull === 4 && top2dp.groups.all.dense.macro.songsActualEqualNull === 2 && top2dp.groups.all.dense.macro.songsActualLessThanNull === 1, 'top2 DP 密集段对打乱为 4胜2平1负');

const expectedWarnings = [
  ['sample-027', 60, 574],
  ['sample-044', -3.75, 124],
  ['sample-091', -16, 309],
];
assert(result.calibrationWarnings.length === 3, '三首校准异常全部保留');
for (const [id, delayMs, calibrationHitCount] of expectedWarnings) {
  const warning = result.calibrationWarnings.find(item => item.id === id);
  assert(warning && warning.delayMs === delayMs && warning.calibrationHitCount === calibrationHitCount, `${id} 校准异常 ${delayMs}ms / ${calibrationHitCount} 物件`);
}
const denseExpectations = {
  'sample-002': [18, 17, 16], 'sample-003': [15, 9, 9], 'sample-025': [1, 3, 3],
  'sample-042': [82, 92, 92], 'sample-072': [3, 3, 3], 'sample-095': [4, 2, 2], 'sample-100': [1, 0, 0],
};
for (const [id, [baseline, maxDp, top2Dp]] of Object.entries(denseExpectations)) {
  const data = samples.find(sample => sample.data.id === id).data;
  assert(data.baselineGlobalOnly.dense.within5 === baseline, `${id} 密集基线=${baseline}`);
  assert(data.configurations.find(config => config.aggregate === 'max' && config.method === 'dp').actualCrossFit.dense.within5 === maxDp, `${id} 密集 max DP=${maxDp}`);
  assert(data.configurations.find(config => config.aggregate === 'top2' && config.method === 'dp').actualCrossFit.dense.within5 === top2Dp, `${id} 密集 top2 DP=${top2Dp}`);
}
const reportPath = path.join(directory, 'RESEARCH.md');
assert(existsSync(reportPath), '猜想、基线、反证和验证缺陷已记录');
const report = readFileSync(reportPath, 'utf8');
for (const text of ['10,487/16,140', '125/254', '120/247', '33/106', '27/99', 'H4：实际显著优于打乱，就足以证明精修有效']) assert(report.includes(text), `报告保留关键结论：${text}`);
console.log(failures ? `VERIFIER_V548_FAILED: ${failures}` : 'VERIFIER_V548_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

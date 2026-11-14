// v549: 重跑上限诊断，逐项复现 v548 当前口径，并固定反刷指标结论。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v549');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
try {
  execFileSync(esbuild, ['verifier/v549/analyze-ceiling.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v549/.analyze-ceiling.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
  const stdout = execFileSync(process.execPath, ['verifier/v549/.analyze-ceiling.cjs'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert(stdout.includes('V549_CEILING_ANALYSIS_WRITTEN'), 'v549 上限诊断可重跑');
} catch (error) {
  failures++;
  console.error(`FAIL: v549 重跑\n${error.stdout ?? ''}${error.message}`);
}
const result = JSON.parse(readFileSync(path.join(directory, 'ceiling-results.json'), 'utf8'));
assert(result.version === 'v549-ceiling-diagnostic-v1' && result.sampleCount === 20 && result.samples.length === 20, '20 首诊断完整');
assert(result.status === 'post_hoc_oracle_and_peak_sensitivity_not_independent_accuracy', 'oracle 明确标为事后诊断而非精度');
assert(result.target.includes('80%') && result.target.includes('5 ms'), '80% / 5ms 目标已固定');
function checkMetrics(metrics, label) {
  assert(Number.isInteger(metrics.count) && metrics.count > 0, `${label} 计数有效`);
  assert(metrics.matched >= 0 && metrics.matched <= metrics.count, `${label} 匹配数有效`);
  assert(metrics.within5 >= 0 && metrics.within5 <= metrics.matched, `${label} ±5ms 数有效`);
}
for (const sample of result.samples) {
  const previous = JSON.parse(readFileSync(path.join(root, 'verifier/v548/per-sample', `${sample.id}.json`), 'utf8'));
  const oldConfig = previous.configurations.find(config => config.aggregate === 'top2' && config.method === 'dp');
  assert(sample.configurations.length === 8, `${sample.id} 八组峰设置完整`);
  const current = sample.configurations[0];
  assert(current.name === 'sup20-th020-current' && current.segmentOracle, `${sample.id} 当前设置及段 oracle 存在`);
  for (const region of ['all', 'stable', 'dense']) {
    if (!current.actual[region]) continue;
    assert(current.actual[region].count === oldConfig.actualCrossFit[region].count && current.actual[region].matched === oldConfig.actualCrossFit[region].matched && current.actual[region].within5 === oldConfig.actualCrossFit[region].within5, `${sample.id}/${region} 当前实际与 v548 完全一致`);
    assert(current.baseline[region].count === previous.baselineGlobalOnly[region].count && current.baseline[region].matched === previous.baselineGlobalOnly[region].matched && current.baseline[region].within5 === previous.baselineGlobalOnly[region].within5, `${sample.id}/${region} 基线与 v548 完全一致`);
  }
  for (const config of sample.configurations) {
    for (const kind of ['actual', 'baseline', 'noteOracle', 'segmentOracle']) {
      const evaluation = config[kind];
      if (!evaluation) continue;
      for (const region of ['all', 'stable', 'dense']) if (evaluation[region]) checkMetrics(evaluation[region], `${sample.id}/${config.name}/${kind}/${region}`);
      if (evaluation.dense) {
        assert(evaluation.all.count === evaluation.stable.count + evaluation.dense.count, `${sample.id}/${config.name}/${kind} 分组总数可求和`);
        assert(evaluation.all.within5 === evaluation.stable.within5 + evaluation.dense.within5, `${sample.id}/${config.name}/${kind} 分组命中可求和`);
      }
    }
    for (const region of ['all', 'stable', 'dense']) if (config.noteOracle[region]) assert(config.noteOracle[region].within5 === config.noteOracle[region].matched, `${sample.id}/${config.name}/${region} 每音 oracle 找峰即可事后归零`);
  }
}
const expected = {
  'sup20-th020-current': { actual: [10876, 13351], baseline: [10812, 13221], note: [17048, 17048], segment: [11321, 13538] },
  'sup10-th020': { actual: [12767, 15921], baseline: [12765, 15889], note: [17148, 17148] },
  'sup05-th020': { actual: [14842, 16956], baseline: [14905, 16980], note: [17148, 17148] },
  'sup00-th020': { actual: [17112, 17146], baseline: [17117, 17146], note: [17148, 17148] },
  'sup10-th010': { actual: [12768, 15922], baseline: [12765, 15889], note: [17148, 17148] },
  'sup05-th010': { actual: [14845, 16961], baseline: [14909, 16984], note: [17148, 17148] },
  'sup10-th005': { actual: [12768, 15922], baseline: [12765, 15889], note: [17149, 17149] },
  'sup05-th005': { actual: [14847, 16962], baseline: [14911, 16985], note: [17149, 17149] },
};
for (const [name, kinds] of Object.entries(expected)) {
  const aggregate = result.aggregate.find(item => item.name === name && item.subset === 'all');
  for (const [kind, values] of Object.entries(kinds)) {
    const source = kind === 'note' ? aggregate.noteOracle.all : kind === 'segment' ? aggregate.segmentOracle.all : aggregate[kind].all;
    assert(source.within5 === values[0] && source.matched === values[1] && source.count === 17149, `${name}/${kind} 关键计数 ${values.join('/')}`);
    assert(Math.abs(source.within5msAll - source.within5 / 17149) < 1e-12 && Math.abs(source.matchCoverage - source.matched / 17149) < 1e-12, `${name}/${kind} 比例正确`);
  }
}
const current = result.aggregate.find(item => item.name === 'sup20-th020-current' && item.subset === 'all');
const sup5 = result.aggregate.find(item => item.name === 'sup05-th020' && item.subset === 'all');
const sup0 = result.aggregate.find(item => item.name === 'sup00-th020' && item.subset === 'all');
assert(current.segmentOracle.dense.within5 === 193 && current.segmentOracle.dense.count === 254, '密集段事后相位上限 193/254，不足 80%');
assert(current.segmentOracle.all.within5msAll < 0.8, '当前段相位 oracle 不足 80%');
assert(sup5.actual.all.within5msAll > 0.8 && sup5.baseline.all.within5 > sup5.actual.all.within5, '5ms 虽刷过 80%，基线反而更高');
assert(sup0.actual.all.within5msAll > 0.99, '无抑制接近 100% 的口径失效证据保留');
const report = readFileSync(path.join(directory, 'RESEARCH.md'), 'utf8');
for (const text of ['66.02%', '193/254', '86.55%', '99.78%', '独立 onset 精标', '时间偏置']) assert(report.includes(text), `报告保留关键限制：${text}`);
console.log(failures ? `VERIFIER_V549_FAILED: ${failures}` : 'VERIFIER_V549_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

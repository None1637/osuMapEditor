// v547: 重跑弱标签实验，核对配置、计数、比例、关键提升与反例。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v547');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
try {
  execFileSync(esbuild, ['verifier/v547/analyze-consensus.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v547/.analyze-consensus.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
  const stdout = execFileSync(process.execPath, ['verifier/v547/.analyze-consensus.cjs'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  console.log(stdout.trim());
  assert(stdout.includes('V547_CONSENSUS_ANALYSIS_WRITTEN'), 'v547 可重跑');
} catch (error) {
  failures++;
  console.error(`FAIL: v547 重跑\n${error.stdout ?? ''}${error.message}`);
}
const result = JSON.parse(readFileSync(path.join(directory, 'consensus-results.json'), 'utf8'));
const rejected = JSON.parse(readFileSync(path.join(directory, 'consensus-results-global-dp-v1.json'), 'utf8'));
const weakLabels = JSON.parse(readFileSync(path.join(root, 'verifier/v546/selection.json'), 'utf8'));
assert(result.version === 'v547-weak-label-consensus-v2' && result.samples.length === 2, 'v2 两样本结果完整');
assert(weakLabels.weakLabelPolicy.includes('80%') && weakLabels.weakLabelPolicy.includes('20%'), '八成含音/两成离群规则已保存');
const findConfig = (sample, aggregate, method) => sample.configurations.find(config => config.aggregate === aggregate && config.method === method);
for (const sample of result.samples) {
  assert(sample.fullEnvelopeMaxAbsDifference === 0, `${sample.id} full 包络与 v545 完全一致`);
  assert(sample.configurations.length === 4, `${sample.id} 两种聚合×两种相位模型完整`);
  for (const config of sample.configurations) {
    for (const evaluation of ['actualFullFit', 'actualCrossFit', 'nullFullFit', 'nullCrossFit']) {
      for (const [group, metrics] of Object.entries(config[evaluation])) {
        assert(metrics.count === sample.hitCount || group.startsWith('review/') || group.includes('dense') || group.includes('stable'), `${sample.id} 分组口径有效`);
        assert(metrics.matched <= metrics.count && metrics.within5 <= metrics.matched, `${sample.id}/${config.aggregate}/${config.method}/${evaluation}/${group} 计数有序`);
        assert(Math.abs(metrics.within5msAll - metrics.within5 / metrics.count) < 1e-12, `${sample.id}/${config.aggregate}/${config.method}/${evaluation}/${group} 比例一致`);
      }
    }
    for (const kind of ['actual', 'null']) {
      for (const fold of ['all', 'even', 'odd']) assert(config.phases[kind][fold].length === sample.redlines.length, `${sample.id} 相位数组覆盖全部红线`);
    }
  }
}
const one = result.samples.find(sample => sample.id === 'sample-001');
const fiftyEight = result.samples.find(sample => sample.id === 'sample-058');
const oneDp = findConfig(one, 'max', 'dp');
const fiftyEightTop = findConfig(fiftyEight, 'top2', 'dp');
assert(oneDp.actualCrossFit['review/all'].within5 === 32 && oneDp.actualCrossFit['review/all'].count === 43, '001 max DP 复核 32/43');
assert(oneDp.actualCrossFit['review/dense'].within5 === 9 && oneDp.nullCrossFit['review/dense'].within5 === 9, '001 复核密集真实/打乱均 9/17，未宣称解决');
assert(oneDp.actualCrossFit['full/dense'].within5 === 13 && oneDp.nullCrossFit['full/dense'].within5 === 12, '001 全曲密集 13/27 对照 12/27');
assert(fiftyEightTop.actualCrossFit['review/all'].within5 === 67 && fiftyEightTop.nullCrossFit['review/all'].within5 === 24, '058 top2 DP 复核 67/84 对照 24/84');
assert(fiftyEightTop.actualCrossFit['full/dense'].within5 === 15 && fiftyEightTop.nullCrossFit['full/dense'].within5 === 6, '058 全曲密集 15/27 对照 6/27');
assert(fiftyEightTop.actualCrossFit['full/all'].within5 === 1913 && fiftyEightTop.actualCrossFit['full/all'].count === 3367, '058 全曲计数 1913/3367');
const rejected058 = rejected.samples.find(sample => sample.id === 'sample-058');
assert(findConfig(rejected058, 'max', 'dp').actualCrossFit['full/all'].within5msAll < 0.34, 'v1 长程 DP 全曲失败证据保留');
assert(existsSync(path.join(directory, 'RESEARCH.md')), '猜想、反证、限制和复现已记录');
console.log(failures ? `VERIFIER_V547_FAILED: ${failures}` : 'VERIFIER_V547_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

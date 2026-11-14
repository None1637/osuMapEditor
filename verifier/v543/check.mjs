// v543: 三连音/真实阶跃回归 + 旧验收 + 两组百首冻结指标与算术一致性。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};
function run(command, args, marker) {
  try {
    const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(stdout.trim());
    assert(stdout.includes(marker), marker);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${marker} 执行失败\n${error.stdout ?? ''}${error.message}`);
  }
}

run(process.execPath, ['verifier/v540/check.mjs'], 'VERIFIER_V540_ALL_TESTS_PASSED');
execFileSync(esbuild, ['verifier/v543/synth-v543.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v543/.synth-v543.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
run(process.execPath, ['verifier/v543/.synth-v543.cjs'], 'V543_SYNTH_PASSED');
run(process.execPath, ['verifier/v543/summarize.mjs'], '"algorithmFrozen": true');

const frozen = JSON.parse(readFileSync(path.join(root, 'verifier/v543/frozen-metrics.json'), 'utf8'));
const heldout = JSON.parse(readFileSync(path.join(root, 'verifier/v543/heldout/metrics.json'), 'utf8'));
for (const [name, metrics, expected] of [
  ['冻结开发集', frozen, [79, 81, 67]],
  ['第二组留出集', heldout, [78, 86, 72]],
]) {
  assert(metrics.complete && metrics.sampleCount === 100, `${name}：100 首记录完整`);
  assert(metrics.algorithmFrozen, `${name}：算法哈希未漂移`);
  const actual = [metrics.allSamples.strictMainBpm.numerator, metrics.allSamples.variableClassification.numerator, metrics.allSamples.bothCorrect.numerator];
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${name}：冻结指标 ${actual.join('/')}，预期 ${expected.join('/')}`);
  const rows = Object.values(metrics.confusion);
  assert(rows.every(row => Object.values(row).every(Number.isInteger)), `${name}：混淆矩阵为整数`);
  assert(rows.flatMap(row => Object.values(row)).reduce((sum, value) => sum + value, 0) === 100, `${name}：混淆矩阵总数=100`);
  const referenceTotal = metrics.reference.constant + metrics.reference.variable + metrics.reference.invalid;
  assert(referenceTotal === 100, `${name}：真值分类总数=100`);
  const statusTotal = Object.values(metrics.statusCounts).reduce((sum, value) => sum + value, 0);
  const categoryTotal = Object.values(metrics.categoryCounts).reduce((sum, value) => sum + value, 0);
  assert(statusTotal === 100 && categoryTotal === 100, `${name}：状态与失败类型总数=100`);
}
assert(frozen.ownerReview.length === 3 && frozen.ownerReview.every(item => item.classificationMatches), '三个人工复核样本均不误报变速');
assert(frozen.ownerReview.find(item => item.id === 'sample-032')?.bpmMatches === false, '保留 sample-032 主 BPM 双倍错误，不伪报通过');
assert(heldout.developmentOverlap.count === 1 && heldout.disjointSensitivity.sampleCount === 99, '披露一个目录重叠并给出 99 首敏感性');
assert(existsSync(path.join(root, 'verifier/v543/RESEARCH.md')), '猜想、验证结果和验证方式反思存在');

console.log(failures ? `VERIFIER_V543_FAILED: ${failures}` : 'VERIFIER_V543_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

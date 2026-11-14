// v544: 验证候选漏斗、被否决实验留档，以及生产回退与 v543 的逐首等价性。
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
    console.error(`FAIL: ${marker}\n${error.stdout ?? ''}${error.message}`);
  }
}
run(process.execPath, ['verifier/v540/check.mjs'], 'VERIFIER_V540_ALL_TESTS_PASSED');
execFileSync(esbuild, ['verifier/v543/synth-v543.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v544/.synth-check.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
run(process.execPath, ['verifier/v544/.synth-check.cjs'], 'V543_SYNTH_PASSED');
run(process.execPath, ['verifier/v544/summarize.mjs'], '"algorithmFrozen": true');

const frozen = JSON.parse(readFileSync(path.join(root, 'verifier/v544/frozen-metrics.json'), 'utf8'));
const heldout = JSON.parse(readFileSync(path.join(root, 'verifier/v544/heldout-metrics.json'), 'utf8'));
const experimentFrozen = JSON.parse(readFileSync(path.join(root, 'verifier/v544/experiment-frozen-metrics.json'), 'utf8'));
const experimentHeldout = JSON.parse(readFileSync(path.join(root, 'verifier/v544/experiment-heldout-metrics.json'), 'utf8'));
const equivalence = JSON.parse(readFileSync(path.join(root, 'verifier/v544/fallback-equivalence.json'), 'utf8'));
const funnel = JSON.parse(readFileSync(path.join(root, 'verifier/v544/funnel-metrics.json'), 'utf8'));
const triple = (metrics, key) => [metrics.allSamples.strictMainBpm.numerator, metrics.allSamples.variableClassification.numerator, metrics.allSamples.bothCorrect.numerator];
for (const [name, metrics, expected] of [['回退开发集', frozen, [79, 81, 67]], ['回退第二组', heldout, [78, 86, 72]], ['实验开发集', experimentFrozen, [79, 83, 69]], ['实验第二组', experimentHeldout, [78, 84, 70]]]) {
  assert(metrics.complete && metrics.sampleCount === 100, `${name}：100 首完整`);
  assert(JSON.stringify(triple(metrics)).replaceAll(',', '/') === JSON.stringify(expected).replaceAll(',', '/'), `${name}：指标 ${triple(metrics).join('/')}`);
  assert(Object.values(metrics.confusion).flatMap(row => Object.values(row)).reduce((sum, value) => sum + value, 0) === 100, `${name}：混淆矩阵总数=100`);
}
assert(frozen.algorithmFrozen && heldout.algorithmFrozen, '回退算法哈希一致');
assert(equivalence.frozen.count === 100 && equivalence.heldout.count === 100 && equivalence.frozen.mismatches.length === 0 && equivalence.heldout.mismatches.length === 0, '两组各 100 首与 v543 主 BPM/分类完全一致');
assert(funnel.variableSongFunnel.flaggedWindowOnVariable === 15 && funnel.variableSongFunnel.rawCandidateOnVariable === 9 && funnel.variableSongFunnel.finalDetection === 3, '漏斗保持 15→9→3 的开发集结果');
assert(experimentHeldout.confusion.constant.variable === 3 && heldout.confusion.constant.variable === 1, '实验新增两个恒速误报且回退消除');
assert(existsSync(path.join(root, 'verifier/v544/review-request.md')), '两个 1.5× 歧义段落含复核路径与时间');
assert(existsSync(path.join(root, 'verifier/v544/RESEARCH.md')), '猜想、否决原因和回退记录存在');
console.log(failures ? `VERIFIER_V544_FAILED: ${failures}` : 'VERIFIER_V544_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

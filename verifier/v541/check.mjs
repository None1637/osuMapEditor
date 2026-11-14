// v541: 验证 100 首冻结评估的样本完整性、算法哈希与统计产物，不重跑 DSP。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verifier = path.join(root, 'verifier/v541');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};

const manifest = JSON.parse(readFileSync(path.join(verifier, 'manifest.json'), 'utf8'));
assert(manifest.seed === 540 && manifest.samples.length === 100, '固定种子且样本数为 100');
assert(new Set(manifest.samples.map(sample => sample.id)).size === 100, '样本 ID 无重复');
for (const [relative, expected] of Object.entries(manifest.algorithm)) {
  const actual = createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex');
  assert(actual === expected.sha256, `算法冻结：${relative}`);
}
for (const sample of manifest.samples) {
  assert(existsSync(path.join(verifier, 'samples', sample.id, sample.beatmapFile)), `${sample.id} 谱面副本存在`);
  assert(existsSync(path.join(verifier, 'predictions', `${sample.id}.json`)), `${sample.id} 评估记录存在`);
}
try {
  execFileSync(process.execPath, [path.join(verifier, 'report.mjs')], { cwd: root, stdio: 'pipe' });
  const metrics = JSON.parse(readFileSync(path.join(verifier, 'metrics.json'), 'utf8'));
  const results = readFileSync(path.join(verifier, 'results.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert(metrics.complete && metrics.sampleCount === 100, '100 首均完成评估并生成统计');
  assert(metrics.algorithmFrozen, '汇总时算法哈希仍一致');
  assert(metrics.allSamples.strictMainBpm.denominator === 100, '主 BPM 主分母为 100');
  assert(metrics.allSamples.variableClassification.denominator === 100, '分类主分母为 100');
  assert(metrics.allSamples.bothCorrect.denominator === 100, '联合指标主分母为 100');
  assert(results.length === 100, 'results.jsonl 恰好 100 行');
  assert(existsSync(path.join(verifier, 'summary.md')), '中文汇总报告存在');
  const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
  execFileSync(esbuild, ['verifier/v541/evaluate.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v541/.evaluate.cjs', '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
  assert(true, '批量评估器可由项目 esbuild 编译');
} catch (error) {
  failures++;
  console.error(`FAIL: 汇总或编译失败\n${error.stdout ?? ''}${error.message}`);
}

console.log(failures ? `VERIFIER_V541_FAILED: ${failures}` : 'VERIFIER_V541_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v558: 一键重跑冻结E1候选、指标分析与独立重算。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v558');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
function run(command, args, marker) {
  const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
const config = JSON.parse(readFileSync(path.join(directory, 'experiment.json'), 'utf8'));
if (config.status !== 'frozen_before_candidate_evaluation' || config.expectedDifferenceFrames !== 5 || config.productionCodeChanged !== false) {
  throw new Error('E1冻结配置被改变');
}
execFileSync(esbuild, ['verifier/v558/run.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=verifier/v558/.run.cjs', '--log-level=error'], { cwd: root, stdio: 'pipe' });
run(process.execPath, ['verifier/v558/.run.cjs'], 'V558_CANDIDATES_WRITTEN');
run('python', ['verifier/v558/analyze.py'], 'V558_ANALYSIS_WRITTEN');
run('python', ['verifier/v558/check-results.py'], 'V558_RESULT_VALIDATION_PASSED');
console.log('VERIFIER_V558_ALL_TESTS_PASSED');

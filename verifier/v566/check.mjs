// v566: 一键重跑音频候选、独立音频复验、校准指标和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
function run(command, args, marker) {
  const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
for (const [source, output] of [['verifier/v566/run.ts', 'verifier/v566/.run.cjs'], ['verifier/v566/check-raw.ts', 'verifier/v566/.check-raw.cjs']]) {
  execFileSync(esbuild, [source, '--bundle', '--format=cjs', '--platform=node', `--outfile=${output}`, '--log-level=error'], { cwd: root, stdio: 'pipe' });
}
run(process.execPath, ['verifier/v566/.run.cjs'], 'V566_RAW_CANDIDATES_WRITTEN');
run(process.execPath, ['verifier/v566/.check-raw.cjs'], 'V566_RAW_CANDIDATES_VALIDATION_PASSED');
run('python', ['verifier/v566/calibrate.py'], 'V566_REFINED_CANDIDATES_WRITTEN');
run('python', ['verifier/v566/analyze.py'], 'V566_ANALYSIS_WRITTEN');
run('python', ['verifier/v566/check-results.py'], 'V566_RESULT_VALIDATION_PASSED');
run('python', ['verifier/v566/check-report.py'], 'V566_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V566_ALL_TESTS_PASSED');

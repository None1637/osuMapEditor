// v563: 一键重建冻结校准、独立复算并核对研究报告。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v563/calibrate.py'], 'V563_CROSSFIT_CANDIDATES_WRITTEN');
run(['verifier/v563/analyze.py'], 'V563_ANALYSIS_WRITTEN');
run(['verifier/v563/check-results.py'], 'V563_RESULT_VALIDATION_PASSED');
run(['verifier/v563/check-report.py'], 'V563_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V563_ALL_TESTS_PASSED');

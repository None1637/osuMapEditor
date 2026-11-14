// v565: 一键重算 E6、独立复验并核对负结果报告。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v565/calibrate.py'], 'V565_LEAVE_ONE_OUT_CANDIDATES_WRITTEN');
run(['verifier/v565/analyze.py'], 'V565_ANALYSIS_WRITTEN');
run(['verifier/v565/check-results.py'], 'V565_RESULT_VALIDATION_PASSED');
run(['verifier/v565/check-report.py'], 'V565_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V565_ALL_TESTS_PASSED');

// v562: 一键重算绝对时间纠错、独立验证和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v562/analyze.py'], 'V562_CORRECTED_ANALYSIS_WRITTEN');
run(['verifier/v562/check-results.py'], 'V562_RESULT_VALIDATION_PASSED');
run(['verifier/v562/check-report.py'], 'V562_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V562_ALL_TESTS_PASSED');

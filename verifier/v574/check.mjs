// v574: 一键重算绝对onset指标、独立复验和报告检查；不重写生产代码。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v574/analyze.py'], 'V574_BASELINE_ANALYSIS_WRITTEN');
run(['verifier/v574/check-results.py'], 'V574_RESULT_VALIDATION_PASSED');
run(['verifier/v574/check-report.py'], 'V574_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V574_ALL_TESTS_PASSED');

// v570: 一键重算窗口/缺峰诊断、独立复验和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v570/diagnose.py'], 'V570_DIAGNOSTIC_WRITTEN');
run(['verifier/v570/check-results.py'], 'V570_RESULT_VALIDATION_PASSED');
run(['verifier/v570/check-report.py'], 'V570_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V570_ALL_TESTS_PASSED');

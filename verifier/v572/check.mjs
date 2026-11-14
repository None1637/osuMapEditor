// v572: 一键重算corrected-target候选、指标、独立复验和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v572/rematch.py'], 'V572_REMATCHED_CANDIDATES_WRITTEN');
run(['verifier/v572/analyze.py'], 'V572_ANALYSIS_WRITTEN');
run(['verifier/v572/check-results.py'], 'V572_RESULT_VALIDATION_PASSED');
run(['verifier/v572/check-report.py'], 'V572_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V572_ALL_TESTS_PASSED');

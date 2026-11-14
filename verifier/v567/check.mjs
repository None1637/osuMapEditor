// v567: 一键重算DDC校准、独立复验和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v567/calibrate.py'], 'V567_DDC_CANDIDATES_WRITTEN');
run(['verifier/v567/analyze.py'], 'V567_ANALYSIS_WRITTEN');
run(['verifier/v567/check-results.py'], 'V567_RESULT_VALIDATION_PASSED');
run(['verifier/v567/check-report.py'], 'V567_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V567_ALL_TESTS_PASSED');

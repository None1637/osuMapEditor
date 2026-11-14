// v569: 一键重建无标签门控、E10融合、独立复验和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v569/gate.py'], 'V569_GATE_WRITTEN');
run(['verifier/v569/fuse.py'], 'V569_GATED_CANDIDATES_WRITTEN');
run(['verifier/v569/analyze.py'], 'V569_ANALYSIS_WRITTEN');
run(['verifier/v569/check-results.py'], 'V569_RESULT_VALIDATION_PASSED');
run(['verifier/v569/check-report.py'], 'V569_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V569_ALL_TESTS_PASSED');

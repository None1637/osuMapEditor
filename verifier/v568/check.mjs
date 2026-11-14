// v568: 一键重建层级融合、独立复验和报告检查。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(args, marker) {
  const stdout = execFileSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run(['verifier/v568/fuse.py'], 'V568_HIERARCHICAL_CANDIDATES_WRITTEN');
run(['verifier/v568/analyze.py'], 'V568_ANALYSIS_WRITTEN');
run(['verifier/v568/check-results.py'], 'V568_RESULT_VALIDATION_PASSED');
run(['verifier/v568/check-report.py'], 'V568_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V568_ALL_TESTS_PASSED');

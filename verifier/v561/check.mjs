// v561: 一键重跑冻结融合、分析和独立复算；不运行新模型。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v561');
const config = JSON.parse(readFileSync(path.join(directory, 'experiment.json'), 'utf8'));
if (config.status !== 'frozen_before_candidate_evaluation' || config.productionCodeChanged !== false) throw new Error('E4冻结配置改变');
function run(command, args, marker) {
  const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run('python', ['verifier/v561/run.py'], 'V561_FUSION_CANDIDATES_WRITTEN');
run('python', ['verifier/v561/analyze.py'], 'V561_ANALYSIS_WRITTEN');
run('python', ['verifier/v561/check-results.py'], 'V561_RESULT_VALIDATION_PASSED');
run('python', ['verifier/v561/check-report.py'], 'V561_REPORT_VALIDATION_PASSED');
console.log('VERIFIER_V561_ALL_TESTS_PASSED');

// v559: 一键重跑E2官方自检、冻结解码、神经候选、分析和独立复算。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'verifier/v559');
const config = JSON.parse(readFileSync(path.join(directory, 'experiment.json'), 'utf8'));
if (config.status !== 'frozen_before_candidate_evaluation' || config.productionCodeChanged !== false) throw new Error('E2冻结配置改变');
function run(command, args, marker) {
  const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log(stdout.trim());
  if (!stdout.includes(marker)) throw new Error(`缺少标记 ${marker}`);
}
run('python', ['verifier/v559/smoke.py'], 'V559_BASIC_PITCH_SMOKE_PASSED');
run('python', ['verifier/v559/parity.py'], 'V559_OFFICIAL_PARITY_AND_TIME_MAPPING_PASSED');
run(path.join(root, 'node_modules/electron/dist/electron.exe'), ['verifier/v559/decode-samples.cjs'], 'sample-002');
run('python', ['verifier/v559/run.py'], 'V559_CANDIDATES_WRITTEN');
run('python', ['verifier/v559/analyze.py'], 'V559_ANALYSIS_WRITTEN');
run('python', ['verifier/v559/check-results.py'], 'V559_RESULT_VALIDATION_PASSED');
console.log('VERIFIER_V559_ALL_TESTS_PASSED');

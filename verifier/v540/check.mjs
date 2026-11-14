// v540: BPM 研究验收 — 独立合成矩阵 + Web Audio 真实 fixture + 源码契约。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = path.join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
let failures = 0;
const assert = (condition, message) => {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
};

for (const [source, marker] of [['synth-hypothesis', 'V540_SYNTH_PASSED'], ['real-acceptance', 'V540_REAL_PASSED']]) {
  try {
    const output = path.join(root, `verifier/v540/.${source}.cjs`);
    execFileSync(esbuild, [`verifier/v540/${source}.ts`, '--bundle', '--format=cjs', '--platform=node', `--outfile=verifier/v540/.${source}.cjs`, '--log-level=error', '--alias:@=./src'], { cwd: root, stdio: 'pipe' });
    const stdout = execFileSync(process.execPath, [output], { cwd: root, encoding: 'utf8' });
    console.log(stdout.trim());
    assert(stdout.includes(marker), `${source}: ${marker}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${source} 执行失败\n${error.stdout ?? ''}${error.message}`);
  }
}

const source = readFileSync(path.join(root, 'src/osu/bpmResearch.ts'), 'utf8');
assert(source.includes('normalizePrimaryBpm'), '主 BPM 单值倍程归一');
assert(source.includes('selectPrimaryOffset'), '受限相位重选');
assert(source.includes('localTempoSeries') && source.includes('variableTempoEvidence'), '局部周期与连续变速证据分离');
assert(existsSync(path.join(root, 'verifier/v540/RESEARCH.md')), '猜想与验证记录存在');

console.log(failures ? `VERIFIER_V540_FAILED: ${failures}` : 'VERIFIER_V540_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

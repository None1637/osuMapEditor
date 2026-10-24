// 验证器 v502: 立体声分声道独立检测选最优 (Carnival 主区 220 修复)
//   A: 纯函数 (左 128 右 90 / 左 128 右静音 / 双同轨)
//   B: 真实谱面 (Carnival 48kHz 立体声, 主区 220 + 恒速区网格 ≥99%)
//   C: 源码契约 (detectBpmMono 拆分 + 分声道选择)
// 运行: npm run build 后 node verifier/v502/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('A: 纯函数 + B: 真实谱面 (本地 fixture)');
for (const [name, src, marker] of [['A 纯函数', 'tests', 'V502_PURE_PASSED'], ['B 真实谱面', 'real', 'V502_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v502/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v502/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v502/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
    console.log(out.trim());
    assert(out.includes(marker), `${name}: ${marker}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL: ${name} 执行失败\n${e.stdout ?? ''}${e.message}`);
  }
}

section('C: 源码契约');
{
  const bp = read('src/osu/bpmDetect.ts');
  assert(/if \(numCh === 1\) return detectBpmMono\(buf, opts\)/.test(bp), '单声道走 detectBpmMono');
  assert(/c\.coverage \* result\.beats\.length/.test(bp), 'coverage×拍点数 选最优声道');
}

console.log(failures ? `\nVERIFIER_V502_FAILED: ${failures} 处失败` : '\nVERIFIER_V502_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

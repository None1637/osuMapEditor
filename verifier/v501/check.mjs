// 验证器 v501: 恒速不被误判为变速 — 合并后红线列 (lines) + 共享周期全局精修
//   A: 纯函数 (恒速/breakdown 单线, 变速多线且 < 原始碎段数)
//   B: 真实谱面 (Yoko/Turupeta 单线; Nare outro 真变速独立 ACF 证据)
//   C: 源码契约 (lines 字段 / 对话框变速模式用 constant.lines)
// 运行: npm run build 后 node verifier/v501/check.mjs
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
for (const [name, src, marker] of [['A 纯函数', 'tests', 'V501_PURE_PASSED'], ['B 真实谱面', 'real', 'V501_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v501/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v501/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v501/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
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
  assert(/lines: \{ time: number; bpm: number; meter: number \}\[\]/.test(bp), 'ConstantTempoResult.lines 字段');
  assert(/共享周期 \+ 逐段相位/.test(bp), '共享周期全局精修注释');
  const dlg = read('src/components/BpmDetectDialog.tsx');
  assert(/constant\.lines\.filter\(\(_, i\) => !deletedSegs\.has\(i\)\)/.test(dlg), '变速模式应用合并后 lines');
  assert(/constant\.lines\.map/.test(dlg), '变速段列表渲染合并后 lines');
}

console.log(failures ? `\nVERIFIER_V501_FAILED: ${failures} 处失败` : '\nVERIFIER_V501_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

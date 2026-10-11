// 验证器 v392: CDP 测试窗口多屏让位 — 有多个屏幕时验证器弹出的编辑器窗口不占主屏
//   1) verifier/_lib/env.mjs launchIsolatedElectron: spawn 注入 OSU_VERIFIER=1 (覆盖全部 42 个
//      走共享 helper 的 CDP 验证器);
//   2) electron/main.cjs createWindow: 检测到 OSU_VERIFIER=1 且 screen.getAllDisplays() 有非主屏时,
//      窗口初始 x/y 放到该屏 workArea 中央; 单屏/非验证器运行行为完全不变。
// 运行: node verifier/v392/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('env.mjs: OSU_VERIFIER 注入');
{
  const src = read('verifier/_lib/env.mjs');
  assert(/env: \{ \.\.\.process\.env, OSU_VERIFIER: '1' \}/.test(src), 'spawn 注入 OSU_VERIFIER=1');
}

section('main.cjs: 多屏让位');
{
  const src = read('electron/main.cjs');
  assert(/shell, screen \} = require\("electron"\)/.test(src), '引入 screen');
  assert(/process\.env\.OSU_VERIFIER === "1"/.test(src), '仅验证器运行生效');
  assert(/screen\.getAllDisplays\(\)\.find\(\(d\) => d\.id !== primary\.id\)/.test(src), '找非主屏显示器');
  assert(/secondary\.workArea\.x \+ Math\.max\(0, Math\.round\(\(secondary\.workArea\.width - 1440\) \/ 2\)\)/.test(src), '定位到非主屏 workArea 中央');
  assert(/\.\.\.\(verifierPos \?\? \{\}\),/.test(src), '位置进 BrowserWindow 构造 (无则默认)');
}

if (failures) { console.error(`V392 FAILED: ${failures}`); process.exit(1); }
console.log('V392 ALL PASSED');

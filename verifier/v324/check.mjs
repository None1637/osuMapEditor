// 验证器 v324: F28(再反馈) — 选中滑条插点落空修复 [已被 v326 推翻门槛设计]
//   v324 原方案: 插点门槛改直接测选中滑条自身路径 (getSliderPath + 半径容差),
//   并加落空守卫 (Ctrl+点击落空任何物件不动选区)。
//   v326 推翻: 用户澄清 stable 语义 = Ctrl+左键点击**任何位置**都添加锚点,
//   无命中要求 → 门槛与守卫整体移除 (见 verifier/v326)。
// 本验证器仅保留历史回归断言: 确认 v324 旧形态已移除、v326 新形态在位。
// 运行: node verifier/v324/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('v324 → v326: 命中门槛与落空守卫已移除 (stable 点击任何位置插点)');
{
  assert(!/hitTest\(p\.x, p\.y\)\?\.id === so\.id/.test(ec), 'v319 旧 hitTest 门槛不存在');
  assert(!/const onBody = sp\.points\.some/.test(ec), 'v324 直接路径命中门槛已移除 (v326)');
  assert(!/if \(!hitTest\(p\.x, p\.y\)\) return;/.test(ec), 'v324 落空守卫已移除 (v326)');
  assert(/v326: stable 语义 — Ctrl\+左键点击任何位置都添加锚点/.test(ec), 'v326 注释在位');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv324 全部通过');
process.exit(failures ? 1 : 0);

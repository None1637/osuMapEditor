// 验证器 v319: F28 — 选中滑条新增锚点容差对齐 lazer
//   lazer SliderSelectionBlueprint.OnMouseDown: Ctrl+点击命中蓝图 (滑条身/头尾圈) 即 addControlPoint,
//   无线段距离上限; addControlPoint 插入光标原位置, 插入下标 = 最近控制点线段。
//   旧实现: 6px 线段距离上限 (v118), 落空后掉到 hitTest → Ctrl+点击自己滑条 toggleSelect 丢选区
//   = 用户反馈"点击位置离滑条稍微有点远都会直接取消选中"。
// 运行: node verifier/v319/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('F28: Ctrl+点击滑条身即插点 (lazer 对齐)');
{
  const blk = ec.match(/v118\/v319: 按住 Ctrl 点击选中滑条[\s\S]{0,2400}?store\.emit\(\);\s*return;/);
  assert(!!blk, 'v319 插点块存在');
  // v326 修订: stable 语义 — Ctrl+点击任何位置都插点, v324 的直接路径命中门槛亦移除
  assert(!!blk && !/onBody|hitTest/.test(blk[0]), '无命中门槛 (v326: 点击任何位置插点)');
  assert(!!blk && !/bestD = 6/.test(blk[0]), '6px 线段距离上限移除 (lazer 无上限)');
  assert(!!blk && /const raw = \{ x: p\.x - odx, y: p\.y - ody \};/.test(blk[0]), '插入光标原位置 (撤堆叠偏移, 非投影)');
  assert(!!blk && /\[\.\.\.ctrl\.slice\(0, best \+ 1\), raw, \.\.\.ctrl\.slice\(best \+ 1\)\]/.test(blk[0]), '插入下标 = 最近控制点线段后');
  assert(!!blk && /ctrl\[i\]\.x === ctrl\[i \+ 1\]\.x && ctrl\[i\]\.y === ctrl\[i \+ 1\]\.y\) continue/.test(blk[0]), '零长红锚点重复对跳过 (保留)');
  assert(!!blk && /resnapSliderLength\(bm, so, store\.beatSnap\)/.test(blk[0]), '插入后 SnapTo (lazer 同款, 保留)');
}

section('insertSliderPoint 引用清理');
{
  assert(!/insertSliderPoint/.test(ec), 'EditorCanvas 不再引用 insertSliderPoint');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv319 全部通过');
process.exit(failures ? 1 : 0);

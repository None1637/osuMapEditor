// 验证器 v326: F28(三次反馈) — stable 语义: 选中滑条后 Ctrl+左键点击任何位置都添加锚点
//   用户反馈: "增加滑条点仍然很难。stable是选中滑条后...Ctrl+左键点击任何位置能添加滑条锚点"。
//   v319 (lazer 对齐: 命中蓝图才插) 与 v324 (直接路径命中门槛 + 落空守卫) 都要求命中滑条身,
//   与 stable 不符 → 门槛/守卫整体移除: Ctrl+点击即插, 位置不限。
//   保留: 已有节点手柄优先 (上方 nearestCtrlPoint 分支先 return, Ctrl+点击白点 = 选中/切红, 不误插);
//   插入语义不变 (光标原位置/最近线段下标/零长红锚点对跳过/v240 直线升级圆弧/SnapTo)。
// 运行: node verifier/v326/check.mjs
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

section('F28: Ctrl+点击任何位置插点 (stable 语义, 无命中门槛)');
{
  const blk = ec.match(/v118\/v319: 按住 Ctrl 点击选中滑条[\s\S]{0,2400}?store\.emit\(\);\s*return;/);
  assert(!!blk, '插点块存在');
  assert(/v326: stable 语义 — Ctrl\+左键点击任何位置都添加锚点, 不再要求命中滑条身/.test(ec), 'v326 注释说明 stable 语义');
  assert(/if \(e\.ctrlKey \|\| e\.metaKey\) \{\s*if \(ctrl\.length >= 2\) \{/.test(ec), 'Ctrl 分支直接插点 (无 onBody/hitTest 门槛)');
  assert(!!blk && !/onBody|hitTest|getSliderPath/.test(blk[0]), '插点块内无命中判定');
}

section('节点手柄优先不误插 (nearestCtrlPoint 分支先行)');
{
  const handleIdx = ec.indexOf('nearestCtrlPoint(ctrl, odx, ody, p)');
  const ctrlIdx = ec.indexOf('v326: stable 语义');
  assert(handleIdx > 0 && ctrlIdx > handleIdx, '手柄命中分支在插点分支之前 (return 截断)');
}

section('插入语义保留 (v319/v240)');
{
  const blk = ec.match(/v118\/v319: 按住 Ctrl 点击选中滑条[\s\S]{0,2400}?store\.emit\(\);\s*return;/);
  assert(!!blk && /const raw = \{ x: p\.x - odx, y: p\.y - ody \};/.test(blk[0]), '插入光标原位置 (撤堆叠偏移)');
  assert(!!blk && /\[\.\.\.ctrl\.slice\(0, best \+ 1\), raw, \.\.\.ctrl\.slice\(best \+ 1\)\]/.test(blk[0]), '插入下标 = 最近控制点线段后');
  assert(!!blk && /ctrl\[i\]\.x === ctrl\[i \+ 1\]\.x && ctrl\[i\]\.y === ctrl\[i \+ 1\]\.y\) continue/.test(blk[0]), '零长红锚点重复对跳过');
  assert(!!blk && /wasLinear/.test(blk[0]) && /so\.curveType = 'P'/.test(blk[0]), '直线恰 3 点升级圆弧 (v240)');
  assert(!!blk && /resnapSliderLength\(bm, so, store\.beatSnap\)/.test(blk[0]), '插入后 SnapTo');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv326 全部通过');
process.exit(failures ? 1 : 0);

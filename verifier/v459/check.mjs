// 验证器 v459: Alt 点选滑条机制 (altPickSliders) 整体移除 —
//   v453 只删显示后判定仍在 (Alt+点击滑条本体点选 → 后续节点框选只框被点选滑条), soulten/None1637
//   确认判定也不用留。移除: store 状态/方法/load 清空、nodeAltPress 本体点选分支、框选收窄 v371a 分支、
//   v411 穿透条件的本体分支。保留: v440 已选滑条收窄 + v371b 第一框到滑条收窄。
// 运行: node verifier/v459/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('store.ts: altPick 状态整体移除');
{
  const src = read('src/osu/store.ts');
  assert(!/altPickSliders|toggleAltPickSlider|clearAltPickSliders/.test(src), '字段/toggle/clear/load 清空全删');
  assert(src.includes('v459'), '有 v459 注记');
}

section('EditorCanvas.tsx: 本体点选分支与收窄分支移除');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(!/altPickSliders|toggleAltPickSlider/.test(src), 'EditorCanvas 无 altPick 残留');
  const nap = src.match(/const nodeAltPress = \(p: Pt[\s\S]*?\n  \};/, )?.[0] ?? '';
  assert(nap.length > 0, 'nodeAltPress 存在');
  assert(!/hitTest/.test(nap), 'nodeAltPress 不再做本体 hitTest (未命中锚点 = 直接起节点框选)');
  assert(/nodeMarqueeRef\.current = \{/.test(nap), 'Alt+空白/本体未命中锚点 → 节点框选 (保留)');
  // 框选收窄: 只剩 v440 已选滑条 > v371b 第一框到
  const fn = src.match(/const recomputeMarqueeSelection = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(/selSliderIds\.size/.test(fn) && /firstFramedSliderId/.test(fn), 'v440/v371b 收窄保留');
  const iSel = fn.indexOf('selSliderIds.size');
  assert(iSel > 0 && fn.indexOf('firstFramedSliderId') > iSel, '优先级: 已选滑条 > 第一框到');
}

section('v411 穿透: Alt 只穿锚点 (本体分支随机制移除)');
{
  const src = read('src/components/EditorCanvas.tsx');
  const fn = src.match(/store\.playfieldAnchorPress = \(cx, cy, mods\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(fn.length > 0, 'playfieldAnchorPress 存在');
  assert(/if \(!hitNode\) return false;/.test(fn), 'Alt 穿透只在命中锚点时生效');
  assert(!/\bhitObj\b/.test(fn), '穿透条件不含滑条本体分支 (v459); 词边界防误配 hitObjects');
}

if (failures) { console.error(`V459 FAILED: ${failures}`); process.exit(1); }
console.log('V459 ALL PASSED');

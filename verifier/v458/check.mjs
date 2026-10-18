// 验证器 v458: 当前时间完全不显示的滑条不再因锚点点击被物件级选中 (用户报 bug) —
//   根因: 节点选区残留 (store.selectedNodes) 让不可见滑条保持锚点可交互 (unselectedSliderNodePress
//   候选含 selectedNodes 例外), 点击锚点即 store.select 整物件选中, 选中装饰层又把滑条身画出来。
//   修法: 不可见 (sliderAnchorInteractiveAt 假) 且未物件选中的滑条, 锚点点击退为纯节点操作
//   (选中该锚点 + 可整组拖), 物件选区不动; 可见滑条行为不变 (v438 自动选中进入节点编辑保留)。
// 运行: cd app && node verifier/v458/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('EditorCanvas.tsx: unselectedSliderNodePress 不可见退级');
{
  const src = read('src/components/EditorCanvas.tsx');
  const fn = src.match(/const unselectedSliderNodePress = \(p: Pt[\s\S]*?\n  \};/, )?.[0] ?? '';
  assert(fn.length > 0, 'unselectedSliderNodePress 存在');
  // 不可见门控在 store.select 之前
  const iGate = fn.indexOf('!sliderAnchorInteractiveAt(bm, ho, store.currentTime)');
  const iSelect = fn.indexOf('store.select([hitNode.objId]);');
  assert(iGate > 0 && iSelect > iGate, '不可见门控在物件级选中之前');
  // 退级分支: 纯节点操作 (选中锚点 + 整组拖), 不动物件选区
  assert(/store\.setSelectedNodes\(\[\[ho\.id, hitNode\.idx\]\]\);[\s\S]*?nodesMoveDragRef\.current = \{/.test(fn),
    '不可见时退为节点选中 + 整组拖 (v410 同语义)');
  // v438 可见路径保留
  assert(/store\.select\(\[hitNode\.objId\]\); \/\/ 命中锚点即进入该滑条节点编辑/.test(fn), 'v438 可见滑条命中锚点自动选中保留');
  assert(src.includes('// v458:'), '有 v458 注记');
}

section('候选过滤不变 (selectedNodes 例外仍供节点级操作)');
{
  const src = read('src/components/EditorCanvas.tsx');
  const cnt = (src.match(/sliderAnchorInteractiveAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes\.has\(o\.id\)/g) ?? []).length;
  assert(cnt >= 5, `锚点候选过滤同口径保留 (选中/节点选区例外) — ${cnt} 处`);
}

if (failures) { console.error(`V458 FAILED: ${failures}`); process.exit(1); }
console.log('V458 ALL PASSED');

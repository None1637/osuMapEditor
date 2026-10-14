// 验证器 v415: 拖滑条点时信息面板显示被拖节点的实时坐标
// 问题: 拖滑条锚点时右上角信息面板的 x/y 显示的是选中物件头位置 (selectionSpacingInfo 分支),
//   不是被拖节点的位置 (soulten: 滑条点在移动的时候显示的不是他的资讯, 位置要是)。
// 修复:
//   - store 新增 activeNodeDrag (Ctrl 单点拖 nodeDragRef 起手设置, 收尾清空);
//   - SelectionInfoPanel 新增最高优先级 dragPt 分支 — 显示被拖节点序号 + 实时坐标;
//   - nodeInfo (节点选区) 单节点时附实时坐标行 (覆盖 v410 无修饰点选/拖拽路径);
//   - 面板数据随 commitDragFrame 的 version bump 逐帧刷新。
// 运行: cd app && node verifier/v415/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('store.ts: activeNodeDrag 字段');
{
  const src = read('src/osu/store.ts');
  assert(/v415: 拖拽中的滑条锚点/.test(src), 'v415 版本注释');
  assert(/activeNodeDrag: \{ objId: number; idx: number \} \| null = null;/.test(src), '字段声明');
}

section('EditorCanvas.tsx: 起手设置 / 收尾清空');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/store\.activeNodeDrag = \{ objId: so\.id, idx: hitIdx \}; \/\/ v415/.test(src), 'Ctrl 单点拖起手设置');
  assert(/store\.activeNodeDrag = null; \/\/ v415/.test(src), 'mouseup 收尾清空');
}

section('Timelines.tsx: SelectionInfoPanel 拖拽/单节点坐标');
{
  const src = read('src/components/Timelines.tsx');
  assert(/v415: 拖拽中的滑条锚点 \(Ctrl 单点拖\) — 最高优先级显示被拖节点实时坐标/.test(src), 'dragPt 注释');
  assert(/if \(bm && store\.activeNodeDrag\)/.test(src), 'dragPt 取 activeNodeDrag');
  assert(/\) : nodeInfo \? \(/.test(src.replace(/dragPt \? \(/, 'DRAGPT(')), 'dragPt 分支优先级高于 nodeInfo');
  assert(/v415: 单节点选区 \(含 v410 无修饰点选\/拖拽\) 附节点实时坐标/.test(src), 'nodeInfo 单节点坐标注释');
  assert(/nodeInfo\.x !== null && <div>x:\{nodeInfo\.x\} y:\{nodeInfo\.y\}<\/div>/.test(src), '单节点选区渲染坐标行');
  // v268 首末距离行保留
  assert(/timeline\.node_first/.test(src) && /timeline\.node_last/.test(src), 'v268 首末距离行保留');
}

if (failures) { console.error(`V415 FAILED (${failures})`); process.exit(1); }
console.log('V415 ALL PASSED');

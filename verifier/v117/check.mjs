// v117 源码接线断言: 滑条节点多选 (Alt 层) — 点选/加选/框选/整体拖动/旋转/缩放手柄 + 提示 + ESC
// 运行: node verifier/v117/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ns = read('src/osu/nodeSelection.ts');
const store = read('src/osu/store.ts');
const cv = read('src/components/EditorCanvas.tsx');
const app = read('src/App.tsx');
const insp = read('src/components/Inspector.tsx'); // v234

// 纯函数模块
assert(/export function ctrlPoints/.test(ns) && /export function nearestNode/.test(ns)
  && /export function nodesInRect/.test(ns) && /export function nodeBounds/.test(ns)
  && /export function withRedPartners/.test(ns) && /export function snapshotNodes/.test(ns)
  && /export function transformNodesFromSnapshot/.test(ns), 'nodeSelection.ts: 纯函数齐全');

// store: 节点选区状态与 API
assert(/selectedNodes = new Map<number, Set<number>>\(\);/.test(store), 'store: selectedNodes 字段');
assert(/get nodeSelectionCount\(\)/.test(store), 'store: nodeSelectionCount');
assert(!/for \(const id of m\.keys\(\)\) this\.selected\.add\(id\);/.test(store), 'setSelectedNodes: 不并入物件选区 (v265 适配: Alt 只选滑条点, 原并入致蓝框+Delete 误删整条滑条)');
assert(/clearNodeSelection\(\)/.test(store), 'store: clearNodeSelection');

// EditorCanvas: 四个拖拽 ref + currentQuads 分流
assert(/nodesMoveDragRef = useRef/.test(cv), '画布: nodesMoveDragRef');
assert(/nodeMarqueeRef = useRef/.test(cv), '画布: nodeMarqueeRef');
assert(/nodeScaleDragRef = useRef/.test(cv), '画布: nodeScaleDragRef');
assert(/nodeRotateDragRef = useRef/.test(cv), '画布: nodeRotateDragRef');
assert(/if \(store\.nodeSelectionCount\) v = nodeBounds\(bm, store\.selectedNodes, getStackOffsets\(bm\), 8\);/.test(cv), 'currentQuads: 节点选区优先于物件框 (v245: memo 化, 分支改赋值不走 return)');

// EditorCanvas: Alt 层入口 (lockNotes 门控)
assert(/if \(e\.altKey && !store\.lockNotes\)/.test(cv), 'Alt 分支: lockNotes 门控');
assert(/const hitNode = nearestNode\(sliders, offs, p\);/.test(cv), 'Alt+点选: nearestNode 命中');
assert(/store\.toggleSelectedNode\(hitNode\.objId, hitNode\.idx\)/.test(cv), 'Alt+Shift/Ctrl: 加选/减选');
assert(/nodeMarqueeRef\.current = \{/.test(cv), 'Alt+空白: 节点框选');
assert(/orig: snapshotNodes\(bm, withRedPartners\(bm, store\.selectedNodes\)\), moved: false/.test(cv), '节点拖动快照含红锚点对扩展');

// EditorCanvas: 手柄分流到节点层
assert(/const applyNodeScaleUpdate = /.test(cv) && /transformNodesFromSnapshot\(bm, sd\.orig, pt => scaledPosition\(sc, origin, pt\)\)/.test(cv), 'applyNodeScaleUpdate: 从快照缩放写回节点');
assert(/const applyNodeRotateUpdate = /.test(cv) && /snapRotation\(rd\.rawAngle, shift\)/.test(cv), 'applyNodeRotateUpdate: 累积角度 + Shift 吸附');
assert((cv.match(/if \(store\.nodeSelectionCount\) \{\s*const orig = snapshotNodes/g) || []).length === 2, '旋转/缩放手柄两处分流到节点层');

// EditorCanvas: mousemove 三分支
assert(/applyNodeRotateUpdate\(cp, e\.shiftKey\)/.test(cv), 'mousemove: 节点旋转拖拽');
assert(/applyNodeScaleUpdate\(cp, e\.shiftKey, e\.altKey\)/.test(cv), 'mousemove: 节点缩放拖拽');
assert(/store\.setSelectedNodes\(\[\.\.\.nmq\.base, \.\.\.keepNodes, \.\.\.nodesInRect/.test(cv), 'mousemove: 节点框选实时更新 (v277 适配: 保留不可见滑条的已选节点)');
assert(/transformNodesFromSnapshot\(bm, nmd\.orig, pt => \(\{ x: pt\.x \+ dx, y: pt\.y \+ dy \}\)\)/.test(cv), 'mousemove: 节点整体平移');

// EditorCanvas: 收尾 (canvas mouseup + window mouseup)
assert((cv.match(/if \(nodeScaleDragRef\.current\.moved\) store\.commitDrag\(\); else store\.undo\(\);/g) || []).length === 2, 'nodeScaleDrag 收尾 x2 (canvas + window)');
assert((cv.match(/if \(nodeRotateDragRef\.current\.moved\) store\.commitDrag\(\); else store\.undo\(\);/g) || []).length === 2, 'nodeRotateDrag 收尾 x2 (canvas + window)');
assert(/if \(nmd\.moved\) store\.commitDrag\(\); else store\.undo\(\);/.test(cv), 'nodesMoveDrag 收尾 (未拖动弹空快照)'); // v264 适配: 落点补齐后取局部 nmd

// EditorCanvas: 渲染 (高亮环 / 框选矩形 / 提示)
assert(/if \(store\.nodeSelectionCount\) \{\s*const offs = getStackOffsets\(bm\);\s*const rr = 10 \/ scale;/.test(cv), '渲染: 选中节点黄环');
assert(/const nmq = nodeMarqueeRef\.current;[\s\S]{0,400}rgba\(242,181,68,0\.9\)/.test(cv), '渲染: 节点框选黄色矩形');
// v234: 画布内提示已移除, 移至右侧栏 Inspector HintsBlock (原 63/64 行断言改写)
assert(!cv.includes("fillText('滑条节点控制"), '渲染: 画布不再绘制节点控制提示 (v234 移至右侧栏)');
assert(/滑条节点控制：Alt\+点选\/框选/.test(insp) && /!store\.nodeSelectionCount && sel\.some\(o => o\.type === 'slider'\)/.test(insp),
  '提示迁移: Inspector 同条件显示节点控制文案 (选中滑条且节点层未激活)');

// App: ESC 联动
assert(/if \(store\.selectedNodes\.size\) \{ store\.clearNodeSelection\(\); return; \}/.test(app), 'App: ESC 先退出节点层');

console.log(failures ? `\nV117_CHECK_FAILED: ${failures}` : '\nV117_CHECK_PASSED');
process.exit(failures ? 1 : 0);

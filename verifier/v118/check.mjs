// v118 源码接线断言: 滑条节点编辑对齐 stable — 按住 Ctrl 点击才插白点/白点转红, 直接点击仅选中/拖拽
// 运行: node verifier/v118/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const cv = read('src/components/EditorCanvas.tsx');

// mousedown: nodeDragRef 记录按下时 Ctrl 状态
assert(/nodeDragRef = useRef<\{[^}]*toggleRed: boolean/.test(cv), 'nodeDragRef: 新增 toggleRed 字段');
assert(/toggleRed: e\.ctrlKey \|\| e\.metaKey/.test(cv), 'mousedown: toggleRed = 按下时 Ctrl/Meta');

// mousedown: 线段插点包在 Ctrl 判定内
assert(/v118: 按住 Ctrl 点击线段才在该线段最近点插入新白色节点[\s\S]{0,80}if \(e\.ctrlKey \|\| e\.metaKey\) \{[\s\S]{0,700}insertSliderPoint\(ctrl, best, bestT\)/.test(cv),
  '线段插点: 仅 Ctrl+点击生效');
assert(/if \(e\.ctrlKey \|\| e\.metaKey\) \{\s*let best = -1, bestT = 0, bestD = 6;/.test(cv), '线段命中循环整体在 Ctrl 块内 (不按 Ctrl 落到物件命中)');

// onMouseUp: 白点切红要求按下时带 Ctrl
assert(/const next = ctrl && nd\.toggleRed && !isRedPairPoint\(ctrl, nd\.pointIndex\) \? toggleSliderPointRed/.test(cv),
  '白点切红: 需按下时带 Ctrl (nd.toggleRed)');
assert(/v118: stable 行为 — 只有按下时带 Ctrl \(nd\.toggleRed\) 才切红/.test(cv), '切红分支注释 (stable 行为)');

// 不受影响: 节点拖拽 (mousemove) 与右键操作保持原样
assert(/if \(nd\.pairWith !== null\) setPt\(nd\.pairWith\)/.test(cv), '节点拖拽成对移动不受影响');
assert(/onContextMenu[\s\S]*?isRedPairPoint\(ctrl, i\)[\s\S]*?toggleSliderPointRed[\s\S]*?else[\s\S]*?deleteSliderPoint/.test(cv), '右键: 红转白/删白点不受影响 (不需 Ctrl)');

console.log(failures ? `\nV118_CHECK_FAILED: ${failures}` : '\nV118_CHECK_PASSED');
process.exit(failures ? 1 : 0);

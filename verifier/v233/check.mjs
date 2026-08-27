// 验证器 v233: 滑条点拖拽死区 4px → 1 格 (与 hitcircle 拖拽一致, 移动 1 格即反应)。
// 用户反馈: 滑条点移动要过一定值才会动, 不像 hitcircle 1 格位移就反应。
// 改动: nodesMoveDragRef (整体拖动) 与 nodeDragRef (单节点) 的 moved 阈值
//   Math.hypot(...) <= 4 → Math.abs(dx)+Math.abs(dy) <= 1 (同物件拖拽 dragRef 表达式);
//   v66 手绘滑条候选阈值 (<=4px) 不属于节点拖拽, 保持不变。
// 运行: node verifier/v233/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/EditorCanvas.tsx');

console.log('== EditorCanvas.tsx: 节点拖拽阈值降为 1 格');
assert(src.includes('Math.abs(cp.x - nmd.startX) + Math.abs(cp.y - nmd.startY) <= 1'), 'nodesMoveDragRef 整体拖动阈值 = 1 格');
assert(src.includes('Math.abs(p.x - nd.startX) + Math.abs(p.y - nd.startY) <= 1'), 'nodeDragRef 单节点拖拽阈值 = 1 格');
assert(!src.includes('Math.hypot(cp.x - nmd.startX, cp.y - nmd.startY) <= 4'), 'nodesMoveDragRef 旧 4px 死区已移除');
assert(!src.includes('Math.hypot(p.x - nd.startX, p.y - nd.startY) <= 4'), 'nodeDragRef 旧 4px 死区已移除');
assert(src.includes('Math.hypot(cp.x - cand.x, cp.y - cand.y) <= 4'), 'v66 手绘滑条候选阈值保持 4px 不变');

if (failures) { console.error(`\nV233_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV233_ALL_PASSED');

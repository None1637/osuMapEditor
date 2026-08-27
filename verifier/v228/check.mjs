// 验证器 v228: 物件/节点拖拽移出画布不中断 (用户反馈: 拖住物件不放开, 游標滑到 UI 区域
//   再回游玩区应继续拖着物件)。
// 修复 (EditorCanvas.tsx):
//   ① onMouseLeave 豁免 dragRef/nodeDragRef/nodesMoveDragRef (不再调 onMouseUp 终止拖拽);
//   ② window mousemove: 三者其一激活且事件目标不在画布上时, 复用 onMouseMove 拖拽分支继续跟随
//      (位移按 mousedown 快照重算, 幂等; 画布内由 React onMouseMove 喂, 避免重复);
//   ③ window mouseup: 三者其一仍在则走 onMouseUp 同一收尾 (commit/undo/切红; 画布内松开已清 ref, no-op)。
// 运行: node verifier/v228/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/EditorCanvas.tsx');

section('window mousemove: 画布外继续拖拽');
{
  assert(/else if \(\(dragRef\.current \|\| nodeDragRef\.current \|\| nodesMoveDragRef\.current\) && e\.target !== canvasRef\.current\)/.test(src), '拖拽激活 + 事件目标不在画布时接管');
  assert(/onMouseMove\(e as unknown as React\.MouseEvent\)/.test(src), '复用 onMouseMove 拖拽分支 (快照重算, 幂等)');
}

section('window mouseup: 画布外松开收尾');
{
  const upBody = src.slice(src.indexOf('const up = (e: MouseEvent)'), src.indexOf('const move = (e: MouseEvent)'));
  assert(/if \(dragRef\.current \|\| nodeDragRef\.current \|\| nodesMoveDragRef\.current\) onMouseUp\(\);/.test(upBody), '走 onMouseUp 同一收尾逻辑');
}

section('onMouseLeave: 拖拽豁免');
{
  const leaveBody = src.slice(src.indexOf('onMouseLeave={() => {'), src.indexOf('onDoubleClick={() => {', src.indexOf('onMouseLeave={() => {')));
  assert(/!dragRef\.current && !nodeDragRef\.current && !nodesMoveDragRef\.current\) onMouseUp\(\)/.test(leaveBody), '物件/节点拖拽中离开画布不再终止');
  assert(/!scaleDragRef\.current && !rotateDragRef\.current && !freehandRef\.current && !drawCandRef\.current/.test(leaveBody), 'v50/v74 既有豁免保留');
}

if (failures) { console.error(`V228 FAILED: ${failures}`); process.exit(1); }
console.log('V228 ALL PASSED');

// 验证器 v414: 「物件移动死区 2px」开关关闭时同步移除滑条点拖拽死区
// 背景: v381/v386 的死区开关只接管物件拖拽 (applyObjectDrag); soulten 实测滑条点拖拽也有死区
//   (applyNodeDrag / applyNodesMoveDrag 的 |dx|+|dy| <= 1 阈值), 要求关闭选项时一并移除。
// 修复: 两条节点拖拽路径的阈值改为 (editorPrefs.moveDeadzone2px ? 1 : 0) — 开 = 2px 起效 (现状),
//   关 = 任何移动立即生效 (与物件拖拽 v386 同款语义)。
// 运行: cd app && node verifier/v414/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('EditorCanvas.tsx: 节点拖拽死区接开关');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/v414: 「物件移动死区 2px」开关关闭时同步移除滑条点死区/.test(src), 'applyNodeDrag v414 注释');
  assert(/v414: 「物件移动死区 2px」关闭时同步移除节点整组拖死区/.test(src), 'applyNodesMoveDrag v414 注释');
  assert(/Math\.abs\(p\.x - nd\.startX\) \+ Math\.abs\(p\.y - nd\.startY\) <= \(editorPrefs\.moveDeadzone2px \? 1 : 0\)/.test(src), '单节点拖拽阈值接开关');
  assert(/Math\.abs\(cp\.x - nmd\.startX\) \+ Math\.abs\(cp\.y - nmd\.startY\) <= \(editorPrefs\.moveDeadzone2px \? 1 : 0\)/.test(src), '整组拖拽阈值接开关');
  // 物件拖拽原接线不动 (v381/v386)
  assert(/Math\.abs\(dx\) \+ Math\.abs\(dy\) > \(editorPrefs\.moveDeadzone2px \? 1 : 0\)\) d\.moved = true;/.test(src), '物件拖拽死区接线保留');
}

if (failures) { console.error(`V414 FAILED (${failures})`); process.exit(1); }
console.log('V414 ALL PASSED');

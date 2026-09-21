// 验证器 v267: 选中多个滑条节点时黄框(选中包围框)恢复显示。
// 需求: 用户反馈「选中多个滑条节点时的黄框消失了, 导致无法对选中的节点旋转/缩放」。
// 根因: v265 起节点选区不再并入物件选区 (selectedNodes 独立), 而 v49 黄框门控只看
//   store.selected.size > 0 — 纯节点选区时门控为假, 黄框与旋转/缩放手柄整组消失。
// 修复: EditorCanvas 黄框门控补上 store.nodeSelectionCount > 0
//   (currentQuads/手柄命中本身已支持节点层, 见 v117, 无需改)。
// 运行: node verifier/v267/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/v267: 门控补上节点选区/.test(src), 'v267 注释在');
assert(/store\.tool === 'select' && \(store\.selected\.size > 0 \|\| store\.nodeSelectionCount > 0\) && displaySettings\.selectionBounds/.test(src),
  '黄框门控 = 物件选区 或 节点选区, 且受「选中包围框」开关控制 (v254)');
assert(/currentQuads\(bm\)/.test(src), '节点层四边形仍走 currentQuads (v117, 支持节点选区)');

if (failures) { console.error(`\nV267_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV267_ALL_PASSED');

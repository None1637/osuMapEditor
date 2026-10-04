// 验证器 v266: 拖已选滑条点移动整个框选组 + Alt 点击切换节点选中。
// 需求: soulten「框選兩個或以上滑條點時 用游標移動其中一個滑條點就能移動整個框選組,
//   然後alt的功能就可以變成選取更多滑條點或著取消已經選取的滑條點」。
// 旧模型 (v117): Alt+点击节点 = 重置选区并开始拖动; Alt+Shift/Ctrl+点击 = 切换。
// 新模型: Alt+点击 = 纯切换 (加选/取消, 不拖动); 普通 (无修饰键) 拖拽已选节点 = 整组移动;
//   Alt+空白拖动 = 节点框选 (不变)。
// 运行: node verifier/v266/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
const altLayer = ec.match(/if \(e\.altKey && !store\.lockNotes\) \{[\s\S]{0,2600}?\n      \}/)?.[0] ?? ''; // v309: 窗口 1100→1800; v316: F18b 候选修正 (选中/已选节点滑条), 窗口 1800→2600
// v309: 单击切换升级为红锚点重复对整对切换 (原只切 nearestNode 返回的单个下标, 框选选中的红锚点永远取消不掉)
assert(/v309: 红锚点重复对视为整体切换/.test(altLayer) && /store\.toggleSelectedNode\(hitNode\.objId, hitNode\.idx\)/.test(altLayer), 'Alt+点击 = 切换节点选中 (v309: 红锚点整对)');
assert(!/beginDrag/.test(altLayer), 'Alt 层不再开始拖动 (无 beginDrag)');
assert(!/setSelectedNodes\(\[\[hitNode/.test(altLayer), 'Alt+点击不再重置选区');
assert(/nodeMarqueeRef\.current = \{/.test(altLayer), 'Alt+空白节点框选保留');

const grp = ec.match(/v266: 普通拖拽已选滑条点[\s\S]{0,2600}?\n      \}/)?.[0] ?? ''; // v309: 黄框内按下整组拖代码变长, 窗口 1300→2600
assert(/store\.nodeSelectionCount && !e\.shiftKey && !e\.ctrlKey && !e\.metaKey/.test(grp), '普通 (无修饰键) 拖拽才拦截');
// v309: 命中已选节点 或 按下点在节点黄框 dq 内 → 整组拖 (原: 仅锚点命中; 框内按下会清节点选区转物件拖拽)
assert(/insideNode \|\| insideBox/.test(grp) && /nbox\.dq\.x/.test(grp), '命中已选节点或黄框内按下即整组拖 (v309)');
assert(/nodesMoveDragRef\.current = \{/.test(grp) && /beginDrag/.test(grp), '整组移动走 nodesMoveDragRef + beginDrag');

if (failures) { console.error(`\nV266_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV266_ALL_PASSED');

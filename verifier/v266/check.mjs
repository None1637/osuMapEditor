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
const altLayer = ec.match(/if \(e\.altKey && !store\.lockNotes\) \{[\s\S]{0,1100}?\n      \}/)?.[0] ?? '';
assert(/store\.toggleSelectedNode\(hitNode\.objId, hitNode\.idx\); \/\/ v266: 加选\/取消单个节点/.test(altLayer), 'Alt+点击 = 纯切换节点选中');
assert(!/beginDrag/.test(altLayer), 'Alt 层不再开始拖动 (无 beginDrag)');
assert(!/setSelectedNodes\(\[\[hitNode/.test(altLayer), 'Alt+点击不再重置选区');
assert(/nodeMarqueeRef\.current = \{/.test(altLayer), 'Alt+空白节点框选保留');

const grp = ec.match(/v266: 普通拖拽已选滑条点[\s\S]{0,1300}?\n      \}/)?.[0] ?? ''; // v273 适配: 中间插入一行注释, 窗口 900→1300
assert(/store\.nodeSelectionCount && !e\.shiftKey && !e\.ctrlKey && !e\.metaKey/.test(grp), '普通 (无修饰键) 拖拽才拦截');
assert(/store\.selectedNodes\.get\(hitNode\.objId\)\?\.has\(hitNode\.idx\)/.test(grp), '仅命中已选节点才整组拖');
assert(/nodesMoveDragRef\.current = \{/.test(grp) && /beginDrag/.test(grp), '整组移动走 nodesMoveDragRef + beginDrag');

if (failures) { console.error(`\nV266_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV266_ALL_PASSED');

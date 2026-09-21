// 验证器 v265: Alt 框选只选滑条点 (忽略 hit circle 和 slider 物件)。
// 需求: soulten「然後alt框選就只框選滑條點吧? 忽略hit circle跟slider」。
// 根因: setSelectedNodes/toggleSelectedNode 把节点所在滑条自动并入 store.selected
//   → 蓝框选中标记 + Delete 会误删整条滑条; 用户截图里物件蓝框即此。
// 修复: 1) 两个节点选区 API 不再并入物件选区; 2) Alt 层进入时清空已有物件选区;
//   3) 渲染: 对有选中节点但物件未选中的滑条补画控制多边形/手柄 (原靠并入触发 drawSelectionDecor)。
// 运行: node verifier/v265/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const st = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const setNodes = st.match(/setSelectedNodes\(entries[\s\S]{0,500}?\n  \}/)?.[0] ?? '';
assert(!/this\.selected\.add/.test(setNodes), 'setSelectedNodes 不并入物件选区');
assert(/v265: 不再把滑条并入物件选区/.test(setNodes), 'setSelectedNodes v265 注释');
const toggle = st.match(/toggleSelectedNode\(objId[\s\S]{0,500}?\n  \}/)?.[0] ?? '';
assert(!/this\.selected\.add/.test(toggle), 'toggleSelectedNode 不并入物件选区');

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/if \(store\.selected\.size\) \{ store\.selected\.clear\(\); store\.emitSelection\(\); \} \/\/ v265: 忽略 hit circle\/slider/.test(ec), 'Alt 层进入清空物件选区');
assert(/v265: 节点选区不再并入物件选区/.test(ec), '渲染补画注释');
assert(/!o \|\| o\.type !== 'slider' \|\| store\.selected\.has\(objId\)\) continue;/.test(ec), '补画跳过物件已选中的滑条 (不重复 drawSelectionDecor)');
assert((ec.match(/drawSliderControlPoints\(g, o\)/g) ?? []).length >= 1, '补画控制多边形/手柄');

if (failures) { console.error(`\nV265_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV265_ALL_PASSED');

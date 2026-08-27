// 验证器 v234: 操作提示从画布迁移到右侧栏 Inspector。
// 1) 原 v117 画布内「滑条节点控制: Alt+点选/框选...」fillText 提示删除,
//    同条件 (select 工具 + 非播放 + 未进节点层 + 选中有滑条) 在 Inspector HintsBlock 显示;
// 2) 开启游玩区平移 (playfieldPanEnabled) 时, Inspector 显示
//   「按住鼠标中键拖动游玩区, Alt+滚轮缩放游玩区大小」说明。
// 运行: node verifier/v234/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const canvas = readSrc('src/components/EditorCanvas.tsx');
const insp = readSrc('src/components/Inspector.tsx');

console.log('== EditorCanvas.tsx: 画布内提示已移除');
assert(!canvas.includes("fillText('滑条节点控制"), '画布不再绘制滑条节点控制提示');

console.log('== Inspector.tsx: 右侧栏提示区');
assert(insp.includes('HintsBlock'), 'HintsBlock 提示区块存在');
assert(insp.includes('滑条节点控制：Alt+点选/框选'), 'Alt 滑条节点控制提示文案');
assert(insp.includes('store.nodeSelectionCount') && insp.includes("store.tool === 'select'"), '节点提示保留原显示条件 (select 工具/未进节点层)');
assert(insp.includes('游玩区平移已开启：按住鼠标中键拖动游玩区') && insp.includes('Alt+滚轮缩放游玩区大小'), '游玩区平移操作说明文案');
assert(insp.includes('store.playfieldPanEnabled'), '平移提示以 playfieldPanEnabled 为条件');
assert((insp.match(/\{HintsBlock\}/g) || []).length >= 2, 'HintsBlock 在单选与多选/未选中分支均渲染');

if (failures) { console.error(`\nV234_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV234_ALL_PASSED');

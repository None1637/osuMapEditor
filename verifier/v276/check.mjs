// 验证器 v276: 已聚焦输入框内框选文字不触发拖动调值。
// 需求: 用户反馈「框选输入框中数字时不要触发左右拖动数值」。
// 根因: v258 的 DraftNum 在 pointerdown 无条件 setPointerCapture + 记录拖动起点,
//   已聚焦输入框内的拖动 (用户想框选数字) 超 3px 即被接管为调值并 preventDefault 阻止选字。
// 修复: pointerdown 时若输入框已聚焦 (document.activeElement === currentTarget) 直接 return,
//   拖动留给浏览器原生文本选择; 调值只在未聚焦输入框上按下拖动 (= 点击即聚焦的那次交互)。
// 运行: node verifier/v276/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/DraggableDialog.tsx'), 'utf8');
assert(/v276: 已聚焦的输入框内按下拖动 = 原生文本框选/.test(src), 'v276 注释在');
assert(/if \(document\.activeElement === e\.currentTarget\) return;/.test(src), '已聚焦时 pointerdown 不进入调值');
assert(/dragRef\.current = \{ x0: e\.clientX, v0: value, active: false \};/.test(src), '未聚焦按下仍记录拖动起点 (调值保留)');
assert(/d\.v0 \+ \(dx \/ 5\) \* step \* mult/.test(src), '5px = 1 step 公式不变 (v269)');

if (failures) { console.error(`\nV276_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV276_ALL_PASSED');

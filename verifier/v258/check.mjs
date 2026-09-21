// 验证器 v258: 数值输入框 Adobe 式拖动调值。
// 需求: soulten「增加數值的控制方法」— 所有窗口里的数值输入框支持按住水平拖动改数值,
//   「可以做成adobe那樣按住數字就可以靠滑鼠水平方向移動改變數值, 會比放一個小滑條好調」。
// 实现: DraggableDialog 的 DraftNum (7 个对话框 45 处共用的数字输入组件) 加 pointer 拖动:
//   5px = 1 step (v269 调低, 原 1px 太敏感), Shift ×10, Alt ×0.1, 3px 阈值 (不影响点击聚焦/选字), 按 step 小数位取整。
// 运行: node verifier/v258/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/DraggableDialog.tsx'), 'utf8');
assert(/v258: Adobe 式拖动调值/.test(src), 'v258 注释在');
assert(/onPointerDown=\{e => \{[\s\S]{0,300}setPointerCapture/.test(src), 'pointerdown 记录起点并捕获指针 (v276 适配: 中间插入已聚焦框选判断)');
assert(/Math\.abs\(dx\) < 3/.test(src), '3px 阈值 (不影响点击聚焦)');
assert(/e\.shiftKey \? 10 : e\.altKey \? 0\.1 : 1/.test(src), 'Shift ×10 / Alt ×0.1 倍率');
assert(/d\.v0 \+ \(dx \/ 5\) \* step \* mult/.test(src), '拖动按 step 调值 (v269 适配: 5px = 1 step, 原 1px 太敏感)');
assert(/ew-resize/.test(src), '拖动时光标 ew-resize');
assert(/data-conv=\{testid\}/.test(src), 'DraftNum 仍是原输入框 (回归保护)');

if (failures) { console.error(`\nV258_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV258_ALL_PASSED');

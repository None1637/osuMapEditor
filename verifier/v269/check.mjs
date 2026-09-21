// 验证器 v269: 数值框拖动调值敏感度降为 5px = 1 step。
// 需求: 用户反馈「数值框拖动调值的敏感度太高了, 调成默认5像素1step」。
// 实现: DraggableDialog DraftNum 拖动公式 d.v0 + dx * step * mult → d.v0 + (dx / 5) * step * mult
//   (v258 原 1px = 1 step 太敏感; Shift ×10 / Alt ×0.1 倍率与 3px 阈值不变)。
// 运行: node verifier/v269/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/DraggableDialog.tsx'), 'utf8');
assert(/v269: 5px = 1 step/.test(src), 'v269 注释在');
assert(/d\.v0 \+ \(dx \/ 5\) \* step \* mult/.test(src), '拖动公式 5px = 1 step');
assert(!/d\.v0 \+ dx \* step \* mult/.test(src), '旧 1px = 1 step 公式已移除');
assert(/e\.shiftKey \? 10 : e\.altKey \? 0\.1 : 1/.test(src), 'Shift ×10 / Alt ×0.1 倍率保留');
assert(/Math\.abs\(dx\) < 3/.test(src), '3px 点击阈值保留');

if (failures) { console.error(`\nV269_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV269_ALL_PASSED');

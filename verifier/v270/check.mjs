// 验证器 v270: 游玩区预留还原 (v129 布局恢复)。
// 经过: v270 初版把「时间轴半透明」开启时的 viewTransform 预留改为 0 (游玩区铺满全画布),
//   用户反馈「不该调整为游玩区铺满全画布, 还原成给上下时间轴预留 111px/92px」→ 已还原。
//   半透明无效的真正根因与修复见 v271 (波形底/暗化层叠加过暗)。
// 运行: node verifier/v270/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/v270 二轮: 用户反馈铺满方向错误, 还原 v129 固定预留/.test(ec), 'v270 还原注释在');
assert(/r\.height - RESERVED_TOP - RESERVED_BOTTOM/.test(ec), '可用高度固定扣除上下预留 (111/92)');
assert(/oy: RESERVED_TOP \+ \(availH - PH \* scale\) \/ 2/.test(ec), '垂直位置从固定预留顶起算');
assert(!/resTop|resBottom/.test(ec), 'v270 初版的变量化预留已移除');

if (failures) { console.error(`\nV270_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV270_ALL_PASSED');

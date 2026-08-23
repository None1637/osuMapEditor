// v85 纯函数: dialogCenterPos — 窗口在视口内居中, 负值钳 0
import { dialogCenterPos } from '@/components/DraggableDialog';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const p = dialogCenterPos(1440, 900, 380, 260);
assert(p.x === 530 && p.y === 320, `1440x900 视口 380x260 窗 => (530,320) (实际 ${p.x},${p.y})`);
const q = dialogCenterPos(500, 400, 600, 300);
assert(q.x === 0 && q.y === 50, `窗宽超视口 => x 钳 0 (实际 ${q.x},${q.y})`);
const r = dialogCenterPos(801, 601, 101, 101);
assert(r.x === 350 && r.y === 250, `奇数尺寸四舍五入取整 (实际 ${r.x},${r.y})`);

if (failures) { console.error(`\nTESTS_V85_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V85_ALL_PASSED');

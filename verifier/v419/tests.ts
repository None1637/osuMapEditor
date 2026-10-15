// v419 数值测试: 跳过按钮 — canSkip 显示条件 / skipTarget seek 目标
import { canSkip, skipTarget } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const first = 10000;
assert(canSkip(0, first), '开头显示');
assert(canSkip(6999, first), '首物件前 3001ms 仍显示');
assert(!canSkip(7000, first), '首物件前 3000ms 边界隐藏');
assert(!canSkip(9000, first), '临近首物件隐藏');
assert(!canSkip(10000, first), '首物件时刻隐藏');
assert(!canSkip(20000, first), '游玩中隐藏');
assert(skipTarget(first) === 8000, 'seek 目标 = 首物件 - 2000');
// 跳过落地后按钮应立即隐藏 (8000 > 10000-3000)
assert(!canSkip(skipTarget(first), first), '跳过落地后按钮隐藏');

if (failures) { console.error(`\nV419_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV419_TESTS_PASSED');

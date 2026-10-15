// v421 数值测试: combo 弹跳缩放 (瞬时 1.6x, 180ms 缓动回 1.0)
import { COMBO_POP_MS, comboPopScale } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

assert(COMBO_POP_MS === 180, '弹跳时长 180ms (150~200 区间)');
assert(comboPopScale(-1) === 1, '未触发 = 1.0');
assert(Math.abs(comboPopScale(0) - 1.6) < 1e-9, '瞬时放大 1.6x');
assert(Math.abs(comboPopScale(180) - 1) < 1e-9, '末端回 1.0');
assert(comboPopScale(181) === 1, '超过时长保持 1.0');
assert(comboPopScale(90) > 1 && comboPopScale(90) < 1.6, '中段介于 1~1.6');
assert(comboPopScale(45) > comboPopScale(135), '单调回落');

if (failures) { console.error(`\nV421_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV421_TESTS_PASSED');

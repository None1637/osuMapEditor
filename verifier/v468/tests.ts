// v468 纯函数断言: anchorHitRadius 在显示尺寸基础上 +2 屏幕像素 (2/k osu 单位)
import { anchorHitRadius } from '@/osu/nodeSelection';
import { displaySettings } from '@/osu/displaySettings';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// lazer 样式: 头 7 + 2/k, 其余 6 + 2/k
displaySettings.sliderPointStyle = 'lazer';
assert(anchorHitRadius(true, 2) === 7 + 1, `lazer 头 k=2 → 8 (实际 ${anchorHitRadius(true, 2)})`);
assert(anchorHitRadius(false, 2) === 6 + 1, `lazer 非头 k=2 → 7 (实际 ${anchorHitRadius(false, 2)})`);
assert(anchorHitRadius(true, 0.5) === 7 + 4, `lazer 头 k=0.5 → 11 (实际 ${anchorHitRadius(true, 0.5)})`);
assert(anchorHitRadius(false, 0) === 6 + 2, `lazer 非头 k=0 兜底按 1 → 8 (实际 ${anchorHitRadius(false, 0)})`);

// stable 样式: 内切 4/k + 2/k = 6/k
displaySettings.sliderPointStyle = 'stable';
assert(anchorHitRadius(true, 2) === 3, `stable k=2 → 3 (实际 ${anchorHitRadius(true, 2)})`);
assert(anchorHitRadius(false, 0.5) === 12, `stable k=0.5 → 12 (实际 ${anchorHitRadius(false, 0.5)})`);
assert(anchorHitRadius(true, 0) === 6, `stable k=0 兜底按 1 → 6 (实际 ${anchorHitRadius(true, 0)})`);

if (failures) { console.error(`V468_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V468_TESTS_PASSED');

// v418 数值测试: 歌曲进度 playProgress (首物件→末物件结束, 钳 [0,1])
import { playProgress } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

assert(playProgress(0, 5000, 65000) === 0, '首物件前 = 0');
assert(playProgress(5000, 5000, 65000) === 0, '首物件时刻 = 0');
assert(Math.abs(playProgress(35000, 5000, 65000) - 0.5) < 1e-9, '中点 = 0.5');
assert(playProgress(65000, 5000, 65000) === 1, '末物件结束 = 1');
assert(playProgress(70000, 5000, 65000) === 1, '超过末尾钳 1');
assert(playProgress(-1000, 5000, 65000) === 0, '负时间钳 0');
assert(playProgress(100, 5000, 5000) === 0, '无效区间 (last<=first) = 0');
assert(playProgress(100, 0, 0) === 0, '空谱 = 0');

if (failures) { console.error(`\nV418_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV418_TESTS_PASSED');

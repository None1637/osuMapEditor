// v375 纯函数断言: fmtBpm / fmtSv 统一小数位
import { fmtBpm, fmtSv } from '@/osu/timingEdit';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }

section('fmtBpm: 统一 3 位小数');
{
  assert(fmtBpm(333.3333333333333) === '180.000', `180 BPM -> "180.000" (实际 ${fmtBpm(333.3333333333333)})`);
  assert(fmtBpm(500) === '120.000', `120 BPM -> "120.000" (实际 ${fmtBpm(500)})`);
  assert(fmtBpm(349.6503496503496) === '171.600', `171.6 BPM -> "171.600" (实际 ${fmtBpm(349.6503496503496)})`);
  assert(fmtBpm(357.14285714285717) === '168.000', `168 BPM -> "168.000" (实际 ${fmtBpm(357.14285714285717)})`);
  assert(fmtBpm(0) === '0.000', 'beatLength 0 -> "0.000" (防 Infinity)');
}

section('fmtSv: 统一 2 位小数');
{
  assert(fmtSv(-100) === '1.00', `1x -> "1.00" (实际 ${fmtSv(-100)})`);
  assert(fmtSv(-66.66666666666667) === '1.50', `1.5x -> "1.50" (实际 ${fmtSv(-66.66666666666667)})`);
  assert(fmtSv(-250) === '0.40', `0.4x -> "0.40" (实际 ${fmtSv(-250)})`);
  assert(fmtSv(-52.63157894736842) === '1.90', `1.9x -> "1.90" (实际 ${fmtSv(-52.63157894736842)})`);
  assert(fmtSv(0) === '0.00', 'beatLength 0 -> "0.00" (防 Infinity)');
}

if (failures) { console.error(`V375_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V375_TESTS_ALL_PASSED');

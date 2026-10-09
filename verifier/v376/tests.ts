// v376 纯函数断言: parseMsTime 解析 + formatMsTime 往返
import { parseMsTime, formatMsTime } from '@/osu/timingEdit';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }

section('parseMsTime: 完整格式');
{
  assert(parseMsTime('0:00:14.988') === 14988, `"0:00:14.988" -> 14988 (实际 ${parseMsTime('0:00:14.988')})`);
  assert(parseMsTime('1:23:45.678') === 5025678, `"1:23:45.678" -> 5025678 (实际 ${parseMsTime('1:23:45.678')})`);
  assert(parseMsTime('0:02:00.000') === 120000, `"0:02:00.000" -> 120000 (实际 ${parseMsTime('0:02:00.000')})`);
}

section('parseMsTime: 省略与短格式');
{
  assert(parseMsTime('02:14.988') === 134988, `省略小时 "02:14.988" -> 134988 (实际 ${parseMsTime('02:14.988')})`);
  assert(parseMsTime('0:00:14') === 14000, '省略毫秒 -> 14000');
  assert(parseMsTime('0:00:14.5') === 14500, `毫秒 1 位按 .500 (实际 ${parseMsTime('0:00:14.5')})`);
  assert(parseMsTime(' 0:00:14.988 ') === 14988, '前后空格容忍');
}

section('parseMsTime: 非法输入');
{
  assert(parseMsTime('') === null, '空串 -> null');
  assert(parseMsTime('abc') === null, 'abc -> null');
  assert(parseMsTime('14988') === null, '纯数字 -> null (走 ms 框)');
  assert(parseMsTime('0:99:14.000') === null, '分钟 >=60 -> null');
  assert(parseMsTime('0:00:99.000') === null, '秒 >=60 -> null');
}

section('formatMsTime 往返');
{
  for (const ms of [0, 14988, 60000, 134988, 5025678, 3599999]) {
    assert(parseMsTime(formatMsTime(ms)) === ms, `往返 ${ms} (实际 ${parseMsTime(formatMsTime(ms))})`);
  }
}

if (failures) { console.error(`V376_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V376_TESTS_ALL_PASSED');

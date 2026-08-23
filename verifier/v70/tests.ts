// 验证器 v70 纯函数测试: 时分秒格式化 + 当前时间生效绿线
import type { TimingPoint } from '../../src/osu/parser';
import { formatMsTime, activeGreenAt } from '../../src/osu/timingEdit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number): TimingPoint => ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number): TimingPoint => ({ time, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });

section('formatMsTime: h:mm:ss.mmm');
{
  assert(formatMsTime(0) === '0:00:00.000', '0');
  assert(formatMsTime(61500) === '0:01:01.500', '分秒毫秒');
  assert(formatMsTime(3661234) === '1:01:01.234', '小时');
  assert(formatMsTime(-5) === '0:00:00.000', '负值钳 0');
  assert(formatMsTime(1000.6) === '0:00:01.001', '四舍五入到 ms');
}

section('activeGreenAt: 当前时间生效绿线 (红线复位)');
{
  const tps = [red(0), green(1000), red(1500), green(2000)];
  assert(activeGreenAt(tps, 500) === null, '首个绿线前 => null');
  assert(activeGreenAt(tps, 1200) === tps[1], '绿线区 => 该绿线');
  assert(activeGreenAt(tps, 1000) === tps[1], '绿线恰在该刻 => 生效');
  assert(activeGreenAt(tps, 1600) === null, '红线后 SV 复位 => null');
  assert(activeGreenAt(tps, 2500) === tps[3], '后续绿线区 => 新绿线');
  assert(activeGreenAt([], 100) === null, '空表 => null');
}

if (failures) { console.error(`\nTESTS_V70_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V70_ALL_PASSED');

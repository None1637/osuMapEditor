// 验证器 v71 纯函数测试: scrollTargetIndex (timing 页签初始滚动目标行)
import type { TimingPoint } from '../../src/osu/parser';
import { scrollTargetIndex } from '../../src/osu/timingEdit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number): TimingPoint => ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number): TimingPoint => ({ time, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });

section('scrollTargetIndex: 生效绿线优先, 否则最近 <= t 的点');
{
  const tps = [red(0), green(1000), green(2000), red(3000), green(4000)];
  assert(scrollTargetIndex(tps, 1500) === 1, '生效绿线行 (t=1500 => 绿@1000)');
  assert(scrollTargetIndex(tps, 2500) === 2, '生效绿线行 (t=2500 => 绿@2000)');
  assert(scrollTargetIndex(tps, 3500) === 3, '红线复位后无绿线 => 最近点 (红@3000)');
  assert(scrollTargetIndex(tps, 500) === 0, '首个绿线前 => 最近点 (红@0)');
  assert(scrollTargetIndex(tps, -100) === 0, '所有点之前 => 首行');
  assert(scrollTargetIndex(tps, 99999) === 4, '末尾 => 最后一条');
  assert(scrollTargetIndex([], 100) === -1, '空表 => -1');
}

if (failures) { console.error(`\nTESTS_V71_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V71_ALL_PASSED');

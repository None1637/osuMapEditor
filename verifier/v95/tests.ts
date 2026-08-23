// 验证器 v95 纯函数测试: placementLength 非锁定分支走 snapSliderLength (lazer FindSnappedDistance)
// 布景: 红线 1000/500, SM=1 => vel=0.2 px/ms; beatSnap 4 => tick 25px, snap 2 => 50px, snap 1 => 100px
import { placementLength } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const TPS: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];

section('beatSnap 4 (tick 25px): 就近取整但绝不超几何全长 (1ms=0.2px 容差)');
{
  assert(placementLength(TPS, 2000, 1, 100, false, 1, 4) === 100, '100 -> 4 tick 100 (恰在格上)');
  assert(placementLength(TPS, 2000, 1, 90, false, 1, 4) === 75, '90 -> 3 tick 75 (round 3.6->4 但超几何, 退一格)');
  assert(placementLength(TPS, 2000, 1, 110, false, 1, 4) === 100, '110 -> 4 tick 100 (round 4.4->4 未超)');
  assert(placementLength(TPS, 2000, 1, 87, false, 1, 4) === 75, '87 -> 3 tick 75');
  assert(placementLength(TPS, 2000, 1, 88, false, 1, 4) === 75, '88 -> 3 tick 75 (round 3.52->4, 100 > 88+0.2 容差, 退一格)');
}

section('beatSnap 2 / 1');
{
  assert(placementLength(TPS, 2000, 1, 150, false, 1, 2) === 150, 'snap2: 150 -> 3 tick 150');
  assert(placementLength(TPS, 2000, 1, 130, false, 1, 2) === 100, 'snap2: 130 -> 2 tick 100 (3 tick 超几何)');
  assert(placementLength(TPS, 2000, 1, 149, false, 1, 2) === 100, 'snap2: 149 -> 2 tick 100 (150 > 149.2 容差)');
  assert(placementLength(TPS, 2000, 1, 130, false, 1, 1) === 100, 'snap1: 130 -> 1 拍 100');
  assert(placementLength(TPS, 2000, 1, 160, false, 1, 1) === 100, 'snap1: 160 -> 1 拍 100 (2 拍超几何)');
}

section('下限与锁定间距分支不变');
{
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 4) === 1, '0 -> v160 钳到几何全长 1 (旧: 下限 1 tick 25)');
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 1) === 1, 'snap1: 0 -> v160 钳到 1 (旧: 下限 1 tick 100)');
  assert(placementLength(TPS, 2000, 1, 130, true, 1, 4) === 100, '锁 130 -> 1 拍 100');
  assert(placementLength(TPS, 2000, 1, 160, true, 1, 4) === 100, '锁 160 -> v160 退一拍 100 (2 拍 200 超几何+容差)');
}

if (failures) { console.error(`\nTESTS_V95_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V95_ALL_PASSED');

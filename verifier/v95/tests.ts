// 验证器 v95 纯函数测试: placementLength 非锁定分支走 snapSliderLength (lazer FindSnappedDistance)
// 布景: 红线 1000/500, SM=1 => vel=0.2 px/ms; v218: 长度吸附细分 = beatSnap×2 => snap 4/2/1 对应 tick 12.5/25/50px
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

section('beatSnap 4 (v218: 长度细分×2=8, tick 12.5px): 就近取整但绝不超几何全长 (1ms=0.2px 容差)');
{
  assert(placementLength(TPS, 2000, 1, 100, false, 1, 4) === 100, '100 -> 8 tick 100 (恰在格上)');
  assert(placementLength(TPS, 2000, 1, 90, false, 1, 4) === 88, '90 -> 7 tick=87.5 容差内取整 88 (v218; 旧: 3 tick 75)');
  assert(placementLength(TPS, 2000, 1, 110, false, 1, 4) === 100, '110 -> 8 tick 100 (round 8.8->9 但 112.5 超几何+容差, 退一格)');
  assert(placementLength(TPS, 2000, 1, 87, false, 1, 4) === 75, '87 -> 6 tick 75 (7 tick=87.5 超 1ms 容差, 退一格)');
  assert(placementLength(TPS, 2000, 1, 88, false, 1, 4) === 88, '88 -> 7 tick=87.5 容差内取整 88 (v218; 旧: 退 75)');
}

section('beatSnap 2 / 1 (v218: 长度细分 ×2 -> 4 / 2)');
{
  assert(placementLength(TPS, 2000, 1, 150, false, 1, 2) === 150, 'snap2: 150 -> 6 tick 150 (tick 25px)');
  assert(placementLength(TPS, 2000, 1, 130, false, 1, 2) === 125, 'snap2: 130 -> 5 tick 125 (v218; 旧: 2 tick 100)');
  assert(placementLength(TPS, 2000, 1, 149, false, 1, 2) === 125, 'snap2: 149 -> 5 tick 125 (6 tick=150 > 149.2 容差, 退一格)');
  assert(placementLength(TPS, 2000, 1, 130, false, 1, 1) === 100, 'snap1: 130 -> 1 拍 100 (3 tick=150 超几何, 退一格)');
  assert(placementLength(TPS, 2000, 1, 160, false, 1, 1) === 150, 'snap1: 160 -> 3 tick 150 (v218; 旧: 1 拍 100)');
}

section('下限与锁定间距分支不变');
{
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 4) === 13, '0 -> v219 亚 tick 对齐 1 tick=12.5 取整 13 (旧: 钳到 1)');
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 1) === 50, 'snap1: 0 -> v219 对齐 1 tick=50 (细分×2=2)');
  assert(placementLength(TPS, 2000, 1, 130, true, 1, 4) === 100, '锁 130 -> 1 拍 100');
  assert(placementLength(TPS, 2000, 1, 160, true, 1, 4) === 100, '锁 160 -> v160 退一拍 100 (2 拍 200 超几何+容差)');
}

if (failures) { console.error(`\nTESTS_V95_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V95_ALL_PASSED');

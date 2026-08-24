// 验证器 v83 纯函数测试: snapPlacementTime / placementLength (落盘规则收敛) + pendingSliderTimeline 委托后语义不变
// 布景: 红线 1000/500 => vel = 0.2 px/ms, 整拍 100px; beatSnap 4 => tick 125ms
import { snapPlacementTime, placementLength, pendingSliderTimeline } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const TPS: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];

section('snapPlacementTime: 就近 tick 吸附');
{
  assert(snapPlacementTime(TPS, 2000, 4) === 2000, '2000 -> 2000');
  assert(snapPlacementTime(TPS, 2060, 4) === 2000, '2060 -> 2000');
  assert(snapPlacementTime(TPS, 2070, 4) === 2125, '2070 -> 2125');
  assert(snapPlacementTime(TPS, 2130, 4) === 2125, '2130 -> 2125');
}

section('placementLength: 几何长 -> 锁定间距整拍 / v95: 非锁走 snapSliderLength 节拍吸附 -> 下限 20');
{
  assert(placementLength(TPS, 2000, 1, 100, false, 1, 4) === 100, '无锁 100 -> 8 tick 100 (v218 细分×2=8, tick 12.5px; 恰在格上)');
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 4) === 13, '0 -> v219 对齐 1 tick 12.5 取整 13 (允许超几何; 旧: 钳到 1)');
  assert(placementLength(TPS, 2000, 1, 90, false, 1, 4) === 88, '无锁 90 -> v218 7 tick=87.5 在 1ms 容差内取整 88 (旧: 3 tick 75)');
  assert(placementLength(TPS, 2000, 1, 110, false, 1, 4) === 100, '无锁 110 -> 8 tick 100 (9 tick=112.5 超容差退一格)');
  assert(placementLength(TPS, 2000, 1, 130, true, 1, 4) === 100, '锁 130 -> 1 拍 100');
  assert(placementLength(TPS, 2000, 1, 160, true, 1, 4) === 100, '锁 160 -> v160 退一拍 100 (2 拍 200 超几何+容差)');
  assert(placementLength(TPS, 2000, 1, 100.4, false, 1, 4) === 100, '取整 100.4 -> 100');
}

section('pendingSliderTimeline: 委托后语义不变 (v82 回归)');
{
  const PEND = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const a = pendingSliderTimeline(TPS, 1, PEND, null, 2000, 4, false, 1);
  assert(a.time === 2000 && a.end === 2500, `time=2000 end=2500 (实际 ${a.time}/${a.end})`);
  const b = pendingSliderTimeline(TPS, 1, [{ x: 0, y: 0 }, { x: 160, y: 0 }], null, 2000, 4, true, 1);
  assert(b.end === 2500, `锁 160px -> v160 退一拍 100px => end 2500 (实际 ${b.end}; 旧: 2 拍 end 3000)`);
  const c = pendingSliderTimeline(TPS, 1, PEND, { x: 150, y: 0 }, 2000, 4, false, 1);
  assert(c.end === 2750, `幻影光标 (150,0) => end 2750 (实际 ${c.end})`);
}

if (failures) { console.error(`\nTESTS_V83_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V83_ALL_PASSED');

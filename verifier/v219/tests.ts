// v219 纯函数测试: 亚 tick 长度对齐 + 预览路径截断
// 布景: 红线 1000/500, SM=1 => vel=0.2 px/ms, 拍=100px; v218 长度细分 = beatSnap×2 => snap4 tick=12.5px
import { snapSliderLength, placementLength, truncatePathAtLength, sliderLengthSnapDivisor } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const TPS: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];

section('亚 tick (几何 < 1 tick - 1ms 容差): 对齐到 1 tick, 允许超几何全长');
{
  // snap4 → div 8 → tick 12.5px, 1ms 容差 = 0.2px
  assert(snapSliderLength(TPS, 2000, 1, 0, 4) === 13, '几何 0 -> 1 tick 12.5 取整 13');
  assert(snapSliderLength(TPS, 2000, 1, 8, 4) === 13, '几何 8 -> 13 (12.5 > 8.2 容差, 亚 tick)');
  assert(snapSliderLength(TPS, 2000, 1, 12.2, 4) === 13, '几何 12.2 -> 13 (12.5 > 12.4 容差, 亚 tick)');
  assert(snapSliderLength(TPS, 2000, 1, 12.4, 4) === 12, '几何 12.4: 1 tick=12.5 落在 1ms 容差内 -> 非亚 tick, v160 钳 floor=12');
  assert(snapSliderLength(TPS, 2000, 1, 12.6, 4) === 12, '几何 12.6: 1 tick=12.5 在容差内, round(12.5)=13 > 12.6 -> v160 钳 12 (非亚 tick, 不触发 v219)');
  // snap16 → 无 1/32 -> div 16 → tick 6.25px
  assert(snapSliderLength(TPS, 2000, 1, 4, 16) === 6, 'snap16 (退回当前细分, tick 6.25): 几何 4 -> 取整 6');
}

section('placementLength: 亚 tick 不受 20px 下限 / geoCap 钳制; 常规路径不变');
{
  assert(placementLength(TPS, 2000, 1, 8, false, 1, 4) === 13, '亚 tick 8 -> 13 (不被 geoCap=8 钳回)');
  assert(placementLength(TPS, 2000, 1, 0, false, 1, 4) === 13, '几何 0 -> 13 (不被 20px 下限/geoCap 钳)');
  assert(placementLength(TPS, 2000, 1, 100, false, 1, 4) === 100, '常规: 100 -> 8 tick 100 不变');
  assert(placementLength(TPS, 2000, 1, 110, false, 1, 4) === 100, '常规: 110 -> 100 (退一格 + ≤ 几何 不变)');
  assert(placementLength(TPS, 2000, 1, 30, true, 1, 4) === 30, '锁定间距分支不变 (亚 tick 仍钳 geoCap=30)');
}

section('truncatePathAtLength: 折线按弧长截断');
{
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const t1 = truncatePathAtLength(line, 40);
  assert(t1.length === 2 && t1[1].x === 40 && t1[1].y === 0, '截 40 -> 末点 (40,0)');
  const t2 = truncatePathAtLength(line, 150);
  assert(t2.length === 3 && t2[2].x === 100 && t2[2].y === 50, '截 150 -> 拐角后插值 (100,50)');
  const t3 = truncatePathAtLength(line, 300);
  assert(t3.length === 3 && t3[2].y === 100, 'length ≥ 全长 -> 原路径 (不在预览里延长)');
  const t4 = truncatePathAtLength(line, 0);
  assert(t4.length === 2 && t4[1].x === 0 && t4[1].y === 0, '截 0 -> 头点 (退化)');
}

section('v218 细分映射回归');
{
  assert(sliderLengthSnapDivisor(4) === 8 && sliderLengthSnapDivisor(16) === 16 && sliderLengthSnapDivisor(12) === 12, '4→8, 16→16, 12→12');
}

if (failures) { console.error(`\nTESTS_V219_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V219_ALL_PASSED');

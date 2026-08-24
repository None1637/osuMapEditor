// 验证器 v160 纯函数测试: snapSliderLength / placementLength — 长度始终 ≤ 几何全长 (末控制点)
// v219 例外: 几何不足 1 个长度细分 tick 时对齐到 1 tick (允许超几何全长)
// lazer 依据: SliderPlacementBlueprint.updateSlider — ExpectedDistance = FindSnappedDistance(Path.CalculatedDistance);
//   ComposerDistanceSnapProvider.FindSnappedDistance — 超出 1ms 行程退一格 (beatLength/divisor)
import { snapSliderLength, placementLength } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 120BPM (beatLength=500), sliderMultiplier=1.4, sv=1 → vel=0.28px/ms, 拍=140px, beatSnap=4 → v218 长度细分×2=8 → tick=17.5px
const red: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
const pts = [red];
const snap = (geo: number) => snapSliderLength(pts, 0, 1.4, geo, 4);
const place = (geo: number, lock: boolean) => placementLength(pts, 0, 1.4, geo, lock, 1, 4);

section('snapSliderLength: 节拍吸附保持 (v218: 长度细分×2=8, tick 17.5px)');
{
  assert(snap(140) === 140, '几何 140 = 8 tick → 140');
  assert(snap(157) === 140, '几何 157 (8.97 tick) 就近 157.5 超容差 → 140');
  assert(snap(159) === 158, '几何 159: v218 9 tick=157.5 在 1ms 容差内 → 取整 158 (旧: 退一格 140)');
  assert(snap(20) === 18, `几何 20: v218 1 tick=17.5 容差内 → 取整 18 (旧: < 1 tick 35 钳到 20) (得 ${snap(20)})`);
}

section('snapSliderLength: 严格 ≤ 几何全长 (v160)');
{
  // 容差内微超: 10 tick = 175, 几何 174.9 — 旧实现返回 175 (超 0.1px 触发末端切线延长)
  assert(snap(174.9) === 174, `几何 174.9 容差内保留 10 tick 意图但钳到 174 (得 ${snap(174.9)})`);
  assert(snap(174.9) <= 174.9, '返回值 ≤ 几何全长');
  for (const geo of [33.3, 61.7, 100.49, 100.51, 174.9, 175.1, 279.94, 500.123]) {
    assert(snap(geo) <= geo, `几何 ${geo} → ${snap(geo)} ≤ 几何`);
  }
}

section('placementLength: 非锁定 ≤ 几何全长');
{
  assert(place(140, false) === 140, '140 → 140');
  assert(place(174.9, false) === 174, '174.9 → 174 (硬钳)');
  assert(place(10, false) === 18, '几何 10 (亚 tick) → v219 对齐 1 tick=17.5 取整 18 (允许超几何; 旧: 钳到 10)');
  assert(place(5, false) === 18 && place(15, false) === 18, '几何 5 / 15 (亚 tick) → v219 均对齐 1 tick 18');
  for (const geo of [99.6, 174.9, 175.01]) { // v219: 亚 tick (5/15) 例外, 不受 ≤ 几何约束
    assert(place(geo, false) <= geo, `非锁定 几何 ${geo} → ${place(geo, false)} ≤ 几何`);
  }
}

section('placementLength: 锁定间距 ≤ 几何全长 + 回退一拍');
{
  assert(place(140, true) === 140, '锁定 140 → 140 (1 拍)');
  assert(place(280, true) === 280, '锁定 280 → 280 (2 拍)');
  // 旧实现: round(210/140)=round(1.5)=2 → 280, 超几何 70px! 新实现: 超 1ms 退一拍 → 140
  assert(place(210, true) === 140, `锁定 210 (1.5 拍) 超 1ms 容差退一拍 → 140 (得 ${place(210, true)})`);
  // 容差内微超: 2 拍 = 280, 几何 279.9 → 钳到 279
  assert(place(279.9, true) === 279, `锁定 279.9 → 279 (得 ${place(279.9, true)})`);
  assert(place(10, true) === 10, '锁定 几何 10 → 钳到 10');
  for (const geo of [5, 100, 139.9, 140.1, 210, 279.9, 350]) {
    assert(place(geo, true) <= geo, `锁定 几何 ${geo} → ${place(geo, true)} ≤ 几何`);
  }
}

if (failures) { console.error(`V160_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V160_TESTS_PASSED');

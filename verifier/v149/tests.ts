// 验证器 v149 纯函数测试: 锁定间距 1x 基准含 SliderMultiplier × 当前 SV (lazer DurationToDistance 同源)
import { distanceLockDistance, spacingMultiplier } from '../../src/osu/spacing';
import type { Beatmap, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) < eps; }

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 } as TimingPoint);
const green = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 } as TimingPoint);
const bmOf = (sm: number, ds: number, tps: TimingPoint[]): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: ds, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: sm, sliderTickRate: 1 },
  timingPoints: tps, hitObjects: [],
} as unknown as Beatmap);

section('distanceLockDistance: 基准 = DS * 100 * SM * SV * 拍数');
{
  // SM 1, 无绿线: 与旧公式一致 (回归)
  const bm = bmOf(1, 1, [red(0, 500)]);
  assert(near(distanceLockDistance(bm, 1000, 2000), 200), `SM1 SV1 DS1 2拍 = 200 (实际 ${distanceLockDistance(bm, 1000, 2000)})`);
  // SM 1.4: 每拍 140px
  const bm14 = bmOf(1.4, 1, [red(0, 500)]);
  assert(near(distanceLockDistance(bm14, 1000, 2000), 280), `SM1.4 2拍 = 280 (实际 ${distanceLockDistance(bm14, 1000, 2000)})`);
  // SV 2 (绿线 -50): 每拍 200px; v227 起红线重置 SV (stable 语义, 取代 v148) — 红线后 2拍 = 100*2 = 200
  const bmSv = bmOf(1, 1, [red(0, 500), green(500, -50), red(1500, 500)]);
  assert(near(distanceLockDistance(bmSv, 2000, 3000), 200), `SV2 红线后重置 2拍 = 200 (实际 ${distanceLockDistance(bmSv, 2000, 3000)})`);
  // SM*SV 叠加 + DS: DS=2, SM=1.4, SV=2 → 每拍 560
  const bmAll = bmOf(1.4, 2, [red(0, 500), green(500, -50)]);
  assert(near(distanceLockDistance(bmAll, 1000, 1500), 560), `DS2 SM1.4 SV2 1拍 = 560 (实际 ${distanceLockDistance(bmAll, 1000, 1500)})`);
  // 参考时刻 = 前件结束时刻 (lazer referenceTime): 前件结束在 500ms 红线区, 放置时刻在 250ms 红线区
  // beatLength 取 500 (endTime=1000 处), 间隔 1500ms = 3 拍
  const bmRef = bmOf(1, 1, [red(0, 500), red(2000, 250)]);
  assert(near(distanceLockDistance(bmRef, 1000, 2500), 300), `拍长按参考时刻 500ms: 3拍 = 300 (实际 ${distanceLockDistance(bmRef, 1000, 2500)})`);
  // v211: 0.25 拍下限移除 (对齐 lazer 无下限), 0.2 拍按比例 = 20
  assert(near(distanceLockDistance(bm, 1900, 2000), 20), `0.2 拍 = 20 (实际 ${distanceLockDistance(bm, 1900, 2000)})`);
}

section('spacingMultiplier: 面板单位同步含 SM*SV');
{
  const bm = bmOf(1.4, 1, [red(0, 500), green(500, -50)]); // 每拍 280px
  assert(near(spacingMultiplier(bm, 1000, 2000, 560)!, 1), '560px / 2拍 / SM1.4 SV2 = 1.00x');
  assert(near(spacingMultiplier(bm, 1000, 2000, 280)!, 0.5), '280px / 2拍 = 0.50x');
  assert(spacingMultiplier(bm, 1000, 1000, 100) === null, '同刻 -> null (不变)');
  const bm0 = bmOf(1.4, 0, [red(0, 500)]);
  assert(spacingMultiplier(bm0, 1000, 2000, 100) === null, 'DS=0 -> null (不变)');
}

if (failures) { console.error(`\nV149_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV149_TESTS_ALL_PASSED');

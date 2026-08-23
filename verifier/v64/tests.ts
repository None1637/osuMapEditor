// 验证器 v64 纯函数测试: 多边形生成 (lazer PolygonGenerationPopover.tryCreatePolygon)
import { computePolygon, snapBeatTime, DEFAULT_POLYGON_PARAMS } from '../../src/osu/convert/polygon';
import type { Beatmap, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const approx = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const red = (time: number, beatLength: number): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0,
});
const green = (time: number, beatLength: number): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0,
});
const mkBm = (points: TimingPoint[], hitObjects: Beatmap['hitObjects'] = [], sm = 1.4): Beatmap =>
  ({ timingPoints: points, hitObjects, difficulty: { sliderMultiplier: sm } }) as unknown as Beatmap;

section('snapBeatTime: 四舍五入到当前红线 beatLength/divisor 网格');
{
  const pts = [red(0, 500)];
  assert(snapBeatTime(pts, 4, 2610) === 2625, '2610 -> 2625 (125ms 网格)');
  assert(snapBeatTime(pts, 4, 2490) === 2500, '2490 -> 2500');
  assert(snapBeatTime(pts, 4, 2560) === 2500, '2560 -> 2500 (距 2500 更近)');
}

section('computePolygon: 几何与 lazer 一致 (弦长=DS·v·timeSpacing, R=弦长/2sin(π/n), θᵢ=(i+1)·2π/n)');
{
  // 500ms beat, divisor 4, SM 1.4, 无滑条 (sv=1): v = 100·1.4/500 = 0.28 px/ms, timeSpacing = 125
  // chord = 1 × 0.28 × 125 = 35; R = 35/(2·sin60°) ≈ 20.2073
  const bm = mkBm([red(0, 500)]);
  const r = computePolygon(bm, 2500, 4, { ...DEFAULT_POLYGON_PARAMS, vertices: 3, repeats: 1, distanceSnap: 1 });
  assert(!r.outOfBounds && r.objects.length === 3, '3 顶点 1 圈 = 3 个单点');
  assert(r.startTime === 2500, '起始时间吸附 2500');
  const R = 35 / (2 * Math.sin(Math.PI / 3));
  const exp = (i: number) => {
    const a = (i + 1) * (2 * Math.PI / 3);
    return [Math.round(256 + R * Math.cos(a)), Math.round(192 + R * Math.sin(a))];
  };
  r.objects.forEach((o, i) => {
    const [ex, ey] = exp(i);
    assert(approx(o.x, ex) && approx(o.y, ey), `顶点${i} (${o.x},${o.y}) ≈ (${ex},${ey})`);
  });
  assert(r.objects[0].time === 2500 && r.objects[1].time === 2625 && r.objects[2].time === 2750, '时间按 1/4 拍推进');
  assert(!r.objects.some(o => o.newCombo), '默认无 newCombo');
}

section('computePolygon: 圈数/起始角/newCombo');
{
  const bm = mkBm([red(0, 500)]);
  const r = computePolygon(bm, 2500, 4, { vertices: 4, repeats: 2, offsetAngle: 90, distanceSnap: 1, newCombo: true });
  assert(r.objects.length === 8, '4 顶点 2 圈 = 8 个单点');
  assert(r.objects[0].newCombo === true && r.objects.slice(1).every(o => !o.newCombo), '仅首个 newCombo');
  // 起始角 90°: 第一点角 = 90°+90° = 180° => x < 256, y ≈ 192
  assert(r.objects[0].x < 256 && approx(r.objects[0].y, 192), `起始角生效 (第一点 ${r.objects[0].x},${r.objects[0].y})`);
}

section('computePolygon: SV 取最近滑条自身时间的绿线 (lazer lastWithSliderVelocity)');
{
  const slider = {
    id: 1, type: 'slider', x: 100, y: 100, time: 1000, endTime: 2000,
    curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100,
  } as unknown as Beatmap['hitObjects'][number];
  const bm = mkBm([red(0, 500), green(500, -50)], [slider]); // 滑条在 2x SV 下
  const p = { ...DEFAULT_POLYGON_PARAMS, vertices: 3, distanceSnap: 4 }; // 放大间距, 降低取整误差
  const r = computePolygon(bm, 2500, 4, p);
  const rNoSv = computePolygon(mkBm([red(0, 500)]), 2500, 4, p);
  const dist = (o: { x: number; y: number }) => Math.hypot(o.x - 256, o.y - 192);
  assert(approx(dist(r.objects[0]) / dist(rNoSv.objects[0]), 2, 0.02),
    `半径随 2x SV 翻倍 (${dist(r.objects[0]).toFixed(2)} vs ${dist(rNoSv.objects[0]).toFixed(2)})`);
}

section('computePolygon: 顶点出游玩区 => outOfBounds, 不生成');
{
  const bm = mkBm([red(0, 500)]);
  const r = computePolygon(bm, 2500, 1, { ...DEFAULT_POLYGON_PARAMS, vertices: 3, distanceSnap: 6 });
  assert(r.outOfBounds && r.objects.length === 0, 'divisor 1 + DS 6 => 半径 485 出界');
}

if (failures) { console.error(`\nTESTS_V64_FAILED: ${failures}`); process.exit(1); }
console.log('\nTESTS_V64_ALL_PASSED');

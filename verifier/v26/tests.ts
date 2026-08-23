// v26 单元断言: 滑条长度节拍吸附 (lazer SnapTo + FindSnappedDistance 对齐)
import { sliderGeometryLength, snapSliderLength, resnapSliderLength } from '../../src/osu/sliderPath';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// 基准 timing: 红线 1000ms, beatLength 500 (120BPM), sliderMultiplier 1.4
// vel = 100*1.4/500 = 0.28 px/ms; 每拍 140px; beatSnap=4 -> tickPx = 35
const TP: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];
const snap = (geo: number, div = 4) => snapSliderLength(TP, 5000, 1.4, geo, div);

// ---- snapSliderLength: 就近取整 ----
assert(snap(140) === 140, '几何=整 4 tick -> 140');
assert(snap(150) === 140, '几何 150 (4.29 tick) 就近 -> 4 tick = 140');
assert(snap(157) === 140, '几何 157 (4.49 tick) 就近 -> 140');
assert(snap(180) === 175, '几何 180 (5.14 tick) 就近 -> 5 tick = 175');

// ---- 绝不超过几何全长 (1ms 容差 = vel*1 = 0.28px) ----
assert(snap(158) === 140, '几何 158: 就近 5 tick=175 超出几何+容差 -> 退为 140');
assert(snap(174.9) === 174, '几何 174.9: 175 在 1ms 容差内 (tick 意图保留) 但 v160 硬钳到 174 (长度 ≤ 末控制点)');

// ---- 下限 1 tick (v160: 仍不得超几何全长, 钳到 floor(几何)) ----
assert(snap(10) === 10, '几何 10 (0.29 tick) -> v160 钳到 10 (旧: 1 tick = 35 超几何)');
assert(snap(0) === 1, '几何 0 -> v160 钳到 1 (下限 1px; 旧: 35)');

// ---- beatSnap 联动 ----
assert(snap(150, 1) === 140, 'beatSnap=1: tick=140, 150 -> 140');
assert(snap(150, 2) === 140, 'beatSnap=2: tick=70, 150 (2.14) -> 2 tick = 140');
// 180/70=2.571 就近 3 tick=210 > 180+0.28 -> 退 2 tick = 140
assert(snap(180, 2) === 140, 'beatSnap=2: 180 -> 就近 3 tick=210 超出 -> 退为 140');

// ---- 绿线 SV 联动: -50 = 2x -> vel 0.56, tickPx = 70 ----
const TP2: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
  { time: 1000, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
];
assert(snapSliderLength(TP2, 5000, 1.4, 300, 4) === 280, 'SV 2x: tickPx=70, 300 (4.29) -> 4*70=280');

// ---- 兜底: 空 timing 用默认红线 (500ms); multiplier 0 -> 原长 ----
assert(snapSliderLength([], 0, 1.4, 140, 4) === 140, '空 timing: 默认 500ms 红线, vel=0.28, 140 -> 140');
assert(snapSliderLength(TP, 5000, 0, 123, 4) === 123, 'sliderMultiplier=0 -> 返回原几何长');

// ---- sliderGeometryLength: 与渲染路径同算法 ----
assert(Math.abs(sliderGeometryLength('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }]) - 100) < 1e-6, 'L 两点长度 100');
assert(Math.abs(sliderGeometryLength('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]) - 200) < 1e-6, 'L 三点长度 200');
{
  // B 带红锚点重复对: 两条直线段 (0,0)->(100,0) 与 (100,0)->(100,100)
  const geo = sliderGeometryLength('B', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert(Math.abs(geo - 200) < 2, `B 红点对分段几何全长 ~200 (实际 ${geo.toFixed(2)})`);
}

// ---- resnapSliderLength: 写回 o.length ----
{
  const bm = { timingPoints: TP, difficulty: { sliderMultiplier: 1.4 } } as unknown as Beatmap;
  const o = { type: 'slider', x: 100, y: 100, curveType: 'L', curvePoints: [{ x: 250, y: 100 }], time: 5000, length: 150 } as HitObject;
  resnapSliderLength(bm, o, 4);
  assert(o.length === 140, `resnap 写回: 几何 150 -> 140 (实际 ${o.length})`);
  const c = { type: 'circle', x: 0, y: 0, time: 0 } as HitObject;
  resnapSliderLength(bm, c, 4); // 非滑条不报错
}

if (failures) { console.error(`V26_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('v26 纯函数断言全部通过');

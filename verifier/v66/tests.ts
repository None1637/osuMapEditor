// 验证器 v66 纯函数测试: 手绘滑条 B 样条拟合 (osu-framework IncrementalBSplineBuilder / PathApproximator 移植)
import { IncrementalBSplineBuilder, FD_EPSILON } from '../../src/osu/freehand/bsplineBuilder';
import { bSplineToPiecewiseLinear, piecewiseLinearToBSpline } from '../../src/osu/freehand/pathApproximator';
import { fitSegmentsToPoints, circularArcProperties } from '../../src/osu/freehand/freehandFit';
import type { Vec } from '../../src/osu/freehand/pathApproximator';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const CIRCLE_THRESHOLD = 0.0015; // lazer FreehandSliderToolboxGroup 默认
const mkBuilder = () => new IncrementalBSplineBuilder(4, 1.8, 0.4); // lazer SliderPlacementBlueprint 参数

/** 沿参数方程喂点 (模拟拖动采样, 每 step 一个点) */
function feed(builder: IncrementalBSplineBuilder, fn: (t: number) => Vec, steps: number) {
  for (let i = 0; i <= steps; i++) builder.addLinearPoint(fn(i / steps));
  builder.finish();
}

section('bSplineToPiecewiseLinear: 端点锚定 + 2 点退化为直线');
{
  const line = bSplineToPiecewiseLinear([{ x: 0, y: 0 }, { x: 100, y: 0 }], 4);
  assert(line.length >= 2 && line[0].x === 0 && line[line.length - 1].x === 100, '2 点 => 直线端点');
  const quad = bSplineToPiecewiseLinear([{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], 4);
  assert(quad[0].x === 0 && quad[quad.length - 1].x === 100, '3 点 (degree 降为 2 = 二次贝塞尔) 端点锚定');
  // 中点附近 y 应接近抛物线峰值 50 (0.25*(0+2*100+0))
  const mid = quad.reduce((a, b) => (b.y > a.y ? b : a));
  assert(Math.abs(mid.y - 50) < 3, `峰值 ≈ 50 (实际 ${mid.y.toFixed(1)})`);
}

section('piecewiseLinearToBSpline: 直线输入拟合误差小');
{
  const input: Vec[] = [];
  for (let i = 0; i <= 20; i++) input.push({ x: i * 10, y: Math.sin(i / 20 * Math.PI) * 30 });
  const cps = piecewiseLinearToBSpline(input, 6, 4, 100, 200, 5, 0.8, 0.99, undefined, undefined);
  assert(cps.length === 6, '控制点数量 = 请求值');
  const out = bSplineToPiecewiseLinear(cps, 4);
  // 拟合路径与输入的偏差: 采样中点 y 应接近 sin 曲线
  const midOut = out[Math.floor(out.length / 2)];
  assert(Math.abs(midOut.x - 100) < 20 && midOut.y > 15, `拟合形状保持 (中点 ${midOut.x.toFixed(0)},${midOut.y.toFixed(0)})`);
}

section('builder: 直线手绘 => 单段 2 控制点 (allOnLine 特判)');
{
  const b = mkBuilder();
  feed(b, t => ({ x: t * 200, y: 0 }), 40);
  const segs = b.getControlPoints();
  assert(segs.length === 1, `1 段 (实际 ${segs.length})`);
  assert(segs[0].length === 2, `直线段只留 2 端点 (实际 ${segs[0].length})`);
  assert(Math.abs(segs[0][0].x) < 2 && Math.abs(segs[0][1].x - 200) <= 2, `端点 (0)->(≈200, lazer 平滑采样同口径) (实际 ${segs[0][0].x.toFixed(1)} -> ${segs[0][1].x.toFixed(1)})`);
  const fit = fitSegmentsToPoints(segs, b.degree, CIRCLE_THRESHOLD);
  assert(!fit.singleArc && fit.points.length === 2, 'fit: 2 点非圆弧');
}

section('builder: 圆弧手绘 => 单段, 圆弧特判命中 (singleArc)');
{
  const b = mkBuilder();
  // 四分之一圆: 圆心 (200,200) 半径 50, 从 (200,150) 到 (250,200)
  feed(b, t => {
    const th = -Math.PI / 2 + t * Math.PI / 2;
    return { x: 200 + 50 * Math.cos(th), y: 200 + 50 * Math.sin(th) };
  }, 30);
  const segs = b.getControlPoints();
  assert(segs.length === 1, `平滑圆弧无拐角 = 1 段 (实际 ${segs.length})`);
  const fit = fitSegmentsToPoints(segs, b.degree, CIRCLE_THRESHOLD);
  assert(fit.singleArc && fit.points.length === 3, `圆弧特判 => 3 点 P (实际 points=${fit.points.length}, singleArc=${fit.singleArc})`);
  // 三点应近似共圆 (外接圆半径 ≈ 50)
  const arc = circularArcProperties(fit.points[0], fit.points[1], fit.points[2]);
  assert(arc.isValid && Math.abs(arc.radius - 50) < 8, `外接圆半径 ≈ 50 (实际 ${arc.radius.toFixed(1)})`);
}

section('builder: L 形拐角 => 检测到拐角, 分 2 段 (段起点红锚点)');
{
  const b = mkBuilder();
  feed(b, t => (t < 0.5 ? { x: t * 2 * 120, y: 0 } : { x: 120, y: (t - 0.5) * 2 * 120 }), 60);
  const segs = b.getControlPoints();
  assert(segs.length === 2, `L 形 = 2 段 (实际 ${segs.length})`);
  const fit = fitSegmentsToPoints(segs, b.degree, CIRCLE_THRESHOLD);
  const reds = fit.points.filter(p => p.red);
  assert(reds.length === 1 && Math.abs(reds[0].x - 120) < 10 && Math.abs(reds[0].y) < 10,
    `段起点红锚点 ≈ (120,0) (实际 ${JSON.stringify(reds)})`);
}

section('builder: FD_EPSILON 细节丢弃 (尾部跟随点机制)');
{
  assert(FD_EPSILON === 2, 'FD_EPSILON = BEZIER_TOLERANCE×8 = 2.0');
  const b = mkBuilder();
  b.addLinearPoint({ x: 0, y: 0 });
  // 连续 1px 微步 (< FD_EPSILON*2=4): 不进入主路径, 只更新尾部跟随点
  for (let i = 1; i <= 3; i++) b.addLinearPoint({ x: i, y: 0 });
  assert(b.getInputPath().length === 2, '微步不污染主路径 (仍 2 点)');
  b.addLinearPoint({ x: 10, y: 0 }); // 超过阈值: 落一个主路径点
  assert(b.getInputPath().length === 3, '超阈值后落主路径点');
}

if (failures) { console.error(`\nTESTS_V66_FAILED: ${failures}`); process.exit(1); }
console.log('\nTESTS_V66_ALL_PASSED');

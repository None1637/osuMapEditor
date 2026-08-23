// 验证器 v73 纯函数测试: 手绘滑条落盘对齐 lazer
// (v73: BSplineToBezier / ConvertCircleToBezierAnchors 移植; v74 语义变更: 落盘 'B4' 保留 builder 原始控制点)
import { IncrementalBSplineBuilder } from '../../src/osu/freehand/bsplineBuilder';
import { bSplineToPiecewiseLinear, bSplineToBezier, type Vec } from '../../src/osu/freehand/pathApproximator';
import { fitSegmentsToPoints, convertCircleToBezierAnchors, circularArcProperties, type FitResult } from '../../src/osu/freehand/freehandFit';
import { SliderPath } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const CIRCLE_THRESHOLD = 0.0015;
const mkBuilder = () => new IncrementalBSplineBuilder(4, 1.8, 0.4);
function feed(builder: IncrementalBSplineBuilder, fn: (t: number) => Vec, steps: number) {
  for (let i = 0; i <= steps; i++) builder.addLinearPoint(fn(i / steps));
  builder.finish();
}

// ---- 测试辅助: stable 'B' 语义 (重复点分段 + de Casteljau) ----
function deCasteljau(pts: Vec[], t: number): Vec {
  let work = pts.map(p => ({ ...p }));
  for (let k = work.length - 1; k > 0; k--)
    for (let i = 0; i < k; i++)
      work[i] = { x: work[i].x + (work[i + 1].x - work[i].x) * t, y: work[i].y + (work[i + 1].y - work[i].y) * t };
  return work[0];
}
/** fit 结果 -> stable 控制点列 (红锚点加倍, 与 finishFreehandSlider 同规则) */
function toStablePoints(fit: FitResult): Vec[] {
  const out: Vec[] = [{ x: fit.points[0].x, y: fit.points[0].y }];
  for (const pt of fit.points.slice(1)) {
    out.push({ x: pt.x, y: pt.y });
    if (pt.red) out.push({ x: pt.x, y: pt.y });
  }
  return out;
}
function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
/** 折线 P 上各点到折线 Q 的最大偏差 */
function maxDeviation(P: Vec[], Q: Vec[]): number {
  let max = 0;
  for (const p of P) {
    let min = Infinity;
    for (let i = 0; i < Q.length - 1; i++) min = Math.min(min, distToSeg(p, Q[i], Q[i + 1]));
    if (min > max) max = min;
  }
  return max;
}

section('bSplineToBezier: Boehm 转贝塞尔锚点 (framework BSplineToBezier)');
{
  const two = bSplineToBezier([{ x: 0, y: 0 }, { x: 100, y: 0 }], 4);
  assert(two.length === 2 && two[1].x === 100, '<2 段: 原样 (2 点)');
  const five = [0, 1, 2, 3, 4].map(i => ({ x: i * 30, y: Math.sin(i) * 40 }));
  const r5 = bSplineToBezier(five, 4);
  assert(r5.length === 5 && r5.every((p, i) => p.x === five[i].x && p.y === five[i].y), '<=degree+1 点: 单条贝塞尔原样返回');
  const six = [0, 1, 2, 3, 4, 5].map(i => ({ x: i * 30, y: Math.sin(i) * 40 }));
  const r6 = bSplineToBezier(six, 4);
  assert(r6.length === 10, `6 点 degree4 => 2 piece 平铺 10 点 (实际 ${r6.length})`);
  assert(r6[4].x === r6[5].x && r6[4].y === r6[5].y, 'piece 间共享端点 = 连续重复点');
  assert(r6[0].x === six[0].x && r6[9].x === six[5].x, '首末端点锚定');
  const col = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ x: i * 25, y: 7 }));
  assert(bSplineToBezier(col, 4).every(p => Math.abs(p.y - 7) < 1e-9), '共线输入 => 锚点共线');
}

section('convertCircleToBezierAnchors: 圆预设高精度逼近 (BezierConverter)');
{
  // 四分之一圆 r=50 圆心原点: (50,0) -> (0,50), 中点 45°
  const q = [{ x: 50, y: 0 }, { x: 50 * Math.SQRT1_2, y: 50 * Math.SQRT1_2 }, { x: 0, y: 50 }];
  const anchors = convertCircleToBezierAnchors(q);
  assert(anchors.length >= 3, `锚点列 (实际 ${anchors.length})`);
  const path: Vec[] = [];
  for (let i = 0; i <= 60; i++) path.push(deCasteljau(anchors, i / 60));
  const maxErr = Math.max(...path.map(p => Math.abs(Math.hypot(p.x, p.y) - 50)));
  assert(maxErr < 0.05, `弧上点到圆心距离 ≈ 50 (最大误差 ${maxErr.toFixed(4)}px)`);
  // lazer 同款预设固有径向误差 (~0.013px @ r50): 端点在预设曲线上, 非数学圆
  assert(Math.abs(path[0].x - 50) < 0.01 && Math.abs(path[path.length - 1].y - 50) < 0.05, '端点贴合 (含预设固有误差)');
  // 反向弧 (顺时针)
  const qr = [{ x: 0, y: 50 }, { x: 50 * Math.SQRT1_2, y: 50 * Math.SQRT1_2 }, { x: 50, y: 0 }];
  const pathR: Vec[] = [];
  const anchorsR = convertCircleToBezierAnchors(qr);
  for (let i = 0; i <= 60; i++) pathR.push(deCasteljau(anchorsR, i / 60));
  const maxErrR = Math.max(...pathR.map(p => Math.abs(Math.hypot(p.x, p.y) - 50)));
  assert(maxErrR < 0.05, `反向弧也在圆上 (最大误差 ${maxErrR.toFixed(4)}px)`);
  // 退化 (共线 3 点) => 原样
  const col = convertCircleToBezierAnchors([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
  assert(col.length === 3 && col[2].x === 100, '退化弧原样返回');
}

section('fitSegmentsToPoints: v74 落盘 ' + "'B4'" + ' — 保留 builder 原始控制点 (数量少)');
{
  // 合成 8 控制点平滑段 (禁用圆弧特判: threshold 0)
  const seg = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: i * 50, y: Math.sin(i / 7 * Math.PI * 2) * 60 }));
  const fit = fitSegmentsToPoints([seg], 4, 0);
  // v74: 不再转贝塞尔锚点, 控制点 = builder 原始输出 (8 点, 无红锚点接缝)
  assert(fit.points.length === 8 && !fit.points.some(p => p.red),
    `8 控制点原样保留, 无红接缝 (实际 points=${fit.points.length}, reds=${fit.points.filter(p => p.red).length})`);
  assert(fit.points.every((p, i) => p.x === seg[i].x && p.y === seg[i].y), '控制点逐点 = builder 输出');
}

section('fitSegmentsToPoints: builder 长笔画集成 (B4 少控制点, 路径贴合)');
{
  const b = mkBuilder();
  feed(b, t => ({ x: t * 700, y: Math.sin(t * Math.PI * 5) * 50 }), 200);
  const segs = b.getControlPoints();
  assert(segs.length === 1 && segs[0].length >= 6, `长平滑笔画 => 单段 >=6 控制点 (实际 ${segs[0].length})`);
  const fit = fitSegmentsToPoints(segs, b.degree, CIRCLE_THRESHOLD);
  // v74: 控制点少 (= builder 输出数量), 不再产生 Boehm 接缝红锚点
  assert(fit.points.length === segs[0].length && !fit.points.some(p => p.red),
    `控制点 = builder 原始 ${segs[0].length} 个 (实际 ${fit.points.length})`);
  // 'B4' 渲染路径 ≡ builder 拟合 (同 bSplineToPiecewiseLinear), 且贴合手绘轨迹
  const stable = SliderPath.computeRawPath('B4', toStablePoints(fit));
  const draw: Vec[] = [];
  for (let i = 0; i <= 200; i++) { const t = i / 200; draw.push({ x: t * 700, y: Math.sin(t * Math.PI * 5) * 50 }); }
  const devDraw = maxDeviation(draw, stable);
  assert(devDraw < 3, `'B4' 路径贴合手绘轨迹 (最大偏差 ${devDraw.toFixed(2)}px)`);
}

section('fitSegmentsToPoints: 多段内弧段保留 B 样条控制点 (v74, 形状不变点更少)');
{
  const b = mkBuilder();
  // 四分之一圆接直角折线 (拐角分段)
  feed(b, t => {
    if (t < 0.5) {
      const th = -Math.PI / 2 + (t * 2) * Math.PI / 2;
      return { x: 200 + 50 * Math.cos(th), y: 200 + 50 * Math.sin(th) };
    }
    return { x: 250 + (t - 0.5) * 2 * 100, y: 200 };
  }, 60);
  const segs = b.getControlPoints();
  assert(segs.length === 2, `弧+折线 => 2 段 (实际 ${segs.length})`);
  const fit = fitSegmentsToPoints(segs, b.degree, CIRCLE_THRESHOLD);
  assert(!fit.singleArc, '多段不整条 P');
  // v74: 弧段保留 B 样条控制点 — 首红点位置 = 首段控制点数-1 (非末段不补尾点)
  const firstRed = fit.points.findIndex(p => p.red);
  assert(firstRed === segs[0].length - 1, `弧段保留 ${segs[0].length} 个 B 样条控制点 (首红点位于 ${firstRed})`);
  // 'B4' 路径贴合原手绘轨迹 (B 样条拟合本身过弧, 形状不变)
  const stable = SliderPath.computeRawPath('B4', toStablePoints(fit));
  const draw: Vec[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    if (t < 0.5) {
      const th = -Math.PI / 2 + (t * 2) * Math.PI / 2;
      draw.push({ x: 200 + 50 * Math.cos(th), y: 200 + 50 * Math.sin(th) });
    } else draw.push({ x: 250 + (t - 0.5) * 2 * 100, y: 200 });
  }
  const dev = maxDeviation(draw, stable);
  assert(dev < 3, `'B4' 路径贴合手绘轨迹 (最大偏差 ${dev.toFixed(2)}px)`);
}

section('regression: 单段整弧仍 => P 三点 / 直线 => 2 点');
{
  const b1 = mkBuilder();
  feed(b1, t => {
    const th = -Math.PI / 2 + t * Math.PI / 2;
    return { x: 200 + 50 * Math.cos(th), y: 200 + 50 * Math.sin(th) };
  }, 30);
  const fit1 = fitSegmentsToPoints(b1.getControlPoints(), b1.degree, CIRCLE_THRESHOLD);
  assert(fit1.singleArc && fit1.points.length === 3, '单段整弧 => 3 点 P');
  const b2 = mkBuilder();
  feed(b2, t => ({ x: t * 200, y: 0 }), 40);
  const fit2 = fitSegmentsToPoints(b2.getControlPoints(), b2.degree, CIRCLE_THRESHOLD);
  assert(!fit2.singleArc && fit2.points.length === 2 && !fit2.points.some(p => p.red), '直线 => 2 点无红');
}

if (failures) { console.error(`\nTESTS_V73_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V73_ALL_PASSED');

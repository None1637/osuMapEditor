// 验证器 v237 行为测试: 圆弧转贝塞尔误差驱动最少分段 (circleToBezier, P 滑条转换路径)
//   - 单段最大圆心角 thetaMax = clamp(误差 ≤ ARC_BEZIER_ERR(0.2px) 的最大角, 90°, 180°) — 取代固定 90° 分块
//   - 小弧/小半径大弧减控制点 (段数 ≤ 旧固定 90° 分块), 大半径弧段数不变 (下钳 90°)
//   - 段数随总圆心角单调不减; 每段 64 等参采样径向误差 ≤ 0.2px; 首末端点精确
//   - 共线退化与旧实现一致 (返回两点直线段)
import { ARC_BEZIER_ERR, circleToBezier, deCasteljau, segmentsToPoints, sliderToBezierSegments } from '../../src/osu/convert/bezierPath';
import { genId, type HitObject, type Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

/** 圆心在原点、半径 r、总圆心角 deg 的圆弧三点 (a 在 0°, b 中点, c 末点; cw = 顺时针) */
const arc3 = (r: number, deg: number, cw = false): [Vec2, Vec2, Vec2] => {
  const t = (deg * Math.PI / 180) * (cw ? -1 : 1);
  const pt = (a: number): Vec2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  return [pt(0), pt(t / 2), pt(t)];
};
const chunksOf = (r: number, deg: number, cw = false) => circleToBezier(...arc3(r, deg, cw)).length;
/** 段序列对圆 (原点, r) 的最大径向拟合误差 (每段 64 等参采样) */
const maxRadialErr = (segs: Vec2[][], r: number) => {
  let m = 0;
  for (const seg of segs) for (let i = 1; i < 64; i++) {
    const p = deCasteljau(seg, i / 64);
    const e = Math.abs(Math.hypot(p.x, p.y) - r);
    if (e > m) m = e;
  }
  return m;
};
const oldChunks = (deg: number) => Math.max(1, Math.ceil(deg / 90)); // 旧固定 90° 分块

section('误差上限常量');
assert(ARC_BEZIER_ERR === 0.2, `ARC_BEZIER_ERR = 0.2px (实际 ${ARC_BEZIER_ERR})`);

section('小弧 1 段 (P 滑条 3 点 → B 4 节点 = 2 个新控制点)');
{
  assert(chunksOf(500, 20) === 1, `r=500 20° 弧 1 段 (实际 ${chunksOf(500, 20)})`);
  const o: HitObject = {
    id: genId(), type: 'slider', x: 500, y: 0, time: 0, curveType: 'P',
    curvePoints: arc3(500, 20).slice(1), slides: 1, length: 0,
  };
  const segs = sliderToBezierSegments(o);
  assert(segs.length === 1 && segs[0].length === 4, `P 滑条 → 1 条三次贝塞尔 (实际 ${segs.length} 段)`);
  const pts = segmentsToPoints(segs);
  assert(pts.length === 4, `转回控制点 = 4 节点 (原 3 点 + 2 新控制点; 实际 ${pts.length})`);
  // 大半径小弧与旧实现一致 (Crystalia 同款 r≈1502, 6.6°): 下钳 90° → 仍 1 段
  assert(chunksOf(1502, 6.6) === 1, `r=1502 6.6° 弧仍 1 段 (实际 ${chunksOf(1502, 6.6)})`);
}

section('减点实证 (新段数 < 旧固定 90° 分块)');
{
  assert(chunksOf(100, 120) === 1 && oldChunks(120) === 2, `r=100 120° 弧: 1 段 (旧 2 段)`);
  assert(chunksOf(60, 270) === 2 && oldChunks(270) === 3, `r=60 270° 弧: 2 段 (旧 3 段)`);
  assert(chunksOf(30, 150) === 1 && oldChunks(150) === 2, `r=30 150° 弧: 1 段 (旧 2 段)`);
}

section('段数随圆心角单调不减, 且恒 ≤ 旧实现 (下钳 90° 保证控制点不增多)');
{
  let prev = 0, mono = true, leq = true;
  for (let deg = 10; deg <= 350; deg += 10) {
    const n = chunksOf(100, deg);
    if (n < prev) mono = false;
    if (n > oldChunks(deg)) leq = false;
    prev = n;
  }
  assert(mono, 'r=100, 10°..350° 段数单调不减');
  assert(leq, 'r=100, 10°..350° 段数 ≤ 旧固定 90° 分块');
  let leqAll = true;
  for (const r of [5, 15, 30, 60, 100, 200, 500, 1502])
    for (let deg = 10; deg <= 350; deg += 10)
      if (chunksOf(r, deg) > oldChunks(deg)) { leqAll = false; console.error(`    r=${r} ${deg}°: 新 ${chunksOf(r, deg)} > 旧 ${oldChunks(deg)}`); }
  assert(leqAll, '全半径扫描段数 ≤ 旧实现');
}

section('拟合误差: 减段时 ≤ 0.2px; 下钳 90° 的大半径弧不劣于旧实现 (全半径/角度/双方向扫描)');
{
  // 单位圆对称弧 k=4/3·tan(θ/4) 贝塞尔的径向误差 (与实现同公式, 用于推算旧固定 90° 分块的误差基准)
  const unitErr = (theta: number) => {
    const a = theta / 2, k = (4 / 3) * Math.tan(theta / 4), ca = Math.cos(a), sa = Math.sin(a);
    const p0 = { x: ca, y: -sa }, p3 = { x: ca, y: sa };
    let m = 0;
    const seg = [p0, { x: p0.x + k * sa, y: p0.y + k * ca }, { x: p3.x + k * sa, y: p3.y - k * ca }, p3];
    for (let i = 1; i < 64; i++) {
      const p = deCasteljau(seg, i / 64);
      const e = Math.abs(Math.hypot(p.x, p.y) - 1);
      if (e > m) m = e;
    }
    return m;
  };
  let maxErr = 0, worst = '', badNew = 0, badOld = 0;
  for (const r of [5, 15, 30, 60, 100, 200, 500, 1502])
    for (let deg = 10; deg <= 350; deg += 17)
      for (const cw of [false, true]) {
        const segs = circleToBezier(...arc3(r, deg, cw));
        const e = maxRadialErr(segs, r);
        if (e > maxErr) { maxErr = e; worst = `r=${r} ${deg}° ${cw ? 'CW' : 'CCW'}`; }
        // 旧实现基准: 固定 90° 分块, 块角 = deg/oldChunks
        const oldErr = unitErr(deg * Math.PI / 180 / oldChunks(deg)) * r;
        if (segs.length < oldChunks(deg)) { // 减了段就必须满足误差上限
          if (e > ARC_BEZIER_ERR + 1e-6) badNew++;
        } else if (Math.abs(e - oldErr) > 1e-6) badOld++; // 段数相同 = 分块角相同 (含下钳 90° 的大半径弧), 误差应与旧实现逐点一致
      }
  assert(badNew === 0, `减段的弧误差全部 ≤ 0.2px (违例 ${badNew} 处)`);
  assert(badOld === 0, `未减段的弧与旧实现逐点一致 (违例 ${badOld} 处; 扫描最大误差 ${maxErr.toFixed(4)}px @ ${worst}, 系下钳 90° 的大半径弧, 与旧实现相同)`);
}

section('端点精确 + 共线退化不变');
{
  const [a, , c] = arc3(100, 130);
  const segs = circleToBezier(a, { x: 100 * Math.cos(1.134), y: 100 * Math.sin(1.134) }, c);
  const first = segs[0][0], last = segs[segs.length - 1][3];
  assert(Math.hypot(first.x - a.x, first.y - a.y) < 1e-9 && Math.hypot(last.x - c.x, last.y - c.y) < 1e-9, '首段首点=a, 末段末点=c (精确)');
  const col = circleToBezier({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 });
  assert(col.length === 1 && col[0].length === 2, '共线 → 两点直线段 (旧行为不变)');
}

if (failures) { console.error(`\nV237_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV237_TESTS_ALL_PASSED');

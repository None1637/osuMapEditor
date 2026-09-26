// 验证器 v283 数值测试: 滑条路径与 osu!lazer 对齐 (7 项差异修复)
// 依据: lazer SliderPath.cs calculateSubPath/calculateLength; PathApproximator.cs (framework);
//   CircularArcProperties.cs; ConvertHitObjectParser.convertPoints
import { SliderPath, flattenBezier, getSliderPath } from '../../src/osu/sliderPath';
import { parseHitObjectLine, type Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

function distToPath(p: Vec2, pts: Vec2[]): number {
  // 点到折线 (逐段) 距离 — 不是到顶点: 线性段 (2 控制点贝塞尔 / L 型) 与 lazer 一样不细分,
  // 顶点间距天然大, 点到顶点距离会把"零弦误差"误判成大偏差
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    min = Math.min(min, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  if (pts.length === 1) min = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  return min;
}
function deCasteljau(pts: Vec2[], t: number): Vec2 {
  const w = pts.map(p => ({ ...p }));
  for (let k = w.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      w[i] = { x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t };
    }
  }
  return w[0];
}

section('差异3: pixelLength 截断精确落点 (expected 落在段中间)');
{
  // 直线 100px, expected = 37.25 (落在 1px 细分点 37 与 38 之间)
  const p = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 37.25);
  assert(p.totalLength === 37.25, `totalLength 精确 = expected (实际 ${p.totalLength})`);
  assert(p.cumulative[p.cumulative.length - 1] === 37.25, 'cumulative 末项 = expected (表不矛盾)');
  const tail = p.positionAt(p.totalLength);
  assert(tail.x === 37.25 && tail.y === 0, `尾点精确落在 (37.25, 0) (实际 ${tail.x}, ${tail.y})`);
  // 曲线路径: 圆弧 r=100 四分之一圆 (全长 ~157.08), expected = 100 (落在采样段中间)
  const q = new SliderPath('P', [{ x: 100, y: 0 }, { x: 70.71067811865476, y: 70.71067811865476 }, { x: 0, y: 100 }], 100);
  const qt = q.positionAt(q.totalLength);
  assert(Math.abs(q.totalLength - 100) < 1e-9, `圆弧 totalLength = 100 (实际 ${q.totalLength})`);
  // 尾点必在圆上且距起点弧长 ~100: 角度 = 100/100 = 1 rad → (100·cos1, 100·sin1) ≈ (54.03, 84.15)
  // 容差 0.15: 截断沿折线进行 (lazer calculateLength 同款), 折线径向误差 ≤0.1px, 与真圆弧弧长 parametrization 有固有偏差
  assert(Math.hypot(qt.x - 54.0302305858, qt.y - 84.1470984808) < 0.15,
    `圆弧尾点 = 弧长 100 处精确切点 (实际 ${qt.x.toFixed(4)}, ${qt.y.toFixed(4)})`);
}

section('差异1: P 型点数 ≠3 解析层转 BEZIER / 3 点共线转 LINEAR');
{
  // 4 点 P (含头部共 4 个控制点): lazer convertPoints → 整条 BEZIER
  const o4 = parseHitObjectLine('0,0,1000,2,0,P|100:100|200:100|300:0,1,400');
  assert(o4 !== null && o4.curveType === 'B', `P 4 点 → 'B' (实际 ${o4?.curveType})`);
  // 3 点共线 P: → LINEAR
  const oCol = parseHitObjectLine('0,0,1000,2,0,P|100:0|200:0,1,200');
  assert(oCol !== null && oCol.curveType === 'L', `P 3 点共线 → 'L' (实际 ${oCol?.curveType})`);
  // 3 点正常 P 保持 'P'
  const oP = parseHitObjectLine('0,0,1000,2,0,P|100:100|200:0,1,200');
  assert(oP !== null && oP.curveType === 'P', `P 3 点不共线 → 保持 'P' (实际 ${oP?.curveType})`);
  // 形状: 4 点 P 解析为 B 后路径经过全部控制点 (贝塞尔插值性质: 过首尾, 中间点偏差有界)
  const raw = SliderPath.computeRawPath(o4!.curveType!, [{ x: o4!.x, y: o4!.y }, ...(o4!.curvePoints ?? [])]);
  assert(distToPath({ x: 300, y: 0 }, raw) < 0.5, 'P→B 路径过末控制点');
  // computeRawPath('P', 4 点) 兜底同样转贝塞尔 (与 'B' 输出一致)
  const pts4 = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 0 }];
  const rawP = SliderPath.computeRawPath('P', pts4);
  const rawB = SliderPath.computeRawPath('B', pts4);
  assert(rawP.length === rawB.length && rawP.every((p, i) => p.x === rawB[i].x && p.y === rawB[i].y),
    "computeRawPath('P', 4 点) 兜底 = 'B' 输出");
}

section('差异2: Catmull 采样密度 50 (lazer catmull_detail)');
{
  const raw = SliderPath.computeRawPath('C', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert(raw.length === 2 * 50 + 1, `2 段 × 50 步 + 末点 = 101 (实际 ${raw.length})`);
}

section('差异4: 末尾重复控制点保留在同一贝塞尔段 (不开启新隐式段)');
{
  // [a,b,c,c] → 三次贝塞尔 [a,b,c,c], 不再降阶为二次 [a,b,c]
  const a = { x: 0, y: 0 }, b = { x: 100, y: 100 }, c = { x: 200, y: 0 };
  const raw = SliderPath.computeRawPath('B', [a, b, c, { ...c }]);
  const deg3 = deCasteljau([a, b, c, { ...c }], 0.85); // (193.59, 5.74)
  const deg2 = deCasteljau([a, b, c], 0.5);           // (100, 50) — 三次曲线 y 上限 300·(1/3)·(2/3)² ≈ 44.4, 距离 ≥5.6 无歧义
  // (不能用 t=0.85 的二次点 (170,25.5) 判别: 两曲线在 t≈0.65 处实际只相距 ~3px)
  assert(distToPath(deg3, raw) < 0.5, `路径经过三次贝塞尔 t=0.85 点 (${deg3.x.toFixed(1)}, ${deg3.y.toFixed(1)})`);
  assert(distToPath(deg2, raw) > 5, `路径不是降阶二次贝塞尔 (t=0.5 点相距 ${distToPath(deg2, raw).toFixed(1)}px)`);
  // 中间重复对分段语义不变: [a,b,b,c] → 段 [a,b] + 段 [b,c]
  const mid = SliderPath.computeRawPath('B', [a, b, { ...b }, c]);
  assert(distToPath(b, mid) < 0.01 && distToPath(deCasteljau([b, c], 0.5), mid) < 0.5, '中间红点对分段不变');
}

section('差异5: >24 控制点贝塞尔走 lazer 剖分 (参数速度剧变不留长弦)');
{
  // 30 点: 前 29 点挤在起点附近 (参数速度剧变), 最后一点拉到远处 — 旧 12n 等参采样在曲率大区留弦
  const pts: Vec2[] = [];
  for (let i = 0; i < 29; i++) pts.push({ x: i * 0.5, y: 0 });
  pts.push({ x: 200, y: 200 });
  const out: Vec2[] = [];
  flattenBezier(pts, out);
  let worst = 0;
  for (let i = 0; i <= 512; i++) worst = Math.max(worst, distToPath(deCasteljau(pts, i / 512), out));
  assert(worst <= 0.7, `30 点参数速度剧变曲线最大弦偏差 ${worst.toFixed(3)}px <= 0.7 (lazer 二阶差容差)`);
}

section('差异6: 圆弧采样密度 / 超大圆弧回退贝塞尔 / 退化回退贝塞尔');
{
  // 四分之一圆 r=100: subPoints = ceil((π/2) / (2·acos(1-0.1/100))) = 18, 径向误差 <=0.1px
  const raw = SliderPath.computeRawPath('P', [{ x: 100, y: 0 }, { x: 70.71067811865476, y: 70.71067811865476 }, { x: 0, y: 100 }]);
  assert(raw.length === 18, `r=100 四分之一圆采样 18 点 (实际 ${raw.length})`);
  let maxRadial = 0;
  for (const p of raw) maxRadial = Math.max(maxRadial, Math.abs(Math.hypot(p.x, p.y) - 100));
  assert(maxRadial <= 0.1, `径向误差 ${maxRadial.toFixed(4)}px <= 0.1`);
  assert(Math.abs(raw[0].x - 100) < 1e-6 && Math.abs(raw[0].y) < 1e-6
    && Math.abs(raw[17].x) < 1e-6 && Math.abs(raw[17].y - 100) < 1e-6, '端点精确 (浮点容差 1e-6)');
  // 超大圆弧 (r=1e6 半圆, subPoints ≈ 3512 >= 1000) → 回退二次贝塞尔: 顶点 (0, 5e5) 而非弧顶 (0, 1e6)
  const huge = SliderPath.computeRawPath('P', [{ x: 1e6, y: 0 }, { x: 0, y: 1e6 }, { x: -1e6, y: 0 }]);
  assert(distToPath({ x: 0, y: 500000 }, huge) < 1, '超大圆弧回退贝塞尔 (过二次贝塞尔顶点 (0,5e5))');
  assert(distToPath({ x: 0, y: 1e6 }, huge) > 1e5, '超大圆弧不再按弧采样 (弧顶 (0,1e6) 远离路径)');
  // 退化 (近共线, cross <= 1e-7) → 贝塞尔 (lazer CircularArcProperties.IsValid=false → BSpline)
  const deg = SliderPath.computeRawPath('P', [{ x: 0, y: 0 }, { x: 100, y: 1e-10 }, { x: 200, y: 0 }]);
  const bez = SliderPath.computeRawPath('B', [{ x: 0, y: 0 }, { x: 100, y: 1e-10 }, { x: 200, y: 0 }]);
  assert(deg.length === bez.length && deg.every((p, i) => p.x === bez[i].x && p.y === bez[i].y), '退化三点 = 贝塞尔输出');
}

section('差异7: 缺失 length 字段用几何全长 (lazer ExpectedDistance=null)');
{
  const noLen = parseHitObjectLine('0,0,1000,2,0,L|100:0,1');
  assert(noLen !== null && noLen.length === 100, `缺失 length → 几何全长 100 (实际 ${noLen?.length})`);
  const zeroLen = parseHitObjectLine('0,0,1000,2,0,L|100:0,1,0');
  assert(zeroLen !== null && zeroLen.length === 100, `length=0 → 几何全长 (lazer: 0 → null) (实际 ${zeroLen?.length})`);
  const expLen = parseHitObjectLine('0,0,1000,2,0,L|100:0,1,250');
  assert(expLen !== null && expLen.length === 250, `显式 length=250 保留 (实际 ${expLen?.length})`);
  // getSliderPath 兜底 (程序化构造无 length 对象): (0,0)-(60,80) 几何全长 100
  const path = getSliderPath(null as never, {
    id: -283001, type: 'slider', x: 0, y: 0, time: 0, hitSound: 0,
    curveType: 'L', curvePoints: [{ x: 60, y: 80 }], slides: 1,
  } as never);
  assert(Math.abs(path.totalLength - 100) < 1e-9, `getSliderPath 无 length → 几何全长 100 (实际 ${path.totalLength})`);
}

if (failures) { console.error(`\nV283_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV283_TESTS_ALL_PASSED');

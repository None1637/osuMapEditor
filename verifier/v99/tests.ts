// 验证器 v99 纯函数测试: flattenBezier (v283 起为 lazer PathApproximator 移植: 全阶数迭代剖分 + 二阶差容差;
//   v99~v282 为混合策略: 小段剖分 + 大段截断 Bernstein 求值)
import { SliderPath, flattenBezier } from '../../src/osu/sliderPath';
import type { Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 参考实现: 任意阶 de Casteljau 密集采样 (与剖分/截断求值结果比对形状)
function deCasteljauRef(pts: Vec2[], t: number): Vec2 {
  let work = pts.map(p => ({ ...p }));
  for (let k = work.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      work[i] = { x: work[i].x + (work[i + 1].x - work[i].x) * t, y: work[i].y + (work[i + 1].y - work[i].y) * t };
    }
  }
  return work[0];
}
// 点 p 到折线 poly 的最短距离
function distToPoly(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}
// 密集采样曲线 (512 点) 到剖分折线的最大偏差
function maxDeviation(ctrl: Vec2[]): number {
  const out: Vec2[] = [];
  flattenBezier(ctrl, out);
  let worst = 0;
  for (let i = 0; i <= 512; i++) {
    worst = Math.max(worst, distToPoly(deCasteljauRef(ctrl, i / 512), out));
  }
  return worst;
}

section('flattenBezier: 形状正确性 (vs 512 点密集 de Casteljau)');
{
  // v283: flattenBezier 改为 lazer PathApproximator.BezierToPiecewiseLinear 移植 (全阶数统一迭代剖分,
  //   二阶差容差 BEZIER_TOLERANCE=0.25) — 光滑曲线偏差仍远小于 0.3px
  assert(maxDeviation([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }]) <= 0.3, '二次贝塞尔');
  assert(maxDeviation([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 0 }]) <= 0.3, '三次 S 形');
  assert(maxDeviation([{ x: 0, y: 0 }, { x: 50, y: 200 }, { x: 150, y: -100 }, { x: 250, y: 200 }, { x: 300, y: 0 }]) <= 0.3, '四次波浪');
  // 直线控制点列 -> 一次平坦判定; v283: lazer bezierApproximate 平坦段输出 n-1 点 (不再只输出两端点),
  //   语义不变: 全部输出点共线且端点精确
  const out: Vec2[] = [];
  flattenBezier([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }], out);
  assert(out.length >= 2 && out.every(p => p.x === p.y) && out[0].x === 0 && out[out.length - 1].x === 100,
    `直线段输出全部共线且端点精确 (实际 ${out.length} 点)`);
  // 端点精确 (剖分首尾即精确端点; 全曲线末点最后统一补)
  const out2: Vec2[] = [];
  flattenBezier([{ x: 10, y: 20 }, { x: 100, y: 200 }, { x: 300, y: 40 }], out2);
  assert(out2[0].x === 10 && out2[0].y === 20, '首端点精确');
  assert(out2[out2.length - 1].x === 300 && out2[out2.length - 1].y === 40, '末端点精确');
  // v283: 大段与小段同走 lazer 剖分 (原 >24 点截断 Bernstein 移除); lazer 二阶差容差 (0.25) 下
  //   60 点正弦与 de Casteljau 参考偏差实测 ~0.6px — 与 lazer 输出一致, 界放宽到 0.7px
  const sine60: Vec2[] = [];
  for (let i = 0; i < 60; i++) sine60.push({ x: 20 + (i * 470) / 59, y: 190 + Math.sin(i / 4) * 120 });
  assert(maxDeviation(sine60) <= 0.7, '60 点正弦 (lazer 二阶差容差剖分精度)');
}

section('flattenBezier: 1000 节点性能 (<50ms, v283 放宽)');
{
  // v283: 算法改为 lazer 移植 (迭代剖分, 成本 O(剖分节点数·n²), 1000 点病态锯齿实测 ~12ms) —
  //   原 <10ms 界随之放宽到 <50ms; 反卡死语义不变 (v99 修复前为数十秒, 仍有 >1000x 余量)
  // zigzag 折线控制多边形: 高阶贝塞尔对其有强阻尼 (曲线塌向中线), 输出点少
  const zig: Vec2[] = [];
  for (let i = 0; i < 1000; i++) zig.push({ x: i % 2 === 0 ? 30 : 480, y: 20 + (i * 340) / 999 });
  const t0 = performance.now();
  const out: Vec2[] = [];
  flattenBezier(zig, out);
  const zigMs = performance.now() - t0;
  console.log(`  zigzag 1000 点: ${zigMs.toFixed(1)}ms, 输出 ${out.length} 点`);
  assert(zigMs < 50, `zigzag <50ms (实际 ${zigMs.toFixed(1)}ms; 旧 de Casteljau 采样约数十秒)`);
  assert(out.length > 100 && out.length < 30000, `输出有界 (实际 ${out.length})`);

  // 光滑正弦波 (典型大滑条形状)
  const sine: Vec2[] = [];
  for (let i = 0; i < 1000; i++) sine.push({ x: 20 + (i * 470) / 999, y: 190 + Math.sin(i / 8) * 150 });
  const t1 = performance.now();
  const outS: Vec2[] = [];
  flattenBezier(sine, outS);
  const sineMs = performance.now() - t1;
  console.log(`  sine 1000 点: ${sineMs.toFixed(1)}ms, 输出 ${outS.length} 点`);
  assert(sineMs < 50, `sine <50ms (实际 ${sineMs.toFixed(1)}ms)`);
  assert(outS.length < 30000, `输出有界 (实际 ${outS.length})`);
}

section('SliderPath 全链路: 1000 节点 B 滑条 (路径+等距重采样 <50ms)');
{
  const zig: Vec2[] = [];
  for (let i = 0; i < 1000; i++) zig.push({ x: i % 2 === 0 ? 30 : 480, y: 20 + (i * 340) / 999 });
  const t0 = performance.now();
  const p = new SliderPath('B', zig, 500);
  const ms = performance.now() - t0;
  console.log(`  SliderPath(B, 1000 控制点, len=500): ${ms.toFixed(1)}ms, 等距点 ${p.points.length}, 全长 ${p.totalLength.toFixed(0)}px`);
  assert(ms < 50, `全链路 <50ms (实际 ${ms.toFixed(1)}ms)`);
  assert(Math.abs(p.totalLength - 500) < 1, 'expectedLength 截断正确');
  // 红点分段: 500 点段 + 红锚点 + 498 点段 (段间重复点对)
  const red: Vec2[] = [];
  for (let i = 0; i < 500; i++) red.push({ x: i % 2 === 0 ? 30 : 480, y: 20 + (i * 170) / 499 });
  red.push({ x: 480, y: 190 }); red.push({ x: 480, y: 190 }); // 红锚点
  for (let i = 0; i < 498; i++) red.push({ x: i % 2 === 0 ? 480 : 30, y: 190 + (i * 170) / 497 });
  const t1 = performance.now();
  const p2 = new SliderPath('B', red, 500);
  const ms2 = performance.now() - t1;
  console.log(`  带红锚点 1000 点: ${ms2.toFixed(1)}ms`);
  assert(ms2 < 10, `带红锚点 <10ms (实际 ${ms2.toFixed(1)}ms)`);
}

if (failures) { console.error(`\nTESTS_V99_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V99_ALL_PASSED');

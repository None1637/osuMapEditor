// 验证器 v74 纯函数测试: 'B4' B 样条滑条 (路径计算 / 类型解析 / 预览 / .osu 读写往返)
import { SliderPath, resolveSliderCurveType, computePendingPath } from '../../src/osu/sliderPath';
import { bSplineToPiecewiseLinear, type Vec } from '../../src/osu/freehand/pathApproximator';
import { parseHitObjectLine, serializeOsu, parseOsu } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function maxDeviation(P: Vec[], Q: Vec[]): number {
  let max = 0;
  for (const p of P) {
    let min = Infinity;
    for (let i = 0; i < Q.length - 1; i++) min = Math.min(min, distToSeg(p, Q[i], Q[i + 1]));
    if (min > max) max = min;
  }
  return max;
}

section("computeRawPath('B4'): clamped degree-4 B 样条, 重复点分段");
{
  // 直线 2 点 => 线性
  const line = SliderPath.computeRawPath('B4', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  assert(line[0].x === 0 && Math.abs(line[line.length - 1].x - 100) < 1e-9 && line.every(p => Math.abs(p.y) < 1e-9), '2 点 => 直线');
  // 8 点段: 与 bSplineToPiecewiseLinear 一致 (同算法), 端点锚定
  const seg = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: i * 50, y: Math.sin(i / 7 * Math.PI * 2) * 60 }));
  const raw = SliderPath.computeRawPath('B4', seg);
  assert(Math.abs(raw[0].x) < 1e-9 && Math.abs(raw[raw.length - 1].x - 350) < 1e-9, '端点锚定');
  const ideal = bSplineToPiecewiseLinear(seg, 4);
  assert(maxDeviation(raw, ideal) < 0.01 && maxDeviation(ideal, raw) < 0.01, '与 bSplineToPiecewiseLinear 一致');
  // 重复点分段: 两段直线 L 形
  const lshape = SliderPath.computeRawPath('B4', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  const corner = lshape.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
  assert(Math.abs(corner.x - 100) < 1 && Math.abs(corner.y - 100) < 1, '红锚点分段 => 过拐角 (100,100)');
  // 不插值中间控制点 (B 样条语义): 单段 3 点不经过中点
  const tri = SliderPath.computeRawPath('B4', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }]);
  const midY = Math.max(...tri.map(p => p.y));
  assert(midY < 60, `二次 B 样条不插值中点 (峰值 ${midY.toFixed(1)} < 60)`);
}

section('resolveSliderCurveType: B4 保持 (红点对仍合法)');
{
  const withRed = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  assert(resolveSliderCurveType(withRed, 'B4') === 'B4', 'B4 + 红点对 => 保持 B4');
  assert(resolveSliderCurveType(withRed, 'B') === 'B', 'B + 红点对 => B (不变)');
  assert(resolveSliderCurveType([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'B4') === 'B4', 'B4 无红点 => 保持');
  assert(resolveSliderCurveType([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], 'P') === 'B', 'P 点数 != 3 => 降级');
}

section('computePendingPath: bspline 标记 => 段按 B4 渲染');
{
  const pend = [0, 1, 2, 3, 4, 5].map(i => ({ x: i * 60, y: Math.sin(i) * 50, bspline: true }));
  const { raw } = computePendingPath(pend, null);
  const ideal = bSplineToPiecewiseLinear(pend, 4);
  assert(maxDeviation(raw, ideal) < 0.01 && maxDeviation(ideal, raw) < 0.01, '6 点段 => B 样条 (非高阶贝塞尔)');
  // 3 点段 bspline => 二次 B 样条 (= 二次贝塞尔), 不再误推断为 'P' 圆弧
  const tri = [{ x: 0, y: 0, bspline: true }, { x: 50, y: 100, bspline: true }, { x: 100, y: 0, bspline: true }];
  const { raw: raw3 } = computePendingPath(tri, null);
  const midY3 = Math.max(...raw3.map(p => p.y));
  assert(midY3 < 60, `3 点段 => 二次贝塞尔 (峰值 ${midY3.toFixed(1)}), 非圆弧 (~75)`);
}

section(".osu 读写: 'B4' 曲线类型往返保留");
{
  const line = '256,192,1000,2,0,B4|300:200|350:240|400:192|450:150,1,300';
  const o = parseHitObjectLine(line);
  assert(o !== null && o.curveType === 'B4' && o.curvePoints!.length === 4, `解析 B4 (实际 ${o?.curveType})`);
  const bmText = `osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle: t\nArtist: a\nCreator: c\nVersion: v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n0,500,4,1,0,80,1,0\n\n[HitObjects]\n${line}\n`;
  const bm = parseOsu(bmText);
  const out = serializeOsu(bm);
  assert(out.includes('B4|300:200|350:240|400:192|450:150'), '序列化保留 B4 与原控制点');
}

if (failures) { console.error(`\nTESTS_V74_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V74_ALL_PASSED');

// v377 纯函数断言: bsplineToStableBezier (B4 -> stable B, 少锚点)
//   双候选 (Schneider 容差拟合 / Boehm 精确) 取锚点少者; 形状偏差 <= ~1.5px; 红锚点分段保留
import { bsplineToStableBezier, bSplineToBezier, BSPLINE_FIT_TOLERANCE } from '@/osu/freehand/pathApproximator';
import { SliderPath, bsplineRawPath } from '@/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }

type P = { x: number; y: number };
const maxDeviation = (a: P[], b: P[]): number => {
  let max = 0;
  for (const p of a) {
    let min = Infinity;
    for (let i = 0; i < b.length - 1; i++) {
      const q = b[i], r = b[i + 1];
      const dx = r.x - q.x, dy = r.y - q.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / L2));
      min = Math.min(min, Math.hypot(p.x - (q.x + t * dx), p.y - (q.y + t * dy)));
    }
    max = Math.max(max, min);
  }
  return max;
};
const dupCount = (pts: P[]): number => { let n = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x === pts[i - 1].x && pts[i].y === pts[i - 1].y) n++; return n; };
const shapeDev = (orig: P[], bez: P[]): number => {
  const rawB4 = bsplineRawPath(orig);
  const rawB = SliderPath.computeRawPath('B', bez);
  return Math.max(maxDeviation(rawB4, rawB), maxDeviation(rawB, rawB4));
};

section('光滑手绘笔迹: 拟合锚点远少于 Boehm 精确转换, 偏差在容差内');
{
  // 模拟真实手绘: 平滑正弦笔迹 24 控制点
  const pts: P[] = [];
  for (let i = 0; i < 24; i++) pts.push({ x: i * 30, y: Math.sin(i / 3) * 60 });
  const bez = bsplineToStableBezier(pts);
  const exact = bSplineToBezier(pts, 4);
  assert(bez.length < exact.length, `拟合锚点 (${bez.length}) < Boehm (${exact.length})`);
  const dev = shapeDev(pts, bez);
  assert(dev <= BSPLINE_FIT_TOLERANCE + 0.6, `形状偏差 ${dev.toFixed(2)}px <= 容差+采样余量`);
  assert(bez[0].x === 0 && Math.abs(bez[0].y) < 1e-9, '首点锚定');
  assert(Math.abs(bez[bez.length - 1].x - 690) < 1e-6, '末点锚定');
}

section('退化 <=5 点: 精确单条 Bezier (0 误差, 无红锚点)');
{
  const pts: P[] = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: -30 }, { x: 200, y: 40 }];
  const bez = bsplineToStableBezier(pts);
  assert(bez.length === 4 && dupCount(bez) === 0, `4 点 => 单条 Bezier 4 锚点无重复 (实际 ${bez.length} 点 ${dupCount(bez)} 重复)`);
  assert(shapeDev(pts, bez) < 0.01, `退化转换零误差 (实际 ${shapeDev(pts, bez).toFixed(4)}px)`);
}

section('高抖动锯齿: 取锚点少者 (Boehm 精确), 形状零误差');
{
  const pts: P[] = [{ x: 0, y: 0 }, { x: 60, y: 90 }, { x: 140, y: -40 }, { x: 220, y: 60 }, { x: 300, y: -20 }, { x: 380, y: 80 }, { x: 460, y: 10 }, { x: 540, y: 50 }];
  const bez = bsplineToStableBezier(pts);
  const exact = bSplineToBezier(pts, 4);
  assert(bez.length <= exact.length, `锚点 (${bez.length}) <= Boehm (${exact.length})`);
  assert(shapeDev(pts, bez) < 0.01, `精确路径零误差 (实际 ${shapeDev(pts, bez).toFixed(4)}px)`);
}

section('原红锚点分段保留');
{
  const pts: P[] = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 }, { x: 200, y: 0 },
    { x: 200, y: 0 }, // 红锚点
    { x: 250, y: 60 }, { x: 300, y: -20 }, { x: 350, y: 40 }, { x: 400, y: 0 }];
  const bez = bsplineToStableBezier(pts);
  assert(shapeDev(pts, bez) <= BSPLINE_FIT_TOLERANCE + 0.6, `带红锚点转换形状偏差 ${shapeDev(pts, bez).toFixed(2)}px 在容差内`);
  let found = false;
  for (let i = 1; i < bez.length; i++) if (Math.abs(bez[i].x - 200) < 1 && Math.abs(bez[i].y) < 1 && bez[i].x === bez[i - 1].x && bez[i].y === bez[i - 1].y) found = true;
  assert(found, '红锚点 (200,0) 在转换结果中仍为重复点 (拐角保留)');
}

section('渲染层 B4 移除后 computeRawPath 不再识别 B4');
{
  // 'B4' 落到 default bezier 分支 (内存不应再出现 B4; 万一出现按普通贝塞尔渲染, 不再按 B 样条)
  const pts: P[] = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: -30 }, { x: 200, y: 40 }];
  const a = SliderPath.computeRawPath('B4', pts);
  const b = SliderPath.computeRawPath('B', pts);
  assert(a.length === b.length && maxDeviation(a, b) < 1e-9, "'B4' 与 'B' 同分支 (B 样条渲染支持已移除)");
}

if (failures) { console.error(`V377_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V377_TESTS_ALL_PASSED');

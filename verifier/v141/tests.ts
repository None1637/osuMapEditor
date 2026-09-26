// 验证器 v141: 三点圆弧(P)→贝塞尔(B) 滑条转换 — 纯函数语义 (复用 bezierPath 的 sliderToBezierSegments/segmentsToPoints)
import { sliderToBezierSegments, segmentsToPoints } from '../../src/osu/convert/bezierPath';
import { SliderPath, sliderGeometryLength } from '../../src/osu/sliderPath';
import type { HitObject, Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const slider = (id: number, curveType: string, x: number, y: number, cps: Vec2[], extra?: Partial<HitObject>): HitObject =>
  ({ id, type: 'slider', x, y, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0, curveType, curvePoints: cps, slides: 1, length: 300, ...extra });

// 与 Inspector.tsx onP2B 完全同款的构造逻辑
const p2b = (o: HitObject): HitObject | null => {
  const segs = sliderToBezierSegments(o);
  if (!segs.length) return null;
  const pts = segmentsToPoints(segs); // 含头部 = 首段首点; 段接缝重复点 (红锚点)
  return { ...o, id: o.id + 1000, curveType: 'B', curvePoints: pts.slice(1) };
};

/** 两条路径在共同弧长范围内等距采样比较, 返回最大偏差 */
function maxPathDev(a: SliderPath, b: SliderPath, step = 2): number {
  const L = Math.min(a.totalLength, b.totalLength);
  let max = 0;
  for (let d = 0; d <= L; d += step) {
    const pa = a.positionAt(d), pb = b.positionAt(d);
    max = Math.max(max, Math.hypot(pa.x - pb.x, pa.y - pb.y));
  }
  return max;
}
/** 点到路径折线的最小距离 */
function distToPath(p: Vec2, path: SliderPath): number {
  let min = Infinity;
  for (const q of path.points) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
  return min;
}
const hasDupPair = (pts: Vec2[], x: number, y: number) =>
  pts.some((p, i) => i > 0 && Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6
    && Math.abs(pts[i - 1].x - x) < 1e-6 && Math.abs(pts[i - 1].y - y) < 1e-6);
// v148 适配: 原用哨兵 expectedLength=100000 取全几何; SliderPath 现有末端延长语义 (lazer calculateLength),
// 超长 expected 会线性延长, 改用 sliderGeometryLength 作为 expected (不截短不延长)
const pathOf = (o: HitObject) => {
  const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  return new SliderPath(o.curveType ?? 'L', pts, sliderGeometryLength(o.curveType ?? 'L', pts));
};

section('P->B: 三点圆弧转贝塞尔 (形状近似 <0.5px, 端点不变)');
{
  const p = slider(1, 'P', 100, 100, [{ x: 200, y: 40 }, { x: 300, y: 100 }]);
  const r = p2b(p)!;
  assert(!!r && r.curveType === 'B', "输出 curveType 'B'");
  assert(r.x === 100 && r.y === 100 && r.time === 2000, 'head/时间不变');
  const pts: Vec2[] = [{ x: r.x, y: r.y }, ...r.curvePoints!];
  assert(Math.abs(pts[pts.length - 1].x - 300) < 1e-6 && Math.abs(pts[pts.length - 1].y - 100) < 1e-6, '尾点不变');
  const dev = maxPathDev(pathOf(p), pathOf(r));
  assert(dev < 0.5, `转换前后路径采样最大偏差 ${dev.toFixed(4)}px < 0.5px (圆弧贝塞尔近似)`);
  assert(distToPath({ x: 200, y: 40 }, pathOf(r)) < 1, '转换后路径经过原弧中间点 (200,40)');
}

section('P->B: 多点弧 (5 点 = 两段) 段接缝写重复点 (红锚点)');
{
  const p = slider(2, 'P', 100, 100, [{ x: 150, y: 60 }, { x: 200, y: 100 }, { x: 250, y: 140 }, { x: 300, y: 100 }]);
  const r = p2b(p)!;
  const pts: Vec2[] = [{ x: r.x, y: r.y }, ...r.curvePoints!];
  assert(hasDupPair(pts, 200, 100), '两段弧接缝 (200,100) 重复对保留为红锚点');
  // v283 适配: computeRawPath('P', ≠3点) 已改 lazer 语义 (兜底贝塞尔), 参考路径改为显式两段三点弧拼接
  const srcPts: Vec2[] = [{ x: p.x, y: p.y }, ...p.curvePoints!];
  const arc1 = new SliderPath('P', srcPts.slice(0, 3), sliderGeometryLength('P', srcPts.slice(0, 3)));
  const arc2 = new SliderPath('P', srcPts.slice(2, 5), sliderGeometryLength('P', srcPts.slice(2, 5)));
  const twoArc = {
    totalLength: arc1.totalLength + arc2.totalLength,
    positionAt: (d: number) => (d <= arc1.totalLength ? arc1.positionAt(d) : arc2.positionAt(d - arc1.totalLength)),
  } as unknown as SliderPath;
  const dev = maxPathDev(twoArc, pathOf(r));
  assert(dev < 0.5, `两段弧转换路径偏差 ${dev.toFixed(4)}px < 0.5px`);
}

section('P->B: 退化 (2 点) 转直线 + 字段原样保留 + 纯函数');
{
  const p = slider(3, 'P', 100, 100, [{ x: 300, y: 200 }], {
    hitSound: 10, newCombo: true, comboSkip: 2, slides: 2, length: 321,
    edgeSoundsRaw: '0|2|4', edgeSetsRaw: '0:0|1:0|2:0', hitSampleRaw: '1:2:0:80:',
  });
  const r = p2b(p)!;
  assert(r.curvePoints!.length === 1, `2 点退化 -> 单条直线段 (实际 ${r.curvePoints!.length + 1} 点含头)`);
  assert(r.curvePoints![0].x === 300 && r.curvePoints![0].y === 200, '直线段尾点 = 原尾点 (形状即直线)');
  const rp = pathOf(r);
  assert(Math.abs(rp.totalLength - Math.hypot(200, 100)) < 1, `转换后路径为直线 (全长 ${rp.totalLength.toFixed(2)} ≈ 223.61)`);
  assert(r.hitSound === 10 && r.newCombo === true && r.comboSkip === 2, 'hitSound/newCombo/comboSkip 保留');
  assert(r.edgeSoundsRaw === '0|2|4' && r.edgeSetsRaw === '0:0|1:0|2:0' && r.hitSampleRaw === '1:2:0:80:', 'edgeSounds/edgeSets/hitSample 保留');
  assert(r.slides === 2 && r.length === 321 && r.time === 2000, 'slides/length/time 保留');
  assert(r.id !== p.id, '新物件 id 重新生成');
  assert(p.curveType === 'P' && p.curvePoints!.length === 1, '原物件不被修改 (纯函数)');
}

if (failures) { console.error(`\nV141_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV141_TESTS_ALL_PASSED');

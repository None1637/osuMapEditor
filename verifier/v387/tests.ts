// v387 纯函数断言: 手绘滑条全面对齐 lazer — B4 恢复为一等 curveType
//   1) parseBSplineType / computeRawPath 'B<n>' 分支 (Boehm 折线 = bsplineRawPath);
//   2) Boehm 往返形状一致 (bSplineToBezierSegments 展开后折线 ≡ 原 B 样条折线);
//   3) resolveSliderCurveType 保持 B4 (编辑锚点不冲掉类型);
//   4) parser 读入保留 B4 + 段内类型字母 token 容错 + 序列化原样写回;
//   5) convertB4: 全图 B4 -> stable 'B' (双候选少锚点, 形状偏差 <= ~1.5px), countBSplineSliders;
//   6) IncrementalBSplineBuilder 冒烟 (合成笔迹 => 控制点远少于采样点)。
import { bSplineToBezierSegments, bSplineToPiecewiseLinear, BSPLINE_FIT_TOLERANCE } from '@/osu/freehand/pathApproximator';
import { IncrementalBSplineBuilder } from '@/osu/freehand/bsplineBuilder';
import { SliderPath, bsplineRawPath, parseBSplineType, resolveSliderCurveType, sliderGeometryLength } from '@/osu/sliderPath';
import { parseHitObjectLine, serializeHitObjectLine, type Beatmap } from '@/osu/parser';
import { countBSplineSliders, convertBSplineSlidersToBezier } from '@/osu/convert/convertB4';

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

section('parseBSplineType');
{
  assert(parseBSplineType('B4') === 4 && parseBSplineType('B3') === 3 && parseBSplineType('B12') === 12, 'B<n> => degree');
  assert(parseBSplineType('B') === null && parseBSplineType('L') === null && parseBSplineType('P') === null && parseBSplineType(undefined) === null, '非 B<n> => null');
}

section('computeRawPath: B4 分支 ≡ bsplineRawPath (红点分段 Boehm 折线)');
{
  const pts: P[] = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: -30 }, { x: 200, y: 40 },
    { x: 200, y: 40 }, // 红锚点
    { x: 260, y: 90 }, { x: 330, y: -10 }, { x: 400, y: 30 }];
  const a = SliderPath.computeRawPath('B4', pts);
  const b = bsplineRawPath(pts, 4);
  assert(a.length === b.length && maxDeviation(a, b) < 1e-9, 'computeRawPath B4 ≡ bsplineRawPath');
  assert(a.length > 10, `B4 折线正常细分 (${a.length} 点)`);
  assert(sliderGeometryLength('B4', pts) > 300, 'sliderGeometryLength 支持 B4');
  // 与 'B' (普通贝塞尔) 形状不同 — 确认走的不是 default 分支 (需 >=6 点单段, 否则 B 样条退化为同一条贝塞尔)
  const pts2: P[] = [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 110, y: -20 }, { x: 180, y: 50 }, { x: 250, y: 0 }, { x: 320, y: 60 }, { x: 390, y: 10 }];
  const a2 = SliderPath.computeRawPath('B4', pts2);
  const asB = SliderPath.computeRawPath('B', pts2);
  assert(maxDeviation(a2, asB) > 0.5, 'B4 与 B 确为不同曲线 (非 default 分支)');
}

section('Boehm 往返: bSplineToBezierSegments 展开折线 ≡ 原 B 样条折线');
{
  const cps: P[] = [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 110, y: -20 }, { x: 180, y: 50 }, { x: 250, y: 0 }, { x: 320, y: 60 }, { x: 390, y: 10 }];
  const segs = bSplineToBezierSegments(cps, 4);
  assert(segs.length === cps.length - 4, `7 控制点 degree4 => ${cps.length - 4} 段 (实际 ${segs.length})`);
  for (const s of segs) assert(s.length === 5, '每段 degree+1=5 个贝塞尔控制点');
  // 各贝塞尔段折线化 (degree >= n-1 => bSplineToPiecewiseLinear 退化为单条贝塞尔求值) 拼接, 与原 B 样条折线比较
  const segLinear: P[] = [];
  for (const s of segs) {
    const pl = bSplineToPiecewiseLinear(s, 99);
    for (let i = 0; i < pl.length; i++) { if (segLinear.length && i === 0) continue; segLinear.push(pl[i]); }
  }
  const d = maxDeviation(segLinear, bSplineToPiecewiseLinear(cps, 4));
  assert(d < 0.01, `Boehm 精确转换形状零误差 (实际 ${d.toFixed(4)}px)`);
}

section('resolveSliderCurveType: B4 编辑保持 (v387 恢复)');
{
  const withRed: P[] = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  assert(resolveSliderCurveType(withRed, 'B4') === 'B4', "'B4' + 红点对 => 保持 'B4'");
  assert(resolveSliderCurveType(withRed, 'B') === 'B', "'B' + 红点对 => 'B'");
  assert(resolveSliderCurveType([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'B4') === 'B4', "'B4' 无红点 => 保持");
}

section('parser: B4 读入保留 + 段内字母容错 + 序列化原样写回');
{
  const o = parseHitObjectLine('256,192,1000,2,0,B4|300:200|350:240|400:192|450:150,1,300');
  assert(o !== null && o.curveType === 'B4' && o.curvePoints!.length === 4, `读入 B4 原样保留 (实际 ${o?.curveType} ${o?.curvePoints?.length} 点)`);
  const out = serializeHitObjectLine(o!);
  assert(out.includes(',B4|300:200|350:240|400:192|450:150,'), `序列化写回 B4 (${out})`);
  // lazer v128 段内类型字母 token (无 ':') 跳过不炸
  const o2 = parseHitObjectLine('256,192,1000,2,0,B4|300:200|P|350:240|400:192,1,300');
  assert(o2 !== null && o2.curveType === 'B4' && o2.curvePoints!.length === 3
    && o2.curvePoints!.every(p => isFinite(p.x) && isFinite(p.y)), '段内字母 token 容错跳过 (3 点无 NaN)');
}

section('convertB4: 全图 B4 -> stable B (形状 <= ~1.5px, 计数正确)');
{
  const mkSlider = (id: number): import('@/osu/parser').HitObject => ({
    id, type: 'slider', x: 0, y: 0, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0,
    curveType: 'B4', slides: 1, length: 500,
    curvePoints: [{ x: 50, y: 80 }, { x: 120, y: -30 }, { x: 200, y: 40 }, { x: 200, y: 40 }, { x: 260, y: 90 }, { x: 330, y: -10 }, { x: 400, y: 30 }],
  });
  const bm = { hitObjects: [mkSlider(1), { id: 2, type: 'circle', x: 0, y: 0, time: 0, hitSound: 0, newCombo: false, comboSkip: 0 }] } as unknown as Beatmap;
  assert(countBSplineSliders(bm) === 1, 'countBSplineSliders = 1');
  const orig = SliderPath.computeRawPath('B4', [{ x: 0, y: 0 }, ...(bm.hitObjects[0].curvePoints ?? [])]);
  const n = convertBSplineSlidersToBezier(bm);
  assert(n === 1 && bm.hitObjects[0].curveType === 'B' && countBSplineSliders(bm) === 0, '转换 1 条, 类型 => B, 计数归零');
  const conv = SliderPath.computeRawPath('B', [{ x: 0, y: 0 }, ...(bm.hitObjects[0].curvePoints ?? [])]);
  const dev = Math.max(maxDeviation(orig, conv), maxDeviation(conv, orig));
  assert(dev <= BSPLINE_FIT_TOLERANCE + 0.6 + 0.5, `转换形状偏差 ${dev.toFixed(2)}px (容差+取整+采样余量)`);
  assert(bm.hitObjects[0].curvePoints!.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)), '转换后锚点取整 (lazer 导出口径)');
}

section('IncrementalBSplineBuilder 冒烟 (lazer 参数 4/1.8/0.4): 光滑笔迹控制点远少于输入');
{
  const b = new IncrementalBSplineBuilder(4, 1.8, 0.4);
  const N = 300;
  for (let i = 0; i < N; i++) b.addLinearPoint({ x: i * 2, y: Math.sin(i / 25) * 80 });
  b.finish();
  const segs = b.getControlPoints();
  const total = segs.reduce((acc, s) => acc + s.length, 0);
  assert(segs.length >= 1 && total > 0, `产出 ${segs.length} 段 ${total} 控制点`);
  assert(total < N / 3, `控制点 (${total}) 远少于输入采样 (${N})`);
}

if (failures) { console.error(`V387_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V387_TESTS_ALL_PASSED');

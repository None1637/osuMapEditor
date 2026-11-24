import { bsplineToStableBezier, bSplineToPiecewiseLinear } from '../../src/osu/freehand/pathApproximator';
import { convertBSplineSlidersToBezier, B4_CONVERT_FIT_TOLERANCE, setB4ConvertFitTolerance } from '../../src/osu/convert/convertB4';
import { SliderPath } from '../../src/osu/sliderPath';
import type { Beatmap, Vec2 } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const pts: Vec2[] = Array.from({ length: 24 }, (_, i) => ({ x: i * 20, y: Math.sin(i / 3) * 80 }));
const before = bsplineToStableBezier(pts, 4, 1);
const after = bsplineToStableBezier(pts, 4, 4);
ok(after.length < before.length, `平滑 B4 节点减少: 1px=${before.length}, 4px=${after.length}`);
ok(after[0].x === pts[0].x && after[after.length - 1].x === pts[pts.length - 1].x, '首尾控制点保持');

setB4ConvertFitTolerance(4); // v586 场景显式使用 4px; v590 默认恢复 1px
const bm = { hitObjects: [{ id: 1, type: 'slider', x: pts[0].x, y: pts[0].y, time: 0, curveType: 'B4', curvePoints: pts.slice(1), slides: 1, length: 500 }] } as unknown as Beatmap;
ok(convertBSplineSlidersToBezier(bm) === 1 && bm.hitObjects[0].curveType === 'B', 'convertB4 应用新容差并转为 B');
ok((bm.hitObjects[0].curvePoints?.length ?? 0) + 1 <= after.length, '全图转换节点数不超过 4px 拟合 (v588 高阶整体拟合)');
const orig = bSplineToPiecewiseLinear(pts, 4);
const conv = SliderPath.computeRawPath('B', [{ x: bm.hitObjects[0].x, y: bm.hitObjects[0].y }, ...(bm.hitObjects[0].curvePoints ?? [])]);
let max = 0;
for (const p of orig) {
  let best = Infinity;
  for (let i = 0; i < conv.length - 1; i++) {
    const a = conv[i], b = conv[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  max = Math.max(max, best);
}
ok(max <= 4 + 1.1, `取整/采样后最大偏差 ${max.toFixed(2)}px ≤ 5.1px`);
setB4ConvertFitTolerance(B4_CONVERT_FIT_TOLERANCE);
if (failures) process.exit(1);
console.log('V586_TESTS_PASSED');

import { computeSymSlider, DEFAULT_SYM_SLIDER_PARAMS, type SymSliderParams } from '../../src/osu/convert/symSlider';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = {} as Beatmap;
const params = (patch: Partial<SymSliderParams>): SymSliderParams => ({ ...DEFAULT_SYM_SLIDER_PARAMS, ...patch });
const src: HitObject = {
  id: 12345, type: 'slider', x: 100, y: 100, time: 1000, endTime: 2000,
  curveType: 'P', curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 200 }], slides: 1, length: 150, hitSound: 0,
};
const nodeCount = (o: HitObject) => (o.curvePoints?.length ?? 0) + 1;

{
  const p = params({ mode: 'point', join: 'tail' });
  const preview = computeSymSlider(bm, src, p, true);
  assert(preview.length === 2, '拼接预览显示原弧与对称弧两条独立对象');
  assert(preview.every(o => o.curveType === 'P' && nodeCount(o) === 3), '预览每条都保留三点圆弧, 不提前转 B');
  assert(preview[0].id === src.id && preview[0].x === 100 && preview[0].curvePoints![0].x === 200, '原弧 id/锚点保留, 可继续编辑');
  const applied = computeSymSlider(bm, src, p);
  assert(applied.length === 1 && applied[0].curveType === 'B', '最终应用仍转换为 B 后拼接');
  assert((applied[0].curvePoints?.length ?? 0) > 2, '应用结果包含转换后的完整拼接控制点');
}

{
  const p = params({ mode: 'translate', join: 'none', dx: 120, dy: 40, count: 1 });
  const preview = computeSymSlider(bm, src, p, true);
  assert(preview.length === 2 && preview[0].id === src.id, '独立副本预览也保留可编辑原弧');
  assert(preview.every(o => o.curveType === 'P' && nodeCount(o) === 3), '独立副本与原弧均为三点 P');
  const applied = computeSymSlider(bm, src, p);
  assert(applied.length === 1 && applied[0].id !== src.id && applied[0].curveType === 'P', '应用独立副本仍只新增一个 P 副本');
}

if (failures) { console.error(`V581_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V581_TESTS_PASSED');

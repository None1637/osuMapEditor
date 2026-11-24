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
{
  const p = params({ mode: 'point', join: 'tail' });
  const preview = computeSymSlider(bm, src, p);
  assert(preview.length === 1 && preview[0].curveType === 'B', 'v595: 拼接预览直接是最终单条 B 滑条');
  assert((preview[0].curvePoints?.length ?? 0) > 2, '预览包含应用时的完整拼接控制点');
  assert(src.curveType === 'P' && (src.curvePoints?.length ?? 0) === 2, '原三点 P 对象不被转换, 锚点仍可编辑');
}

{
  const p = params({ mode: 'translate', join: 'none', dx: 120, dy: 40, count: 1 });
  const preview = computeSymSlider(bm, src, p);
  assert(preview.length === 1 && preview[0].id !== src.id && preview[0].curveType === 'P', '独立副本预览仍是最终新增 P 副本');
  assert((preview[0].curvePoints?.length ?? 0) === 2, '独立副本保留三点圆弧');
}

if (failures) { console.error(`V581_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V581_TESTS_PASSED');

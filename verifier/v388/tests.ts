// v388 纯函数断言: 选中集 B4 -> 贝塞尔转换的 onlyIds 过滤
// (滚轮调值为 DOM 接线逻辑, 由 check.mjs 源码断言覆盖)
import { countBSplineSliders, convertBSplineSlidersToBezier } from '@/osu/convert/convertB4';
import type { Beatmap, HitObject } from '@/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }

section('convertBSplineSlidersToBezier: onlyIds 只转选中集');
{
  const mkSlider = (id: number): HitObject => ({
    id, type: 'slider', x: 0, y: 0, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0,
    curveType: 'B4', slides: 1, length: 500,
    curvePoints: [{ x: 50, y: 80 }, { x: 120, y: -30 }, { x: 200, y: 40 }, { x: 260, y: 90 }, { x: 330, y: -10 }],
  });
  const bm = { hitObjects: [mkSlider(1), mkSlider(2), mkSlider(3)] } as unknown as Beatmap;
  assert(countBSplineSliders(bm) === 3, '前置: 3 条 B4');
  const n = convertBSplineSlidersToBezier(bm, new Set([1, 3]));
  assert(n === 2, `只转选中的 2 条 (实际 ${n})`);
  assert(bm.hitObjects[0].curveType === 'B' && bm.hitObjects[2].curveType === 'B', 'id 1/3 => B');
  assert(bm.hitObjects[1].curveType === 'B4', 'id 2 未选中 => 保持 B4');
  assert(countBSplineSliders(bm) === 1, '剩余 B4 = 1');
  // 空选中集 = 不动作
  const n2 = convertBSplineSlidersToBezier(bm, new Set());
  assert(n2 === 0 && bm.hitObjects[1].curveType === 'B4', '空选中集不动作');
  // 缺省 = 全图 (v387 行为不变)
  const n3 = convertBSplineSlidersToBezier(bm);
  assert(n3 === 1 && countBSplineSliders(bm) === 0, '缺省 onlyIds = 全图转换 (v387 兼容)');
}

if (failures) { console.error(`V388_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V388_TESTS_ALL_PASSED');

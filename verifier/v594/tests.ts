import { computeSymSlider, DEFAULT_SYM_SLIDER_PARAMS } from '../../src/osu/convert/symSlider';
import { computeMerge } from '../../src/osu/convert/merge';
import { getSliderPath, sliderGeometryLength } from '../../src/osu/sliderPath';
import { measureSegments } from '../../src/osu/convert/bezierPath';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = { timingPoints: [{ time: 0, beatLength: 500, uninherited: true }], difficulty: { sliderMultiplier: 1 }, editor: { beatDivisor: 1 } } as unknown as Beatmap;
const arc: HitObject = {
  id: 1, type: 'slider', x: 0, y: 0, time: 1000, endTime: 2000,
  curveType: 'P', curvePoints: [{ x: 100, y: 100 }, { x: 200, y: 0 }], slides: 1, length: 50,
};
const preview = computeSymSlider(bm, arc, { ...DEFAULT_SYM_SLIDER_PARAMS, mode: 'point', join: 'tail' }, true);
const actualTail = getSliderPath(bm, arc).positionAt(50);
ok(preview.length === 2 && preview[0].curveType === 'P' && preview[1].curveType === 'P', '对称预览仍保留三点圆弧');
ok(Math.hypot(preview[1].x - actualTail.x, preview[1].y - actualTail.y) <= 1,
  `对称副本首点接实际滑条尾 (${preview[1].x},${preview[1].y})`);

const short: HitObject = { id: 2, type: 'slider', x: 100, y: 0, time: 2000, curveType: 'L', curvePoints: [{ x: 300, y: 0 }], slides: 1, length: 50 };
const circle: HitObject = { id: 3, type: 'circle', x: 0, y: 0, time: 1000 };
const merged = computeMerge(bm, [short, circle])!;
const measured = measureSegments([...Array.from({ length: 2 }, (_, i) => i === 0 ? [{ x: 0, y: 0 }, { x: 100, y: 0 }] : [{ x: 100, y: 0 }, { x: 150, y: 0 }])]).total;
ok(merged.length === 150 && measured === 150, `合并长度按实际几何保留 150, 不再吸附 (${merged.length})`);
ok(sliderGeometryLength(merged.curveType ?? 'B', [{ x: merged.x, y: merged.y }, ...(merged.curvePoints ?? [])]) === 150, '合并路径长度与写入长度一致');
console.log(failures ? 'V594_TESTS_FAILED' : 'V594_TESTS_PASSED');
if (failures) process.exit(1);

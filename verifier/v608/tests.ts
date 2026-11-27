import { computePolygon, DEFAULT_POLYGON_PARAMS } from '../../src/osu/convert/polygon';
import type { Beatmap } from '../../src/osu/parser';
let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  difficulty: { sliderMultiplier: 1 }, editor: { beatDivisor: 1 }, hitObjects: [],
} as unknown as Beatmap;
const r = computePolygon(bm, 0, 1, { ...DEFAULT_POLYGON_PARAMS, vertices: 7, repeats: 1, distanceSnap: 1, star: true, starStep: 2 });
const outerR = 100 / (2 * Math.sin(Math.PI / 7));
ok(r.objects.length === 7, '隔点数 2 时仍生成 7 个外圈顶点');
const expectedAngle = 6 * 2 * Math.PI / 7;
const expectedX = Math.round(256 + outerR * Math.cos(expectedAngle));
const expectedY = Math.round(192 + outerR * Math.sin(expectedAngle));
ok(r.objects[1].x === expectedX && r.objects[1].y === expectedY,
  `第二个顶点按 6 倍角步进 (实际 ${r.objects[1].x},${r.objects[1].y}; 期望 ${expectedX},${expectedY})`);
ok(r.objects[0].time === 0 && r.objects[1].time === 500, '隔点数改变不影响节拍推进');
const defaultStep = computePolygon(bm, 0, 1, { ...DEFAULT_POLYGON_PARAMS, vertices: 7, repeats: 1, distanceSnap: 1, star: true });
ok(defaultStep.objects[1].x === Math.round(256 + outerR * Math.cos(4 * 2 * Math.PI / 7))
  && defaultStep.objects[1].y === Math.round(192 + outerR * Math.sin(4 * 2 * Math.PI / 7)), '默认隔点数 1 保持原行为');
console.log(failures ? 'V608_TESTS_FAILED' : 'V608_TESTS_PASSED');
if (failures) process.exit(1);

import { computePolygon, DEFAULT_POLYGON_PARAMS } from '../../src/osu/convert/polygon';
import type { Beatmap } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  difficulty: { sliderMultiplier: 1 }, editor: { beatDivisor: 1 }, hitObjects: [],
} as unknown as Beatmap;
const r = computePolygon(bm, 0, 1, { ...DEFAULT_POLYGON_PARAMS, vertices: 7, repeats: 1, distanceSnap: 1, star: true });
ok(r.objects.length === 7, `7 角星共 7 个外圈顶点 (实际 ${r.objects.length})`);
const outerR = 100 / (2 * Math.sin(Math.PI / 7));
ok(r.objects.every(o => Math.abs(Math.hypot(o.x - 256, o.y - 192) - outerR) < 0.5), '所有顶点均为同一外圈半径, 无内圈');
ok(r.objects[1].x !== r.objects[0].x || r.objects[1].y !== r.objects[0].y, '星形模式按跨点顺序排列而非普通多边形');
ok(r.objects[0].time === 0 && r.objects[1].time === 500 && r.objects[2].time === 1000, '外圈顶点仍按节拍连续推进');
console.log(failures ? 'V592_TESTS_FAILED' : 'V592_TESTS_PASSED');
if (failures) process.exit(1);

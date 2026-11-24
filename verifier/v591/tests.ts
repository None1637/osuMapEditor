import { computePolygon, DEFAULT_POLYGON_PARAMS } from '../../src/osu/convert/polygon';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const red = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 };
const green = (time: number, sv: number) => ({ time, beatLength: -100 / sv, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: false, effects: 0 });
const slider = (id: number, time: number, length = 100): HitObject => ({ id, type: 'slider', x: 0, y: 0, time, curveType: 'L', curvePoints: [{ x: 100, y: 0 }], slides: 1, length });
const bm = {
  timingPoints: [red, green(0, 2), green(1000, 0.5)],
  difficulty: { sliderMultiplier: 1 }, editor: { beatDivisor: 1 },
  hitObjects: [slider(1, 0), slider(2, 1000)],
} as unknown as Beatmap;
const r = computePolygon(bm, 1500, 1, { ...DEFAULT_POLYGON_PARAMS, vertices: 4, repeats: 1, distanceSnap: 1 });
const first = r.objects[0];
const dx = first.x - 256, dy = first.y - 192;
const chord = Math.hypot(first.x - r.objects[1].x, first.y - r.objects[1].y);
ok(Math.abs(chord - 200) <= 1, `参考前一已结束滑条 SV=2, 弦长应约 200 而非 50 (实际 ${chord.toFixed(2)})`);
ok(Math.abs(Math.hypot(dx, dy) - 200 / (2 * Math.sin(Math.PI / 4))) <= 1, '半径与锁定间距 1x 同单位');
console.log(failures ? 'V591_TESTS_FAILED' : 'V591_TESTS_PASSED');
if (failures) process.exit(1);

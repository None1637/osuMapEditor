import { lockDistanceAfterTransform } from '../../src/osu/spacing';
import { flipObjects, rotateObjects } from '../../src/osu/transform';
import { reverseSelection } from '../../src/osu/reverse';
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const circle = (id: number, x: number, y: number, time: number): HitObject => ({ id, type: 'circle', x, y, time, hitSound: 0 });
const makeBm = (selected: HitObject[]): Beatmap => ({
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 }, editor: { distanceSpacing: 1, beatDivisor: 4 },
  hitObjects: [circle(1, 100, 100, 0), ...selected],
} as unknown as Beatmap);

{
  const sel = [circle(2, 200, 100, 500)];
  const bm = makeBm(sel);
  flipObjects(sel, { x: 256, y: 192 }, 'h');
  ok(sel[0].x === 312, `镜像先改变位置 (${sel[0].x})`);
  lockDistanceAfterTransform(bm, sel);
  ok(sel[0].x === 200 && sel[0].y === 100, `镜像后恢复与前件 100px 间距 (${sel[0].x},${sel[0].y})`);
}
{
  const sel = [circle(2, 200, 100, 500)];
  const bm = makeBm(sel);
  rotateObjects(sel, { x: 256, y: 192 }, 90);
  lockDistanceAfterTransform(bm, sel);
  const d = Math.hypot(sel[0].x - 100, sel[0].y - 100);
  ok(Math.abs(d - 100) <= 1, `旋转后首件与前件仍保持约 100px 间距 (实际 ${d})`);
}
{
  const sel = [circle(2, 200, 100, 500), circle(3, 250, 100, 1000)];
  const bm = makeBm(sel);
  reverseSelection(bm, sel);
  lockDistanceAfterTransform(bm, sel);
  const first = [...sel].sort((a, b) => a.time - b.time)[0];
  ok(first.id === 3 && first.x === 200, `反转后按新时间首件恢复间距 (id=${first.id}, x=${first.x})`);
  ok(sel.find(o => o.id === 2)!.x === 150, '其他选中物件按相同 delta 平移');
}
{
  const sel = [circle(2, 200, 100, 500), circle(3, 250, 100, 1000)];
  const bm = makeBm(sel);
  flipObjects(sel, { x: 256, y: 192 }, 'h');
  const dx = sel[1].x - sel[0].x, dy = sel[1].y - sel[0].y;
  lockDistanceAfterTransform(bm, sel);
  ok(sel[1].x - sel[0].x === dx && sel[1].y - sel[0].y === dy, '整体平移校正不改变选区形状');
}
{
  const sel = [circle(2, 200, 100, 500)];
  const bm = makeBm(sel);
  store.beatmap = bm;
  store.selected = new Set([2]);
  store.distanceLock = true;
  store.lockNotes = false;
  store.flipSelected('h', 'playfield');
  ok(sel[0].x === 200, `store.flipSelected 应用后自动恢复间距 (${sel[0].x})`);
  store.selected = new Set([2]);
  store.reverseSelected();
  ok(sel[0].x === 200, `store.reverseSelected 同样校正 (${sel[0].x})`);
  store.distanceLock = false;
  store.beatmap = null;
  store.selected.clear();
}

if (failures) { console.error(`V583_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V583_TESTS_PASSED');

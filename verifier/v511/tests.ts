// v511: Selection Centre = 点集质心；等边三角形绕中心 120° 顶点集合不变
import { store } from '../../src/osu/store';
import { selectionCenter, rotateObjects } from '../../src/osu/transform';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }
const circle = (id: number, x: number, y: number): HitObject => ({ id, type: 'circle', x, y, time: 1000 } as HitObject);
const tri = () => [circle(1, 100, 100), circle(2, 200, 100), circle(3, 150, 100 + 50 * Math.sqrt(3))];
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
function sameVertices(objs: HitObject[], expected: { x: number; y: number }[]) {
  return expected.every(p => objs.some(o => Math.hypot(o.x - p.x, o.y - p.y) <= 1));
}
const tp: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
function reset(objs: HitObject[]) {
  store.beatmap = { hitObjects: objs, timingPoints: [tp], difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0; store.redoStack.length = 0;
  store.selected.clear(); store.selectedNodes.clear(); store.lockNotes = false;
  store.endTransformPreview();
  for (const o of objs) store.selected.add(o.id);
}

section('selectionCenter: 等边三角形 = 三顶点质心而非 AABB');
{
  const objs = tri();
  const c = selectionCenter(objs)!;
  const expectedY = (100 + 100 + 100 + 50 * Math.sqrt(3)) / 3;
  assert(near(c.x, 150) && near(c.y, expectedY), `质心=(150,${expectedY.toFixed(4)}) 实际=(${c.x},${c.y})`);
  assert(!near(c.y, (100 + 100 + 50 * Math.sqrt(3)) / 2), '不等于旧包围盒中心');
  assert(selectionCenter([]) === null, '空选区返回 null');
  assert(selectionCenter([{ id: 9, type: 'spinner', x: 256, y: 192, time: 0, endTime: 1000 } as HitObject]) === null, '只选转盘返回 null');
}

section('rotateObjects: 等边三角形转 120° 顶点集合不变');
{
  const objs = tri();
  const expected = objs.map(o => ({ x: o.x, y: o.y }));
  rotateObjects(objs, selectionCenter(objs)!, 120);
  assert(sameVertices(objs, expected), `旋转后仍为原三角形 (${objs.map(o => `${o.x},${o.y}`).join(' / ')})`);
}

section('store: 预览回滚 / 提交一次 undo');
{
  const objs = tri();
  const expected = objs.map(o => ({ x: o.x, y: o.y }));
  reset(objs);
  store.beginTransformPreview();
  store.previewTransform((os, c) => rotateObjects(os, c, 120), 'selection');
  assert(sameVertices(store.beatmap!.hitObjects, expected), '实时预览也绕质心');
  assert(store.undoStack.length === 0, '预览不入 undo');
  store.endTransformPreview();
  assert(store.beatmap!.hitObjects.every((o, i) => o.x === expected[i].x && o.y === expected[i].y), '结束预览精确回滚');

  store.beginTransformPreview();
  store.commitTransformPreview((os, c) => rotateObjects(os, c, 120), 'selection');
  assert(sameVertices(store.beatmap!.hitObjects, expected), '提交保持质心旋转结果');
  assert(store.undoStack.length === 1, '提交只入一次 undo');
  store.undo();
  assert(store.beatmap!.hitObjects.every((o, i) => o.x === expected[i].x && o.y === expected[i].y), 'undo 回到原三角形');
  store.endTransformPreview();
}

if (failures) { console.error(`V511_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V511_TESTS_PASSED');

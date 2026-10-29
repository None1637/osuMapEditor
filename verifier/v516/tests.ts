// v516: 多选滑条锚点旋转中心 = 点集质心（等边三角形 120° 顶点集合不变）
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';
import type { Pt } from '../../src/osu/transform';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const tp: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
const slider = (): HitObject => ({ id: 516001, type: 'slider', x: 100, y: 100, time: 1000, length: 200,
  curveType: 'L', curvePoints: [{ x: 200, y: 100 }, { x: 150, y: 187 }], slides: 1 } as HitObject);
const rotatePt = (p: Pt, c: Pt, deg: number): Pt => {
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
};
const points = () => {
  const o = store.beatmap!.hitObjects[0];
  return [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
};
const sameTri = (expected: Pt[]) => expected.length === points().length
  && expected.every(q => points().some(p => Math.hypot(p.x - q.x, p.y - q.y) <= 1));
function reset() {
  const o = slider();
  store.beatmap = { hitObjects: [o], timingPoints: [tp], difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0; store.redoStack.length = 0; store.lockNotes = false;
  store.selected.clear(); store.selected.add(o.id);
  store.selectedNodes.clear(); store.selectedNodes.set(o.id, new Set([0, 1, 2]));
  store.endNodeTransformPreview();
}

console.log('== 直接旋转: 三个锚点转 120° 不跑位');
{
  reset();
  const expected = points().map(p => ({ ...p }));
  store.rotateSelectedNodes(120);
  assert(sameTri(expected), `旋转后顶点集合不变 (${JSON.stringify(points())})`);
  assert(store.undoStack.length === 1, '直接旋转一次 undo');
}

console.log('== 窗口预览回滚与提交');
{
  reset();
  const expected = points().map(p => ({ ...p }));
  store.beginNodeTransformPreview();
  store.previewNodeTransform((p, c) => rotatePt(p, c, 120));
  assert(sameTri(expected), `预览绕质心 (${JSON.stringify(points())})`);
  assert(store.undoStack.length === 0, '预览不入 undo');
  store.endNodeTransformPreview();
  assert(points().every((p, i) => p.x === expected[i].x && p.y === expected[i].y), '结束预览精确回滚');
  store.beginNodeTransformPreview();
  store.commitNodeTransform((p, c) => rotatePt(p, c, 120));
  assert(sameTri(expected), '提交保持质心旋转结果');
  assert(store.undoStack.length === 1, '提交只入一次 undo');
  store.undo();
  assert(points().every((p, i) => p.x === expected[i].x && p.y === expected[i].y), 'undo 回到原三角形');
  store.endNodeTransformPreview();
}

if (failures) { console.error(`V516_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V516_TESTS_PASSED');

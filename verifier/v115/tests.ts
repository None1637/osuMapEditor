// v115 store 层测试: 锁定物件 (stable Lock Notes) — 开启后所有物件变更入口被拦, 放置/绿线不受影响
// 运行: cd app && npx esbuild verifier/v115/tests.ts --bundle --platform=node --outfile=/tmp/v115.cjs && node /tmp/v115.cjs
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const obj = (id: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x: 256, y: 192, time, ...extra,
} as HitObject);

function reset() {
  store.beatmap = {
    hitObjects: [obj(1, 1000), obj(2, 2000, { type: 'slider', curveType: 'L', curvePoints: [{ x: 300, y: 192 }], slides: 1, length: 100 })],
    timingPoints: [tp(0, 500, true), tp(1000, -100, false)],
    difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {},
  } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
  store.lockNotes = true;
}

section('锁定: 删除被拦 (物件保留, 混合选区中绿线照删), Del/右键共用 deleteSelected');
{
  reset();
  store.selected.add(1);
  store.selectedGreenLines.add(1000);
  store.deleteSelected();
  const bm = store.beatmap!;
  assert(bm.hitObjects.length === 2, '物件未被删除');
  assert(store.selected.has(1), '物件选区保留');
  assert(bm.timingPoints.length === 1 && bm.timingPoints[0].uninherited, '绿线仍被删除 (不受锁定影响)');
  store.undo();
  assert(bm.timingPoints.length === 2, 'undo 恢复绿线');
}

section('锁定: J/K 与 Ctrl+方向键被拦 (物件不动, 绿线照动)');
{
  reset();
  store.selected.add(1);
  store.selectedGreenLines.add(1000);
  store.nudgeSelected(250);
  assert(store.beatmap!.hitObjects[0].time === 1000, 'J/K: 物件时间不变');
  assert(store.beatmap!.timingPoints[1].time === 1250, 'J/K: 绿线照动 (非物件)');
  store.undo();
  store.nudgeSelectedPosition(10, 0);
  assert(store.beatmap!.hitObjects[0].x === 256, 'Ctrl+方向键: 物件位置不变');
}

section('锁定: 变换/反转/hitsound/newCombo 快捷键被拦');
{
  reset();
  store.selected.add(1); store.selected.add(2);
  store.rotateSelected(90);
  store.flipSelected('h');
  store.scaleSelected(2);
  store.reverseSelected();
  store.toggleSelectedHitSound(2);
  store.toggleSelectedNewCombo();
  const [a, b] = store.beatmap!.hitObjects;
  assert(a.x === 256 && a.y === 192 && a.time === 1000, '旋转/镜像/缩放/反转: 物件1不变');
  assert(b.x === 256 && b.time === 2000, '变换: 物件2不变');
  assert(a.hitSound === undefined && a.newCombo === undefined, 'Q/W/E/R: hitsound/newCombo 不变');
  assert(store.undoStack.length === 0, '全部被拦: 无 undo 入栈');
}

section('锁定: updateObject / applyConversion(删源) 被拦; 纯新增 (批量复制 removeIds=[]) 放行');
{
  reset();
  store.updateObject(obj(1, 5000));
  assert(store.beatmap!.hitObjects[0].time === 1000, 'updateObject 被拦');
  store.applyConversion([1], [obj(9, 1000)]);
  assert(store.beatmap!.hitObjects.length === 2 && store.beatmap!.hitObjects.some(o => o.id === 1), '转换 (删源物件) 被拦');
  store.applyConversion([], [obj(9, 5000)]);
  assert(store.beatmap!.hitObjects.length === 3, '纯新增 (批量复制) 放行');
}

section('锁定: 放置新物件不受影响 (stable Lock Notes 语义)');
{
  reset();
  store.addObject(obj(7, 3000));
  assert(store.beatmap!.hitObjects.length === 3, 'addObject 放行');
}

section('解锁: 恢复正常编辑');
{
  reset();
  store.lockNotes = false;
  store.selected.add(1);
  store.deleteSelected();
  assert(store.beatmap!.hitObjects.length === 1, '解锁后删除生效');
}

console.log(failures ? `\nV115_TESTS_FAILED: ${failures}` : '\nV115_TESTS_PASSED');
process.exit(failures ? 1 : 0);

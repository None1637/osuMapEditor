// 验证器 v63 纯函数/store 测试: 红线/绿线弹窗的插入-替换-删除语义 (store 层, node 可直接实例化单例)
import { store } from '../../src/osu/store';
import type { TimingPoint, Beatmap } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra,
});

function resetStore(points: TimingPoint[]) {
  store.beatmap = { hitObjects: [], timingPoints: points, difficulty: {}, editor: {}, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.timingPointDialog = null;
}

section('applyTimingPointDialog: add 模式插入新行并按时间排序 (一次 undo)');
{
  resetStore([tp(0, 500, true), tp(5000, -100, false)]);
  store.openTimingPointDialog('add', -1, tp(2000, -200, false));
  assert(store.timingPointDialog?.mode === 'add', '弹窗打开 (add)');
  store.applyTimingPointDialog(store.timingPointDialog!.draft);
  const pts = store.beatmap!.timingPoints;
  assert(pts.length === 3 && pts[1].time === 2000 && pts[1].beatLength === -200,
    `插入后排序 [${pts.map(p => p.time)}]`);
  assert(store.timingPointDialog === null, '应用后弹窗关闭');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
  store.undo();
  assert(store.beatmap!.timingPoints.length === 2, 'undo 撤销插入');
}

section('applyTimingPointDialog: edit 模式替换原行 (不新增)');
{
  resetStore([tp(0, 500, true), tp(1000, -200, false)]);
  store.openTimingPointDialog('edit', 1, store.beatmap!.timingPoints[1]);
  store.applyTimingPointDialog(tp(1000, -50, false, { volume: 60 }));
  const pts = store.beatmap!.timingPoints;
  assert(pts.length === 2 && pts[1].beatLength === -50 && pts[1].volume === 60,
    `替换绿线 SV=2.0/vol60 (实际 ${JSON.stringify(pts[1])})`);
  assert(store.undoStack.length === 1, '一次 undo 入栈');
}

section('removeTimingPointAt: 删除指定行 (一次 undo, 弹窗关闭)');
{
  resetStore([tp(0, 500, true), tp(1000, -200, false)]);
  store.openTimingPointDialog('edit', 1, store.beatmap!.timingPoints[1]);
  store.removeTimingPointAt(1);
  assert(store.beatmap!.timingPoints.length === 1, '删除后剩 1 条');
  assert(store.timingPointDialog === null, '弹窗关闭');
  store.undo();
  assert(store.beatmap!.timingPoints.length === 2, 'undo 恢复');
}

section('closeTimingPointDialog: 取消不动数据');
{
  resetStore([tp(0, 500, true)]);
  store.openTimingPointDialog('add', -1, tp(3000, 400, true));
  store.closeTimingPointDialog();
  assert(store.timingPointDialog === null && store.beatmap!.timingPoints.length === 1
    && store.undoStack.length === 0, '取消: 无插入无 undo');
}

if (failures) { console.error(`\nTESTS_V63_FAILED: ${failures}`); process.exit(1); }
console.log('\nTESTS_V63_ALL_PASSED');

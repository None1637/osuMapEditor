// v113 store 层测试: 绿线删除 (Del/右键) / J-K 移动 / 复制粘贴绿线-滑条同刻对齐
// 运行: cd app && npx esbuild verifier/v113/tests.ts --bundle --platform=node --outfile=/tmp/v113.cjs && node /tmp/v113.cjs
import { store } from '../../src/osu/store';
import { sliderVelocityAt, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra,
});
const obj = (id: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x: 256, y: 192, time, ...extra,
} as HitObject);

function reset(hitObjects: HitObject[], timingPoints: TimingPoint[]) {
  store.beatmap = { hitObjects, timingPoints, difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
}

section('deleteSelected: 物件+绿线混合选区一并删除 (一次 undo, 可撤销)');
{
  reset([obj(1, 1000)], [tp(0, 500, true), tp(1000, -100, false), tp(2000, -50, false)]);
  store.selected.add(1);
  store.selectedGreenLines.add(2000);
  store.deleteSelected();
  const bm = store.beatmap!;
  assert(bm.hitObjects.length === 0, '物件已删');
  assert(bm.timingPoints.length === 2 && bm.timingPoints.every(p => p.time !== 2000), '绿线@2000 已删, 红线与绿线@1000 保留');
  assert(store.selected.size === 0 && store.selectedGreenLines.size === 0, '两个选区都清空');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
  store.undo();
  assert(store.beatmap!.hitObjects.length === 1 && store.beatmap!.timingPoints.length === 3, 'undo 恢复物件与绿线');
}

section('deleteSelected: 仅选中绿线也能删 (旧逻辑 selected 空时 early-return 的回归)');
{
  reset([], [tp(0, 500, true), tp(1000, -100, false)]);
  store.selectedGreenLines.add(1000);
  store.deleteSelected();
  assert(store.beatmap!.timingPoints.length === 1 && store.beatmap!.timingPoints[0].uninherited, '仅绿线选区可删除, 红线保留');
  store.undo();
  assert(store.beatmap!.timingPoints.length === 2, 'undo 恢复');
}

section('deleteGreenLinesAt: 时间轴右键删除指定时刻绿线');
{
  reset([], [tp(0, 500, true), tp(1000, -100, false), tp(2000, -50, false)]);
  store.selectedGreenLines.add(1000);
  store.deleteGreenLinesAt([1000]);
  const pts = store.beatmap!.timingPoints;
  assert(pts.length === 2 && pts.every(p => p.time !== 1000), '指定绿线已删, 其余保留');
  assert(!store.selectedGreenLines.has(1000), '选区同步移除该键');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
}

section('nudgeSelected: J/K 同步移动选中物件与绿线 (重键选区 + 保持有序)');
{
  reset([obj(1, 1000)], [tp(0, 500, true), tp(1000, -100, false), tp(2000, -50, false)]);
  store.selected.add(1);
  store.selectedGreenLines.add(1000);
  store.selectedGreenLines.add(2000);
  store.nudgeSelected(250);
  const bm = store.beatmap!;
  assert(bm.hitObjects[0].time === 1250, '物件 1000->1250');
  const times = bm.timingPoints.map(p => p.time);
  assert(JSON.stringify(times) === JSON.stringify([0, 1250, 2250]), `绿线平移且有序 [${times}]`);
  assert(store.selectedGreenLines.has(1250) && store.selectedGreenLines.has(2250) && store.selectedGreenLines.size === 2, '选区按新 time 重键');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
  store.undo();
  assert(JSON.stringify(store.beatmap!.timingPoints.map(p => p.time)) === JSON.stringify([0, 1000, 2000]), 'undo 恢复绿线时间');
}

section('nudgeSelected: 仅选中绿线也能动 (旧逻辑 selected 空时 early-return 的回归)');
{
  reset([], [tp(0, 500, true), tp(1000, -100, false)]);
  store.selectedGreenLines.add(1000);
  store.nudgeSelected(-125);
  assert(store.beatmap!.timingPoints[1].time === 875 && store.selectedGreenLines.has(875), '仅绿线选区可移动');
}

section('copy/paste: 同刻滑条+绿线粘贴后时间严格相等 (v102 偏差 bug 修复)');
{
  reset(
    [obj(11, 2000, { type: 'slider', curveType: 'L', curvePoints: [{ x: 300, y: 192 }], slides: 1, length: 100 })],
    [tp(0, 500, true), tp(1000, -100, false), tp(2000, -50, false)],
  );
  store.selected.add(11);
  store.selectedGreenLines.add(2000);
  store.copy();
  store.paste(10000.4); // 播放时钟带来的小数时刻 — 旧逻辑物件不取整/绿线取整, 滑条落后绿线 0.4ms
  const bm = store.beatmap!;
  const pasted = bm.hitObjects.find(o => o.id !== 11)!;
  const pastedGreen = bm.timingPoints.find(p => !p.uninherited && p.time === pasted.time);
  assert(pasted.time === 10000, `滑条取整到 10000 (实际 ${pasted.time})`);
  assert(!!pastedGreen && pastedGreen.beatLength === -50, '同刻存在粘贴的绿线 (SV 2.0)');
  const vel = sliderVelocityAt(bm.timingPoints, pasted.time, 1.4);
  const expect = (100 * 1.4 * 2) / 500;
  assert(Math.abs(vel - expect) < 1e-9, `滑条用同刻绿线 SV=2.0 (实际 ${vel}, 期望 ${expect}; 旧 bug 会取到前一条 SV=1.0 → 0.28)`);
  assert(store.selected.has(pasted.id) && store.selectedGreenLines.has(10000), '粘贴结果进入选区');
}

section('copy/paste: 转盘 endTime 随时间原点平移 (旧逻辑 endTime 保留绝对时刻)');
{
  reset([obj(12, 2000, { type: 'spinner', endTime: 3000 })], [tp(0, 500, true)]);
  store.selected.add(12);
  store.copy();
  store.paste(10000);
  const pasted = store.beatmap!.hitObjects.find(o => o.id !== 12)!;
  assert(pasted.time === 10000 && pasted.endTime === 11000, `转盘 10000->11000 (实际 ${pasted.time}->${pasted.endTime})`);
}

console.log(failures ? `\nV113_TESTS_FAILED: ${failures}` : '\nV113_TESTS_PASSED');
process.exit(failures ? 1 : 0);

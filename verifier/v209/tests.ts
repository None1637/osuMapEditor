// v209 store 层测试: 编辑菜单配套 store 方法
// 全选/剪切/hasClipboard/J-K 节拍吸附移动/清除音效/重置combo组颜色/重置休息时段/旋转缩放窗口开关
// 运行: cd app && npx esbuild verifier/v209/tests.ts --bundle --platform=node --outfile=verifier/v209/_bundle.mjs && node verifier/v209/_bundle.mjs
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

function reset(hitObjects: HitObject[], timingPoints: TimingPoint[], rawSections?: Record<string, string[]>) {
  store.beatmap = {
    hitObjects, timingPoints, rawSections,
    difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {},
  } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
  store.selectedNodes.clear();
  store.transformDialog = null;
  store.lockNotes = false;
  store.currentTime = 0;
  // 剪贴板是跨谱面的模块级状态, 重置避免用例间串扰 (TS private 运行时照常可写)
  (store as unknown as { clipboard: HitObject[]; clipboardGreens: TimingPoint[] }).clipboard = [];
  (store as unknown as { clipboardGreens: TimingPoint[] }).clipboardGreens = [];
}

section('selectAllObjects: 全选所有物件, 绿线/节点选区清空');
{
  reset([obj(1, 1000), obj(2, 2000), obj(3, 3000)], [tp(0, 500, true), tp(1000, -100, false)]);
  store.selectedGreenLines.add(1000);
  store.selectAllObjects();
  assert(store.selected.size === 3, '3 个物件全选中');
  assert(store.selectedGreenLines.size === 0, '绿线选区清空');
  reset([], [tp(0, 500, true)]);
  store.selectAllObjects();
  assert(store.selected.size === 0, '无物件时全选为空选区 (不报错)');
}

section('cut: 复制 + 删除 (一次 undo), undo 恢复');
{
  reset([obj(1, 1000), obj(2, 2000)], [tp(0, 500, true)]);
  store.selected.add(1);
  store.cut();
  assert(store.beatmap!.hitObjects.length === 1 && store.beatmap!.hitObjects[0].id === 2, '选中物件已删');
  assert(store.hasClipboard(), '剪贴板有内容');
  assert(store.undoStack.length === 1, '一次 undo 入栈 (非两次)');
  store.undo();
  assert(store.beatmap!.hitObjects.length === 2, 'undo 恢复物件');
}

section('cut: 空选区不动作');
{
  reset([obj(1, 1000)], [tp(0, 500, true)]);
  store.cut();
  assert(store.beatmap!.hitObjects.length === 1 && store.undoStack.length === 0, '空选区剪切 = 无操作');
}

section('hasClipboard: 复制后为 true');
{
  reset([obj(1, 1000)], [tp(0, 500, true)]);
  assert(!store.hasClipboard(), '初始为空');
  store.selected.add(1);
  store.copy();
  assert(store.hasClipboard(), '复制后为 true');
}

section('nudgeSelectedBySnap: 按当前节拍吸附移动 (beatLength 500 / 4 分 = 125ms)');
{
  reset([obj(1, 1000)], [tp(0, 500, true)]);
  store.selected.add(1);
  store.currentTime = 0;
  store.nudgeSelectedBySnap(1); // K 后移
  assert(store.beatmap!.hitObjects[0].time === 1125, '后移 +125ms');
  store.nudgeSelectedBySnap(-1); // J 前移
  store.nudgeSelectedBySnap(-1);
  assert(store.beatmap!.hitObjects[0].time === 875, '前移两次 -250ms');
}

section('clearHitSounds: selected/all 清零 hitSound 与 hitSample/边缘音效, 可撤销');
{
  reset([
    obj(1, 1000, { hitSound: 2 | 4, hitSampleRaw: '1:2:0:70:' }),
    { id: 2, type: 'slider', x: 100, y: 100, time: 2000, curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 2, length: 100, hitSound: 8, edgeSoundsRaw: '0|2|4', edgeSetsRaw: '0:0|1:2|0:0', hitSampleRaw: '2:1:0:60:' } as HitObject,
  ], [tp(0, 500, true)]);
  store.selected.add(1);
  store.clearHitSounds('selected');
  const [o1, o2] = store.beatmap!.hitObjects;
  assert(o1.hitSound === 0 && o1.hitSampleRaw === undefined, '选中物件 hitSound/hitSample 清零');
  assert((o2.hitSound ?? 0) === 8, '未选中物件不受影响');
  store.clearHitSounds('all');
  assert(o2.hitSound === 0 && o2.edgeSoundsRaw === undefined && o2.edgeSetsRaw === undefined && o2.hitSampleRaw === undefined,
    'all: 滑条边缘音效与 hitSample 一并清零');
  store.undo();
  store.undo();
  const [r1, r2] = store.beatmap!.hitObjects;
  assert(r1.hitSound === 6 && r1.hitSampleRaw === '1:2:0:70:' && r2.edgeSoundsRaw === '0|2|4', '两次 undo 全部恢复');
}

section('resetComboFlags: 清除全部 newCombo/comboSkip, 可撤销');
{
  reset([obj(1, 1000, { newCombo: true }), obj(2, 2000, { newCombo: true, comboSkip: 2 }), obj(3, 3000)], [tp(0, 500, true)]);
  store.resetComboFlags();
  assert(store.beatmap!.hitObjects.every(o => !o.newCombo && !o.comboSkip), '全部 NC/comboSkip 清零');
  store.undo();
  assert(store.beatmap!.hitObjects[1].newCombo === true && store.beatmap!.hitObjects[1].comboSkip === 2, 'undo 恢复');
}

section('resetBreaks: 删 [Events] break 行 (2,/Break,), 注释保留, 无 break 不动作, 可撤销');
{
  const events = ['//Background and Video events', '0,0,"bg.jpg",0,0', '//Break Periods', '2,1000,2000', 'Break,5000,8000', '//Storyboard Layer 0'];
  reset([obj(1, 1000)], [tp(0, 500, true)], { Events: [...events] });
  store.resetBreaks();
  const ev = store.beatmap!.rawSections!['Events'];
  assert(ev.length === 4 && !ev.some(l => /^\s*(2|Break)\s*,/.test(l)), '两条 break 行已删');
  assert(ev.includes('//Break Periods') && ev.includes('0,0,"bg.jpg",0,0'), '注释与背景行保留');
  store.undo();
  assert(store.beatmap!.rawSections!['Events'].length === 6, 'undo 恢复 break 行 (rawSections 入快照)');
  // 无 break -> 无操作 (无 undo/脏标记)
  reset([obj(1, 1000)], [tp(0, 500, true)], { Events: ['0,0,"bg.jpg",0,0'] });
  store.resetBreaks();
  assert(store.undoStack.length === 0, '无 break 时 early-return');
}

section('transformDialog: 有选区才开, close 关闭');
{
  reset([obj(1, 1000)], [tp(0, 500, true)]);
  store.openTransformDialog('rotate');
  assert(store.transformDialog === null, '无选区不开窗');
  store.selected.add(1);
  store.openTransformDialog('rotate');
  assert(store.transformDialog === 'rotate', '旋转窗口打开');
  store.openTransformDialog('scale');
  assert(store.transformDialog === 'scale', '切换到缩放窗口');
  store.closeTransformDialog();
  assert(store.transformDialog === null, '关闭');
}

if (failures) { console.error(`TESTS FAILED: ${failures}`); process.exit(1); }
console.log('TESTS ALL PASSED');

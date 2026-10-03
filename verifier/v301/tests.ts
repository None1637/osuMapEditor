// v301 store 层测试: F05b 旋转应用回归 + F05a 实时预览会话语义
// 运行: cd app && npx esbuild verifier/v301/tests.ts --bundle --platform=node --outfile=verifier/v301/_bundle.mjs && node verifier/v301/_bundle.mjs
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';
import { rotateObjects, scaleObjects } from '../../src/osu/transform';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const slider = (id: number): HitObject => ({
  id, type: 'slider', x: 100, y: 100, time: 1000, length: 200, repeats: 1,
  curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 200 }],
} as unknown as HitObject);

function reset(hitObjects: HitObject[]) {
  store.beatmap = {
    hitObjects, timingPoints: [tp(0, 500, true)],
    difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {},
  } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedNodes.clear();
  store.lockNotes = false;
  store.endTransformPreview(); // 防用例间残留预览会话
}

section('F05b 回归: 选中滑条 rotateSelected 确实移动物件与锚点');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.rotateSelected(67, 'selection');
  const o = store.beatmap!.hitObjects[0];
  assert(o.x !== 100 || o.y !== 100, '滑条头位置已变化');
  assert(o.curvePoints![0].x !== 200 || o.curvePoints![0].y !== 100, '锚点已同步旋转');
  assert(store.undoStack.length === 1, '一次应用一次 undo');
}

section('F05a 预览: previewTransform 不入 undo, endTransformPreview 回滚');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.beginTransformPreview();
  store.previewTransform((objs, c) => rotateObjects(objs, c, 90), 'selection');
  const o = store.beatmap!.hitObjects[0];
  assert(o.x !== 100 || o.y !== 100, '预览后位置已变化');
  assert(store.undoStack.length === 0, '预览不入 undo 栈');
  store.endTransformPreview();
  assert(o.x === 100 && o.y === 100, '结束预览回滚原位置');
  assert(o.curvePoints![0].x === 200 && o.curvePoints![0].y === 100, '锚点回滚');
  assert(store.tfBackup === null, '备份已清空');
}

section('F05a 预览相对基准不叠加 (连续改值)');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.beginTransformPreview();
  store.previewTransform((objs, c) => rotateObjects(objs, c, 90), 'selection');
  store.previewTransform((objs, c) => rotateObjects(objs, c, 180), 'selection');
  // 180° 绕选区中心旋转后, 头 (100,100) 与尾锚点 (200,200) 对调: 头应落在原包围盒对角
  const o = store.beatmap!.hitObjects[0];
  assert(Math.abs(o.x - 200) <= 1 && Math.abs(o.y - 200) <= 1, '第二次预览=相对基准 180° (非叠加 270°)');
  store.endTransformPreview();
}

section('F05a 提交: commit 一次 undo 且 undo 回到预览前; 提交后可继续预览');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.beginTransformPreview();
  store.previewTransform((objs, c) => rotateObjects(objs, c, 90), 'selection');
  store.commitTransformPreview((objs, c) => rotateObjects(objs, c, 90), 'selection');
  const o = store.beatmap!.hitObjects[0];
  assert(o.x !== 100 || o.y !== 100, '提交后保持旋转结果');
  assert(store.undoStack.length === 1, '提交只入一次 undo');
  store.undo();
  const u = store.beatmap!.hitObjects[0]; // undo/redo 的 restore 会整体换新数组, 需重新取引用
  assert(u.x === 100 && u.y === 100, 'undo 回到预览前状态');
  store.redo();
  const r = store.beatmap!.hitObjects[0];
  assert(r.x !== 100 || r.y !== 100, 'redo 恢复旋转结果');
  store.endTransformPreview();
}

section('F05a 未预览直接提交 (开窗直接点按钮) 与普通应用一致');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.beginTransformPreview();
  store.commitTransformPreview((objs, c) => rotateObjects(objs, c, 45), 'selection');
  const o = store.beatmap!.hitObjects[0];
  assert(o.x !== 100 || o.y !== 100, '直接提交生效');
  assert(store.undoStack.length === 1, '一次 undo');
  store.endTransformPreview();
}

section('F05a 缩放预览: 滑条长度同步缩放并回滚');
{
  reset([slider(1)]);
  store.selected.add(1);
  store.beginTransformPreview();
  store.previewTransform((objs, c) => scaleObjects(objs, c, 2, 1), 'selection');
  const o = store.beatmap!.hitObjects[0];
  assert(o.length === 400, '预览缩放后 length ×2');
  store.endTransformPreview();
  assert(o.length === 200, '回滚后 length 还原');
}

console.log(failures ? `\n${failures} 个断言失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

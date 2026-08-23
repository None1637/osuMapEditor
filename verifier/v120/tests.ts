// v120 测试: 未保存改动 (脏标记) — pushUndo 置脏, load/save 清脏, guardUnsaved 拦截与弹窗动作
// 运行: cd app && npx esbuild verifier/v120/tests.ts --bundle --platform=node --outfile=/tmp/v120.cjs --log-level=error --alias:@=./src && node /tmp/v120.cjs
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
const obj = (id: number, time: number): HitObject => ({ id, type: 'circle', x: 256, y: 192, time } as HitObject);

function reset() {
  store.load({
    hitObjects: [obj(9001, 1000)],
    timingPoints: [tp(0, 500, true)],
    difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {},
  } as unknown as Beatmap, null);
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
}

section('load: 载入即干净状态 (dirty=false, pendingAction 清空)');
{
  store.dirty = true; // 模拟脏状态 (setDirty 私有, 直接写字段测 load 清理)
  store.pendingAction = () => { throw new Error('不应执行'); };
  reset();
  assert(store.dirty === false, 'load 清脏标记');
  assert(store.pendingAction === null, 'load 清空待执行动作');
}

section('pushUndo: 任何谱面变更置脏');
{
  reset();
  assert(store.dirty === false, '初始干净');
  store.pushUndo();
  assert(store.dirty === true, 'pushUndo 后置脏');
  store.undoStack.length = 0;
}

section('guardUnsaved: 干净时放行, 脏时拦截并登记动作');
{
  reset();
  let ran = 0;
  assert(store.guardUnsaved(() => ran++) === true, '干净: 放行 (返回 true)');
  assert(ran === 0, '干净: 动作不由 guard 执行 (调用方自行继续)');
  store.pushUndo(); // 置脏
  assert(store.guardUnsaved(() => ran++) === false, '脏: 拦截 (返回 false)');
  assert(store.pendingAction !== null && ran === 0, '脏: 动作登记为 pendingAction, 未执行');
  store.pendingAction = null;
}

section('resolvePendingAction: 取消不执行 / 确认执行');
{
  reset(); store.pushUndo();
  let ran = 0;
  store.guardUnsaved(() => ran++);
  store.resolvePendingAction(false); // 取消
  assert(ran === 0 && store.pendingAction === null, '取消: 不执行, 弹窗关闭');
  assert(store.dirty === true, '取消: 脏标记保留 (改动未丢)');
  store.guardUnsaved(() => ran++);
  store.resolvePendingAction(true); // 废弃/保存成功 -> 执行
  assert(ran === 1 && store.pendingAction === null, '确认: 执行登记动作');
}

section('guardUnsaved: 无谱面时放行');
{
  store.beatmap = null;
  store.dirty = true;
  assert(store.guardUnsaved(() => { }) === true, '无谱面: 不拦截');
  store.dirty = false;
  reset();
}

console.log(failures ? `\nV120_TESTS_FAILED: ${failures}` : '\nV120_TESTS_PASSED');
process.exit(failures ? 1 : 0);

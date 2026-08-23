// v114 store 层测试: Q/W/E/R 三态语义 (lazer DrawableTernaryButton.Toggle: 未全有->全部置位, 全有->全部清位)
// 运行: cd app && npx esbuild verifier/v114/tests.ts --bundle --platform=node --outfile=/tmp/v114.cjs && node /tmp/v114.cjs
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const obj = (id: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x: 256, y: 192, time, ...extra,
} as HitObject);

function reset(hitObjects: HitObject[]) {
  store.beatmap = { hitObjects, timingPoints: [], difficulty: {}, editor: {}, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
}

section('toggleSelectedHitSound: 混合选区第一次按 = 全部置位 (旧 XOR 会翻转已有者)');
{
  reset([obj(1, 1000, { hitSound: 2 }), obj(2, 2000, { hitSound: 0 }), obj(3, 3000, { hitSound: 4 })]);
  store.selected.add(1); store.selected.add(2);
  store.toggleSelectedHitSound(2); // W whistle
  const [a, b, c] = store.beatmap!.hitObjects;
  assert((a.hitSound! & 2) !== 0 && (b.hitSound! & 2) !== 0, `两个选中物件都有 whistle (实际 ${a.hitSound}/${b.hitSound})`);
  assert(c.hitSound === 4, '未选中物件不动');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
}

section('toggleSelectedHitSound: 全有才全部清位; 置位保留其它位');
{
  reset([obj(1, 1000, { hitSound: 2 | 4 }), obj(2, 2000, { hitSound: 2 })]);
  store.selected.add(1); store.selected.add(2);
  store.toggleSelectedHitSound(2); // 全有 whistle -> 全清
  const [a, b] = store.beatmap!.hitObjects;
  assert(a.hitSound === 4 && b.hitSound === 0, `whistle 全清且 finish 保留 (实际 ${a.hitSound}/${b.hitSound})`);
  store.undo();
  const [a2, b2] = store.beatmap!.hitObjects;
  assert(a2.hitSound === 6 && b2.hitSound === 2, 'undo 恢复');
}

section('toggleSelectedNewCombo: 混合选区统一 true, 再按统一 false');
{
  reset([obj(1, 1000, { newCombo: true }), obj(2, 2000)]);
  store.selected.add(1); store.selected.add(2);
  store.toggleSelectedNewCombo();
  assert(store.beatmap!.hitObjects.every(o => o.newCombo === true), '混合 -> 全部 newCombo=true');
  store.toggleSelectedNewCombo();
  assert(store.beatmap!.hitObjects.every(o => o.newCombo === false), '全有 -> 全部 newCombo=false');
  store.undo(); store.undo();
  const [a, b] = store.beatmap!.hitObjects;
  assert(a.newCombo === true && b.newCombo === undefined, '两次 undo 恢复原状');
}

section('toggle: 空选区无操作 (无 undo 入栈)');
{
  reset([obj(1, 1000)]);
  store.toggleSelectedHitSound(2);
  store.toggleSelectedNewCombo();
  assert(store.undoStack.length === 0 && store.beatmap!.hitObjects[0].hitSound === undefined, '空选区不动数据不入栈');
}

console.log(failures ? `\nV114_TESTS_FAILED: ${failures}` : '\nV114_TESTS_PASSED');
process.exit(failures ? 1 : 0);

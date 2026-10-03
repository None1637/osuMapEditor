// v304 store 层测试: F08 多选滑条锚点快捷键变换 (旋转/镜像, 原点 = 锚点包围盒中心)
// 运行: cd app && npx esbuild verifier/v304/tests.ts --bundle --platform=node --outfile=verifier/v304/_bundle.mjs && node verifier/v304/_bundle.mjs
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
const slider = (id: number): HitObject => ({
  id, type: 'slider', x: 100, y: 100, time: 1000, length: 300, repeats: 1,
  curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 300 }],
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
}

section('F08: rotateSelectedNodes 绕锚点包围盒中心旋转, 头部不动 (未选头)');
{
  reset([slider(1)]);
  store.selectedNodes.set(1, new Set([1, 2])); // 选中两个锚点 (200,100) / (200,300), 包围盒中心 (200,200)
  store.rotateSelectedNodes(90); // 顺时针 90°
  const o = store.beatmap!.hitObjects[0];
  assert(o.x === 100 && o.y === 100, '未选中的头部不动');
  assert(o.curvePoints![0].x === 300 && o.curvePoints![0].y === 200, `锚点1 -> (300,200) (${o.curvePoints![0].x},${o.curvePoints![0].y})`);
  assert(o.curvePoints![1].x === 100 && o.curvePoints![1].y === 200, `锚点2 -> (100,200) (${o.curvePoints![1].x},${o.curvePoints![1].y})`);
  assert(store.undoStack.length === 1, '一次操作一次 undo');
  store.undo();
  const u = store.beatmap!.hitObjects[0];
  assert(u.curvePoints![0].x === 200 && u.curvePoints![0].y === 100, 'undo 还原锚点');
}

section('F08: flipSelectedNodes 水平镜像 (左右, 绕包围盒中心)');
{
  reset([slider(1)]);
  store.selectedNodes.set(1, new Set([1, 2])); // 中心 (200,200)
  store.flipSelectedNodes('h'); // 左右镜像: x 对换 — 两锚点 x 同为 200, 位置不变
  const o = store.beatmap!.hitObjects[0];
  assert(o.curvePoints![0].x === 200 && o.curvePoints![0].y === 100, `h 镜像后锚点1 不变 (${o.curvePoints![0].x},${o.curvePoints![0].y})`);
  assert(o.curvePoints![1].x === 200 && o.curvePoints![1].y === 300, 'h 镜像后锚点2 不变');
  assert(o.x === 100 && o.y === 100, '头部不动');
  store.flipSelectedNodes('v'); // 垂直镜像: y 对换 (绕 y=200)
  assert(o.curvePoints![0].x === 200 && o.curvePoints![0].y === 300, `v 镜像锚点1 -> y=300 (${o.curvePoints![0].y})`);
  assert(o.curvePoints![1].x === 200 && o.curvePoints![1].y === 100, 'v 镜像锚点2 -> y=100');
}

section('F08: 含头部选区旋转 (头也动)');
{
  reset([slider(1)]);
  store.selectedNodes.set(1, new Set([0, 1])); // 头 (100,100) + 锚点 (200,100), 中心 (150,100)
  store.rotateSelectedNodes(90);
  const o = store.beatmap!.hitObjects[0];
  assert(o.x === 150 && o.y === 50, `头绕 (150,100) 转 90° -> (150,50) (${o.x},${o.y})`);
  assert(o.curvePoints![0].x === 150 && o.curvePoints![0].y === 150, `锚点1 -> (150,150) (${o.curvePoints![0].x},${o.curvePoints![0].y})`);
  assert(o.curvePoints![1].x === 200 && o.curvePoints![1].y === 300, '未选锚点不动');
}

section('F08: 无节点选区时为空操作 (不推 undo)');
{
  reset([slider(1)]);
  store.rotateSelectedNodes(90);
  assert(store.undoStack.length === 0, '空节点选区不动作');
}

console.log(failures ? `\n${failures} 个断言失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

// v210 store/transform 层测试: 对称 (编辑菜单「对称...」)
// reflectObjectsAcrossLine 纯函数 / setSymPoint 两点最小间距 / symAxisLine 模式换算 / reflectSelected undo
// 运行: cd app && npx esbuild verifier/v210/tests.ts --bundle --platform=node --outfile=verifier/v210/_bundle.mjs && node verifier/v210/_bundle.mjs
import { store } from '../../src/osu/store';
import { reflectObjectsAcrossLine } from '../../src/osu/transform';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number): TimingPoint => ({
  time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0,
});
const obj = (id: number, x: number, y: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x, y, time: 1000, ...extra,
} as HitObject);

function reset(hitObjects: HitObject[]) {
  store.beatmap = {
    hitObjects, timingPoints: [tp(0)],
    difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {},
  } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.transformDialog = null;
  store.lockNotes = false;
  store.symAxisMode = 'selection';
  store.symAxisDir = 'v';
  store.symP1 = { x: 176, y: 192 };
  store.symP2 = { x: 336, y: 192 };
}

section('reflectObjectsAcrossLine: 纯函数 — 竖直/水平/斜线/两点重合');
{
  // 竖直线 x=100: (150, 50) -> (50, 50)
  let objs = [obj(1, 150, 50)];
  reflectObjectsAcrossLine(objs, { x: 100, y: 0 }, { x: 100, y: 1 });
  assert(objs[0].x === 50 && objs[0].y === 50, '竖直线镜像');
  // 水平线 y=100: (50, 150) -> (50, 50)
  objs = [obj(1, 50, 150)];
  reflectObjectsAcrossLine(objs, { x: 0, y: 100 }, { x: 1, y: 100 });
  assert(objs[0].x === 50 && objs[0].y === 50, '水平线镜像');
  // 斜线 y=x: (10, 30) -> (30, 10)
  objs = [obj(1, 10, 30)];
  reflectObjectsAcrossLine(objs, { x: 0, y: 0 }, { x: 100, y: 100 });
  assert(objs[0].x === 30 && objs[0].y === 10, '斜线 y=x 镜像');
  // 滑条控制点整体镜像
  objs = [{ id: 2, type: 'slider', x: 150, y: 50, time: 1000, curveType: 'L', curvePoints: [{ x: 170, y: 90 }], slides: 1, length: 50 } as HitObject];
  reflectObjectsAcrossLine(objs, { x: 100, y: 0 }, { x: 100, y: 1 });
  assert(objs[0].x === 50 && objs[0].curvePoints![0].x === 30 && objs[0].curvePoints![0].y === 90, '滑条头+控制点整体镜像');
  // 转盘不参与
  objs = [{ id: 3, type: 'spinner', x: 256, y: 192, time: 1000, endTime: 2000 } as HitObject];
  reflectObjectsAcrossLine(objs, { x: 100, y: 0 }, { x: 100, y: 1 });
  assert(objs[0].x === 256, '转盘位置不变');
  // 两点重合 -> 不动作
  objs = [obj(1, 150, 50)];
  const r = reflectObjectsAcrossLine(objs, { x: 5, y: 5 }, { x: 5, y: 5 });
  assert(r.length === 0 && objs[0].x === 150, '两点重合时无操作');
}

section('setSymPoint: 两点最小间距 4px, 无法拖到同个位置');
{
  reset([]);
  store.setSymPoint(1, { x: 336, y: 192 }); // 拖到 P2 同位
  const d = Math.hypot(store.symP1.x - store.symP2.x, store.symP1.y - store.symP2.y);
  assert(Math.abs(d - 4) < 1.5 && d >= 3, `重合被顶开到最小间距 (d=${d.toFixed(2)})`);
  store.setSymPoint(1, { x: 330, y: 192 }); // 距离 6 > 4, 正常移动
  assert(store.symP1.x === 330 && store.symP1.y === 192, '正常距离移动不受钳制');
  store.setSymPoint(2, { x: 332, y: 192 }); // 距离 2 < 4 -> 钳到 4
  assert(store.symP2.x - store.symP1.x === 4, '过近时沿拖拽方向钳到 4px');
}

section('symAxisLine: 模式换算');
{
  reset([obj(1, 100, 100), obj(2, 300, 200)]);
  store.selected.add(1); store.selected.add(2);
  store.symAxisMode = 'selection'; store.symAxisDir = 'v';
  let line = store.symAxisLine()!;
  assert(line.p1.x === 200 && line.p2.x === 200, '选区+竖直线: x = 包围盒中心 200');
  store.symAxisDir = 'h';
  line = store.symAxisLine()!;
  assert(line.p1.y === 150 && line.p2.y === 150, '选区+水平线: y = 包围盒中心 150');
  store.symAxisMode = 'center'; store.symAxisDir = 'v';
  line = store.symAxisLine()!;
  assert(line.p1.x === 256 && line.p2.x === 256, '中心模式: 过游玩区中心 (256,192)');
  store.symAxisMode = 'custom';
  line = store.symAxisLine()!;
  assert(line.p1.x === 176 && line.p2.x === 336, '自定义模式: 两点原样');
  // 只选转盘 -> 选区模式无有效轴
  reset([{ id: 9, type: 'spinner', x: 256, y: 192, time: 1000, endTime: 2000 } as HitObject]);
  store.selected.add(9);
  store.symAxisMode = 'selection';
  assert(store.symAxisLine() === null, '只选转盘时选区模式返回 null');
}

section('reflectSelected: 应用对称 + undo 恢复');
{
  reset([obj(1, 150, 50)]);
  store.selected.add(1);
  store.symAxisMode = 'center'; store.symAxisDir = 'v'; // 竖直线 x=256
  store.reflectSelected();
  assert(store.beatmap!.hitObjects[0].x === 362 && store.beatmap!.hitObjects[0].y === 50, '关于 x=256 左右镜像 (150 -> 362)');
  assert(store.undoStack.length === 1, '一次 undo 入栈');
  store.undo();
  assert(store.beatmap!.hitObjects[0].x === 150, 'undo 恢复');
}

section('reflectSelected: 空选区/只选转盘/锁定物件 不动作');
{
  reset([obj(1, 150, 50)]);
  store.reflectSelected();
  assert(store.undoStack.length === 0, '空选区不动作');
  store.selected.add(1);
  store.lockNotes = true;
  store.reflectSelected();
  assert(store.undoStack.length === 0 && store.beatmap!.hitObjects[0].x === 150, '锁定物件不动作');
}

if (failures) { console.error(`TESTS FAILED: ${failures}`); process.exit(1); }
console.log('TESTS ALL PASSED');

// 验证器 v51 纯函数测试: moveSelectionInBounds 改用头+滑条尾包围盒 (lazer startAndEndOnly)
// 背景: 中间控制点允许超出游玩区 (节点编辑不钳制), 旧实现把全控制点计入越界判定,
//   每次缩放更新都误判越界 -> 整体平移 -> 拖下边时上边瞬移 ("框的上边异常移动")
import {
  selectionStartEndQuad, selectionScaleQuad, snapshotScaleStates, applyScaleDrag,
} from '../../src/osu/selectionBox';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const bmBase = (): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap);
const circle = (id: number, x: number, y: number): HitObject =>
  ({ id, type: 'circle', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject);
const slider = (id: number, x: number, y: number, cps: { x: number; y: number }[], length: number): HitObject =>
  ({ id, type: 'slider', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0, curveType: 'L', curvePoints: cps, length, slides: 1 } as unknown as HitObject);

section('selectionStartEndQuad: 只含头 + 滑条路径末端 (中间控制点不计入, lazer enumerateStartAndEndPositions)');
{
  // 滑条头 (300,300), 中间控制点 (560,300) 出界, 回折 (400,200); length=50 -> 路径末端 (350,300) 界内
  const sl = slider(2, 300, 300, [{ x: 560, y: 300 }, { x: 400, y: 200 }], 50);
  const c1 = circle(1, 200, 100);
  const q = selectionStartEndQuad([c1, sl])!;
  assert(q !== null, '有包围盒');
  assert(q.x === 200 && q.y === 100, `左上角 = (200,100) (实际 ${q.x},${q.y})`);
  assert(q.x + q.w === 350 && q.y + q.h === 300, `右下 = (350,300) — 出界中间控制点 (560,300) 不计入 (实际 ${q.x + q.w},${q.y + q.h})`);
  const full = selectionScaleQuad([c1, sl])!;
  assert(full.x + full.w === 560, `对照: 全控制点盒含出界点 (右缘 ${full.x + full.w})`);
  // 单 cp 滑条: 末端 = 该 cp (出界则计入)
  const sl2 = slider(3, 300, 300, [{ x: 300, y: 450 }], 150);
  const q2 = selectionStartEndQuad([sl2])!;
  assert(q2.y + q2.h === 450, `单 cp 滑条末端即 cp, 出界计入 (底缘 ${q2.y + q2.h})`);
}

section('applyScaleDrag 回归: 出界中间控制点不再触发整体平移 (v51 修复)');
{
  const bm = bmBase();
  const c1 = circle(1, 200, 100);
  const sl = slider(2, 300, 300, [{ x: 560, y: 300 }, { x: 400, y: 200 }], 50);
  bm.hitObjects = [c1, sl];
  const objs = [c1, sl];
  const states = snapshotScaleStates(objs);
  // 旧行为: 即使 1.0 倍率 (无缩放), 全控制点盒含 (560,300) > 512 -> 整体左移 48 -> c1.x=152
  const quad = selectionScaleQuad(objs)!;
  const r = applyScaleDrag(bm, objs, states, { x: 1, y: 1 }, { x: 380, y: 100 }, 'y', 4, quad);
  assert(!r.changed, '1.0 倍率无改动 (旧实现会误报 changed 并平移)');
  assert(c1.x === 200 && c1.y === 100, `圆圈不动 (${c1.x},${c1.y})`);
  assert(sl.x === 300 && sl.y === 300, `滑条头不动 (${sl.x},${sl.y})`);
  // 真实缩放 (拖下边 sy=1.25): 头顶点仍不动, 头按倍率缩放, 不平移
  const r2 = applyScaleDrag(bm, objs, states, { x: 1, y: 1.25 }, { x: 380, y: 100 }, 'y', 4, quad);
  assert(r2.changed, '有缩放改动');
  assert(c1.x === 200 && c1.y === 100, `顶部圆圈位置不瞬移 (${c1.x},${c1.y})`);
  assert(sl.x === 300 && sl.y === 350, `滑条头缩放 100+200*1.25=350 (${sl.x},${sl.y})`);
  assert(sl.curvePoints![0].x === 560, `控制点随头平移 (cp1.x=${sl.curvePoints![0].x})`);
}

section('applyScaleDrag: 滑条尾出界仍整体移回 (lazer startAndEndOnly 保留语义)');
{
  const bm = bmBase();
  const c1 = circle(1, 200, 100);
  const sl = slider(2, 300, 300, [{ x: 300, y: 450 }], 150); // 尾 (300,450) 出界
  bm.hitObjects = [c1, sl];
  const objs = [c1, sl];
  const states = snapshotScaleStates(objs);
  const quad = selectionScaleQuad(objs)!;
  // 1.0 倍率: Begin 盒已出界 -> 钳制先把 sy 压到 284/350≈0.811 (lazer 同款, 钳制用全控制点 OriginalSurroundingQuad),
  // 头 -> 100+200*0.811=262, 尾 -> 412 仍出界 -> 整体上移 28 (lazer moveSelectionInBounds, 头+尾盒)
  applyScaleDrag(bm, objs, states, { x: 1, y: 1 }, { x: 300, y: 100 }, 'y', 4, quad);
  assert(c1.y === 72, `圆圈随整体移回界内 100-28=72 (${c1.y})`);
  assert(sl.y === 234, `滑条头 262-28=234 (${sl.y})`);
  const end = sl.y + 150; // 直滑条尾 = 头+150
  assert(end === 384, `尾贴底缘 384 (${end})`);
}

if (failures) { console.error(`\nTESTS_V51_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V51_ALL_PASSED');

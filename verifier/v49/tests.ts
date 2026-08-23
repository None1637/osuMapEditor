// 验证器 v49 纯函数测试: 选中框缩放 (lazer SelectionBoxScaleHandle + OsuSelectionScaleHandler)
import {
  selectionScaleQuad, displayQuad, scaleHandleAnchors, anchorPoint, hitScaleHandle,
  dragToScale, anchorOpposite, anchorAxis, minimumEnclosingCircleCenter,
  clampScaleToPlayfield, snapshotScaleStates, applyScaleDrag, movablePoints,
} from '../../src/osu/selectionBox';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

const circle = (id: number, x: number, y: number): HitObject =>
  ({ id, type: 'circle', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0 });
const slider = (id: number, x: number, y: number, curve: { x: number; y: number }[], length: number): HitObject =>
  ({ id, type: 'slider', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0, curveType: 'L', curvePoints: curve, slides: 1, length });
const spinner = (id: number): HitObject =>
  ({ id, type: 'spinner', x: 256, y: 192, time: 1000, endTime: 2000, hitSound: 0, newCombo: true, comboSkip: 0 });

const bmBase = (): Beatmap => ({
  metadata: { title: '', artist: '', creator: '', version: '', source: '', tags: '', beatmapId: 0, beatmapSetId: 0 },
  difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
  editor: { bookmarks: [], distanceSpacing: 1, beatDivisor: 4, gridSize: 4, timelineZoom: 1 },
  colours: [], events: [],
} as unknown as Beatmap);

section('selectionScaleQuad / movablePoints: 滑条含控制点, 转盘排除 (lazer GetSurroundingQuad)');
{
  const q = selectionScaleQuad([circle(1, 200, 100), slider(2, 300, 200, [{ x: 400, y: 260 }, { x: 350, y: 300 }], 200), spinner(3)])!;
  assert(q.x === 200 && q.y === 100 && q.w === 200 && q.h === 200, `包围盒含滑条控制点, 不含转盘 (${JSON.stringify(q)})`);
  assert(selectionScaleQuad([spinner(3)]) === null, '只选转盘 -> null (无框无手柄)');
  assert(movablePoints([circle(1, 5, 6), spinner(2)]).length === 1, 'movablePoints 排除转盘');
}

section('displayQuad: 显示框按圆圈半径外扩 (lazer blueprint SelectionQuad)');
{
  const dq = displayQuad({ x: 200, y: 100, w: 100, h: 100 }, 36.48);
  assert(near(dq.x, 163.52) && near(dq.y, 63.52) && near(dq.w, 172.96) && near(dq.h, 172.96), `外扩半径 (${JSON.stringify(dq)})`);
}

section('scaleHandleAnchors: 宽>0 有左右, 高>0 有上下, 都有才有角 (lazer updateState)');
{
  const all = scaleHandleAnchors({ x: 0, y: 0, w: 100, h: 100 });
  assert(all.length === 8, '正常包围盒 8 手柄');
  const flatX = scaleHandleAnchors({ x: 0, y: 0, w: 0, h: 100 });
  assert(flatX.length === 2 && flatX.includes('tc') && flatX.includes('bc'), '零宽 (竖线选区) 只有上下边手柄');
  const flatY = scaleHandleAnchors({ x: 0, y: 0, w: 100, h: 0 });
  assert(flatY.length === 2 && flatY.includes('cl') && flatY.includes('cr'), '零高 (横线选区) 只有左右边手柄');
  assert(scaleHandleAnchors({ x: 0, y: 0, w: 0, h: 0 }).length === 0, '单圆圈 (0x0) 无手柄');
}

section('anchorPoint / anchorOpposite / anchorAxis / hitScaleHandle');
{
  const q = { x: 100, y: 50, w: 200, h: 100 };
  const tl = anchorPoint(q, 'tl'), cr = anchorPoint(q, 'cr'), bc = anchorPoint(q, 'bc');
  assert(tl.x === 100 && tl.y === 50 && cr.x === 300 && cr.y === 100 && bc.x === 200 && bc.y === 150, '锚点位置');
  const opp = anchorOpposite(q, 'tl');
  assert(opp.x === 300 && opp.y === 150, 'tl 对角 = br (缩放原点)');
  const oppL = anchorOpposite(q, 'cl');
  assert(oppL.x === 300 && oppL.y === 100, 'cl 对边 = cr');
  assert(anchorAxis('tc') === 'y' && anchorAxis('cr') === 'x' && anchorAxis('br') === 'both', '手柄轴 (lazer getAdjustAxis)');
  const dq = { x: 90, y: 40, w: 220, h: 120 };
  assert(hitScaleHandle(q, dq, { x: 311, y: 99 }, 12) === 'cr', '命中最近手柄 cr');
  assert(hitScaleHandle(q, dq, { x: 200, y: 100 }, 12) === null, '框中心不命中任何手柄');
}

section('dragToScale: lazer convertDragEventToScaleMultiplier (边清零/上左取反/Shift 锁比)');
{
  const r1 = dragToScale('cr', 100, 100, 40, 30, false);
  assert(near(r1.x, 1.4) && near(r1.y, 1), 'cr: 右拖 40/100 = 1.4x, Y 清零');
  const r2 = dragToScale('cl', 100, 100, 40, 0, false);
  assert(near(r2.x, 0.6), 'cl: 右拖 = 缩小 (方向取反) 0.6x');
  const r3 = dragToScale('tc', 100, 100, 40, -30, false);
  assert(near(r3.x, 1) && near(r3.y, 1.3), 'tc: 上拖 30 = 1.3x, X 清零');
  const r4 = dragToScale('br', 100, 100, 40, -50, false);
  assert(near(r4.x, 1.4) && near(r4.y, 0.5), 'br: 双轴独立 1.4/0.5');
  const r5 = dragToScale('br', 100, 100, 40, -50, true);
  assert(near(r5.x, 0.95) && near(r5.y, 0.95), 'br+Shift: 锁长宽比取均值 0.95');
  const r6 = dragToScale('tl', 100, 100, -40, -50, false);
  assert(near(r6.x, 1.4) && near(r6.y, 1.5), 'tl: 左上拖 = 放大');
}

section('minimumEnclosingCircleCenter (Welzl, lazer 默认原点)');
{
  const m2 = minimumEnclosingCircleCenter([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert(near(m2.x, 5) && near(m2.y, 0), '两点 -> 中点');
  const m3 = minimumEnclosingCircleCenter([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]);
  assert(near(m3.x, 2) && near(m3.y, 1.5), '直角三角形 -> 斜边中点 (2,1.5)');
  const dup = minimumEnclosingCircleCenter([{ x: 200, y: 100 }, { x: 300, y: 200 }, { x: 200, y: 100 }]);
  assert(near(dup.x, 250) && near(dup.y, 150), '重复点鲁棒');
}

section('clampScaleToPlayfield: lazer ClampScaleToPlayfieldBounds (axisRotation=0)');
{
  const origin = { x: 200, y: 150 }, quad = { x: 200, y: 100, w: 100, h: 100 };
  const x = clampScaleToPlayfield({ x: 5, y: 1 }, origin, quad, 'x');
  assert(near(x.x, 3.12) && near(x.y, 1), `X 轴: 右角最多放大到 512 -> 3.12 (${x.x.toFixed(3)})`);
  const y = clampScaleToPlayfield({ x: 1, y: 5 }, origin, quad, 'y');
  assert(near(y.x, 1) && near(y.y, 3), `Y 轴: 上角先触顶 -> 3.0 (${y.y.toFixed(3)})`);
  const both = clampScaleToPlayfield({ x: 5, y: 5 }, origin, quad, 'both');
  assert(near(both.x, both.y) && both.x <= 3.13, `Both: 保持比例, 逐角收紧 (~3.0, 实际 ${both.x.toFixed(3)})`);
  const small = clampScaleToPlayfield({ x: 1.4, y: 1 }, origin, quad, 'x');
  assert(near(small.x, 1.4), '界内倍率不动');
  const shrink = clampScaleToPlayfield({ x: 0.5, y: 0.5 }, origin, quad, 'both');
  assert(near(shrink.x, 0.5) && near(shrink.y, 0.5), '缩小不钳制');
}

section('applyScaleDrag 多物件: 位置缩放 (滑条整体移动), 原点 = 对角锚点, 一次从快照重算');
{
  const bm = bmBase();
  const c1 = circle(1, 200, 100), c2 = circle(2, 300, 200);
  const sl = slider(3, 250, 120, [{ x: 280, y: 120 }], 100);
  bm.hitObjects = [c1, c2, sl];
  const objs = [c1, c2, sl];
  const states = snapshotScaleStates(objs);
  const beginQuad = selectionScaleQuad(objs)!; // v50: 钳制基准 = Begin 盒 (OriginalSurroundingQuad)
  const r = applyScaleDrag(bm, objs, states, { x: 1.4, y: 1 }, { x: 200, y: 150 }, 'x', 4, beginQuad);
  assert(r.changed, '有改动');
  assert(c1.x === 200 && c1.y === 100, '原点侧物件不动');
  assert(c2.x === 340 && c2.y === 200, `c2 x = 200+100*1.4 = 340 (${c2.x})`);
  assert(sl.x === 270 && sl.y === 120 && sl.curvePoints![0].x === 300, `滑条头缩放 + 控制点同步平移 (200+50*1.4=270, ${sl.x},${sl.curvePoints![0].x})`);
  assert(sl.length === 100, '多物件缩放不改滑条长度 (lazer: 路径不缩)');
  assert(r.sliders.includes(3), '返回改动滑条 id');
  // 再次从快照重算 (模拟继续拖动): 不应累积
  applyScaleDrag(bm, objs, states, { x: 1.2, y: 1 }, { x: 200, y: 150 }, 'x', 4, beginQuad);
  assert(c2.x === 320, '从 Begin 快照重算, 不累积 (lazer Update 语义)');
}

section('applyScaleDrag 多物件: 游玩区钳制 + 越界移回');
{
  const bm = bmBase();
  const c1 = circle(1, 200, 100), c2 = circle(2, 300, 200);
  bm.hitObjects = [c1, c2];
  const states = snapshotScaleStates([c1, c2]);
  applyScaleDrag(bm, [c1, c2], states, { x: 5, y: 1 }, { x: 200, y: 150 }, 'x', 4, selectionScaleQuad([c1, c2])!);
  assert(c2.x === 512, `放大钳制在游玩区右缘 (${c2.x})`);
  assert(c1.x === 200 && c1.x >= 0, '左缘不出界');
}

section('applyScaleDrag 单滑条: 控制点绕头缩放 + 节拍吸附; 出界整体回滚 (lazer scaleSlider)');
{
  const bm = bmBase(); // beatLength=500, mult=1 -> vel=0.2px/ms, beatSnap=1 -> tickPx=100
  const sl = slider(1, 100, 100, [{ x: 200, y: 100 }], 100);
  bm.hitObjects = [sl];
  const states = snapshotScaleStates([sl]);
  const r = applyScaleDrag(bm, [sl], states, { x: 2, y: 2 }, { x: 100, y: 100 }, 'both', 1, selectionScaleQuad([sl])!);
  assert(r.changed && sl.x === 100 && sl.y === 100, '原点=头: 头不动');
  assert(sl.curvePoints![0].x === 300 && sl.curvePoints![0].y === 100, `控制点绕头 2x (${sl.curvePoints![0].x})`);
  assert(sl.length === 200, `长度吸附节拍: 几何 200 = 2 tick (${sl.length})`);
  // 出界回滚
  const states2 = snapshotScaleStates([sl]);
  const r2 = applyScaleDrag(bm, [sl], states2, { x: 10, y: 10 }, { x: 100, y: 100 }, 'both', 1, selectionScaleQuad([sl])!);
  assert(!r2.changed, '缩放后出游玩区 -> 回滚');
  assert(sl.x === 100 && sl.curvePoints![0].x === 300 && sl.length === 200, '回滚到 Begin 快照状态');
}

if (failures) { console.error(`\nTESTS_V49_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V49_ALL_PASSED');

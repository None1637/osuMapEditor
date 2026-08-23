// 验证器 v50 纯函数测试: 缩放钳制用 Begin 包围盒 (卡住修复) / 框可见性 / 旋转手柄 (lazer SelectionBoxRotationHandle)
import {
  selectionBoxVisible, rotationHandlePoints, hitRotationHandle, angleDeltaDeg, snapRotation,
  rotationOrigin, applyRotateDrag, snapshotScaleStates, applyScaleDrag, selectionScaleQuad,
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

section('缩放钳制用 Begin 包围盒 (lazer OriginalSurroundingQuad) — 修复"变宽到一定程度卡住"');
{
  const bm = bmBase();
  const c1 = circle(1, 200, 100), c2 = circle(2, 300, 200);
  bm.hitObjects = [c1, c2];
  const objs = [c1, c2];
  const states = snapshotScaleStates(objs);
  const quad = selectionScaleQuad(objs)!; // Begin 时 (200,100,100,100)
  const origin = { x: 200, y: 150 };
  // 第一次拖到 2.0x
  applyScaleDrag(bm, objs, states, { x: 2, y: 1 }, origin, 'x', 4, quad);
  assert(c2.x === 400, `2.0x -> c2.x=400 (${c2.x})`);
  // 继续拖到 3.0x: 钳制仍按 Begin 盒 (宽 100) -> hiX=3.12, 3.0 放行 (旧 bug: 按当前盒宽 200 钳到 1.56 弹回)
  applyScaleDrag(bm, objs, states, { x: 3, y: 1 }, origin, 'x', 4, quad);
  assert(c2.x === 500, `继续拖到 3.0x 不被压回 -> c2.x=500 (${c2.x})`);
  // 拖到 5x: 钳到 3.12 -> 贴右缘
  applyScaleDrag(bm, objs, states, { x: 5, y: 1 }, origin, 'x', 4, quad);
  assert(c2.x === 512, `5x 钳到 3.12 -> c2.x=512 (${c2.x})`);
  // 往回拖仍响应
  applyScaleDrag(bm, objs, states, { x: 2.4, y: 1 }, origin, 'x', 4, quad);
  assert(c2.x === 440, `回拖到 2.4x 正常响应 (${c2.x})`);
}

section('selectionBoxVisible: 仅选中一个单点/转盘不显示框');
{
  assert(!selectionBoxVisible([circle(1, 100, 100)]), '单圆圈 -> 无框');
  assert(!selectionBoxVisible([spinner(1)]), '只选转盘 -> 无框');
  assert(!selectionBoxVisible([circle(1, 100, 100), spinner(2)]), '圆圈+转盘 (可动仅 0x0) -> 无框');
  assert(selectionBoxVisible([slider(1, 100, 100, [{ x: 200, y: 100 }], 100)]), '单滑条 -> 有框');
  assert(selectionBoxVisible([circle(1, 100, 100), circle(2, 200, 200)]), '多选 -> 有框');
}

section('旋转手柄位置/命中 (lazer: 四角外 12.5px, 15px 手柄)');
{
  const dq = { x: 100, y: 50, w: 200, h: 100 };
  const pts = rotationHandlePoints(dq);
  assert(pts.length === 4 && pts[0].x === 87.5 && pts[0].y === 37.5, `tl 手柄在角点外 12.5 (${pts[0].x},${pts[0].y})`);
  assert(pts[3].x === 312.5 && pts[3].y === 162.5, 'br 手柄位置');
  assert(hitRotationHandle(dq, { x: 310, y: 165 }, 8) === 'br', '就近命中 br');
  assert(hitRotationHandle(dq, { x: 200, y: 100 }, 8) === null, '框中心不命中');
}

section('angleDeltaDeg / snapRotation (lazer convertDragEventToAngleOfRotation / applyRotation)');
{
  const o = { x: 0, y: 0 };
  assert(near(angleDeltaDeg(o, { x: 1, y: 0 }, { x: 0, y: 1 }), 90), 'E->S = +90° (y 向下顺时针)');
  assert(near(angleDeltaDeg(o, { x: 1, y: 0 }, { x: -1, y: 0 }), 180), 'E->W = 180°');
  assert(snapRotation(47.7, false) === 48, '无 Shift 取整 48');
  assert(snapRotation(47.7, true) === 45, 'Shift 吸附 15° -> 45');
  assert(snapRotation(190, false) === -170, '归一化 190 -> -170');
  assert(snapRotation(180.4, false) === 180, '-180 归一为 +180');
}

section('rotationOrigin: lazer DefaultOrigin = 物件头部位置 MEC 圆心 (不含控制点)');
{
  const r = rotationOrigin([circle(1, 200, 100), circle(2, 300, 200)]);
  assert(near(r.x, 250) && near(r.y, 150), '两圆圈 -> (250,150)');
  const r2 = rotationOrigin([slider(1, 100, 100, [{ x: 400, y: 400 }], 300), circle(2, 200, 100)]);
  assert(near(r2.x, 150) && near(r2.y, 100), `滑条只取头部 -> (150,100) (${r2.x},${r2.y})`);
}

section('applyRotateDrag: 头绕原点, 控制点绕头 (lazer Update), 从快照重算');
{
  const c1 = circle(1, 300, 100);
  const sl = slider(2, 200, 100, [{ x: 300, y: 100 }], 100);
  const objs = [c1, sl];
  const states = snapshotScaleStates(objs);
  const origin = { x: 200, y: 100 };
  const r = applyRotateDrag(objs, states, 90, origin);
  assert(r.changed && r.sliders.includes(2), 'changed + 滑条 id');
  assert(c1.x === 200 && c1.y === 200, `c1 (300,100) 绕 (200,100) 转 90° -> (200,200) (${c1.x},${c1.y})`);
  assert(sl.x === 200 && sl.y === 100, '原点上的滑条头不动');
  assert(sl.curvePoints![0].x === 200 && sl.curvePoints![0].y === 200, `控制点绕头转 -> (200,200) (${sl.curvePoints![0].x},${sl.curvePoints![0].y})`);
  assert(sl.length === 100, '旋转不改长度');
  // 从快照重算不累积
  applyRotateDrag(objs, states, 45, origin);
  const expect = { x: 200 + 100 * Math.SQRT1_2, y: 100 + 100 * Math.SQRT1_2 };
  assert(near(c1.x, Math.round(expect.x), 1) && near(c1.y, Math.round(expect.y), 1), `45° 从快照重算 (${c1.x},${c1.y})`);
}

if (failures) { console.error(`\nTESTS_V50_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V50_ALL_PASSED');

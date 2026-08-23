// 验证器 v55 纯函数测试: 物件吸附 (lazer TrySnapToNearbyObjects) + 间距 px 显示
import { OBJECT_SNAP_RADIUS, objectSnapPoints, snapToNearby, snapDragDelta } from '../../src/osu/objectSnap';
import { selectionSpacingInfo } from '../../src/osu/spacing';
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
const circle = (id: number, x: number, y: number, time: number): HitObject =>
  ({ id, type: 'circle', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject);
const slider = (id: number, x: number, y: number, cps: { x: number; y: number }[], length: number, slides: number, time: number): HitObject =>
  ({ id, type: 'slider', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0, curveType: 'L', curvePoints: cps, length, slides } as unknown as HitObject);

section('常量: 吸附半径 = 6.4 osu px (lazer OBJECT_RADIUS 64 * 0.10)');
assert(OBJECT_SNAP_RADIUS === 6.4, `6.4 (实际 ${OBJECT_SNAP_RADIUS})`);

section('objectSnapPoints: 单点 -> 中心; 滑条 -> 头 + 尾 (偶数折返尾在头)');
{
  const bm = bmBase();
  const pts = objectSnapPoints(bm, [circle(1, 200, 100, 1000)]);
  assert(pts.length === 1 && pts[0].x === 200 && pts[0].y === 100, `单点 1 个目标点 (${pts.length})`);
  const s1 = objectSnapPoints(bm, [slider(2, 150, 300, [{ x: 350, y: 300 }], 200, 1, 2000)]);
  assert(s1.length === 2 && s1[1].x === 350 && s1[1].y === 300, `1 折返尾 (350,300) (实际 ${JSON.stringify(s1[1])})`);
  const s2 = objectSnapPoints(bm, [slider(3, 150, 300, [{ x: 350, y: 300 }], 200, 2, 2000)]);
  assert(s2.length === 2 && s2[1].x === 150 && s2[1].y === 300, `2 折返尾回头 (150,300) (实际 ${JSON.stringify(s2[1])})`);
}

section('snapToNearby: < 6.4 吸附最近点, >= 6.4 不吸 (严格小于)');
{
  const targets = [{ x: 200, y: 100 }, { x: 400, y: 300 }];
  const hit = snapToNearby({ x: 205, y: 103 }, targets); // dist 5.83
  assert(hit !== null && hit.x === 200 && hit.y === 100, `5.83 -> 吸附 (200,100)`);
  assert(snapToNearby({ x: 207, y: 100 }, targets) === null, `7.0 -> 不吸`);
  assert(snapToNearby({ x: 206.4, y: 100 }, targets) === null, `恰 6.4 -> 不吸 (严格小于)`);
  const near2 = snapToNearby({ x: 396, y: 300 }, targets); // 离 (400,300) 更近
  assert(near2 !== null && near2.x === 400, `取最近目标 (400,300)`);
}

section('snapDragDelta: 被拖点+位移试探, 命中修正位移使该点与目标重合');
{
  const dragPts = [{ x: 300, y: 200 }];
  const targets = [{ x: 200, y: 100 }];
  assert(snapDragDelta(dragPts, targets, -94, -97) === null, `候选 (206,103) dist 6.7 -> 不吸`);
  const corr = snapDragDelta(dragPts, targets, -95, -97); // 候选 (205,103) dist 5.83
  assert(corr !== null && corr.dx === -100 && corr.dy === -100, `修正位移 (-100,-100) 落 (200,100) (实际 ${JSON.stringify(corr)})`);
  // 多个被拖点: 最近的一对胜出
  const corr2 = snapDragDelta([{ x: 300, y: 200 }, { x: 500, y: 400 }], [{ x: 200, y: 100 }], -95, -97);
  assert(corr2 !== null && corr2.dx === -100 && corr2.dy === -100, `多点取最近对`);
}

section('selectionSpacingInfo: prevPx/nextPx 原始 osu 像素距离 (v55)');
{
  const bm = bmBase();
  bm.hitObjects = [circle(1, 100, 100, 1000), circle(2, 220, 100, 2000), circle(3, 460, 100, 3000)];
  const sel2 = selectionSpacingInfo(bm, new Set([2]))!;
  // prev: dist 120, 间隔 2 拍 -> 120/(1*100*2) = 0.6x
  assert(sel2.prev !== null && Math.abs(sel2.prev - 0.6) < 1e-9 && sel2.prevPx === 120, `Prev 0.60x(120px) (实际 ${sel2.prev}x/${sel2.prevPx}px)`);
  assert(sel2.next !== null && Math.abs(sel2.next - 1.2) < 1e-9 && sel2.nextPx === 240, `Next 1.20x(240px) (实际 ${sel2.next}x/${sel2.nextPx}px)`);
  const sel1 = selectionSpacingInfo(bm, new Set([1]))!;
  assert(sel1.prev === null && sel1.prevPx === null, `首件无 Prev`);
}

if (failures) { console.error(`\nTESTS_V55_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V55_ALL_PASSED');

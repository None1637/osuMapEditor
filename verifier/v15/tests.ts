// v15 单元断言: computePendingPath (lazer SliderPlacementBlueprint 对齐)
import { computePendingPath, inferSegmentType, type PendingPoint } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function near(a: number, b: number, eps: number, msg: string) {
  assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b}±${eps})`);
}
const P = (x: number, y: number, redAnchor = false): PendingPoint => ({ x, y, redAnchor });

// ---- inferSegmentType: lazer updatePathType — 段内 1~2 点 L, 3 点 P, 4+ B ----
assert(inferSegmentType(1) === 'L', '1点 -> L');
assert(inferSegmentType(2) === 'L', '2点 -> L');
assert(inferSegmentType(3) === 'P', '3点 -> P');
assert(inferSegmentType(4) === 'B', '4点 -> B');
assert(inferSegmentType(7) === 'B', '7点 -> B');

// ---- 两点直线: 长度 = 几何距离 (不再强制一拍长) ----
{
  const r = computePendingPath([P(0, 0), P(100, 0)], null);
  assert(r.curveType === 'L', '两点 curveType=L');
  assert(r.controlPoints.length === 2, '两点 controlPoints=2');
  near(r.length, 100, 1, '两点长度=几何距离');
  assert(r.raw.length >= 2, '两点 raw 非空');
}

// ---- 三点无红点 -> P ----
{
  const r = computePendingPath([P(0, 0), P(50, 50), P(100, 0)], null);
  assert(r.curveType === 'P', '三点 curveType=P');
  assert(r.controlPoints.length === 3, '三点 controlPoints=3');
  assert(r.length > 100, '三点圆弧长度 > 弦长');
}

// ---- 四点无红点 -> B, 长度为路径几何全长且有限 ----
{
  const r = computePendingPath([P(0, 0), P(30, 40), P(70, 40), P(100, 0)], null);
  assert(r.curveType === 'B', '四点 curveType=B');
  assert(r.controlPoints.length === 4, '四点 controlPoints=4');
  assert(Number.isFinite(r.length) && r.length > 50, '四点 B 长度有限且非零');
}

// ---- 红点分段: 控制点加倍 + curveType=B + 路径经过红点 + 长度=两段之和 ----
{
  const r = computePendingPath([P(0, 0), P(60, 0, true), P(60, 80)], null);
  assert(r.curveType === 'B', '有红点 curveType=B');
  assert(r.controlPoints.length === 4, '红点加倍: controlPoints=4');
  assert(r.controlPoints[1].x === 60 && r.controlPoints[2].x === 60
    && r.controlPoints[1].y === 0 && r.controlPoints[2].y === 0, '加倍的点是红点本身');
  near(r.length, 140, 1, '长度=两段几何长度之和');
  // raw 路径在红点处衔接 (段间共享点只出现一次)
  const joint = r.raw.filter(p => p.x === 60 && p.y === 0);
  assert(joint.length === 1, 'raw 在红点处恰好衔接一次');
}

// ---- 末尾红点不加倍 (lazer: 红点标记作用于后续段) ----
{
  const r = computePendingPath([P(0, 0), P(50, 50), P(100, 0, true)], null);
  assert(r.controlPoints.length === 3, '末尾红点不加倍');
  assert(r.curveType === 'B', '有红点(含末尾) curveType=B');
}

// ---- cursor 幻影点: 预览含 cursor, 导出 (finishSlider) 不含 ----
{
  const pend = [P(0, 0)];
  const withCursor = computePendingPath(pend, { x: 120, y: 0 });
  near(withCursor.length, 120, 1, '幻影点参与预览长度');
  assert(withCursor.controlPoints.length === 1, '幻影点不进 controlPoints');
  const noCursor = computePendingPath(pend, null);
  assert(noCursor.length === 0 && noCursor.raw.length === 0, '单点无 cursor 无路径');
  // 贴近末点的 cursor 不产生幻影点 (防抖)
  const nearCursor = computePendingPath([P(0, 0), P(50, 0)], { x: 51, y: 1 });
  near(nearCursor.length, 50, 1, '贴近末点的 cursor 被忽略');
}

if (failures) { console.error(`v15 tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('v15 tests.ts: computePendingPath 全部断言通过');

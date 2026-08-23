// v25 单元断言: 已建滑条节点编辑纯函数 (插入/删除/白红切换/curveType 解析)
import {
  nearestOnSegment, insertSliderPoint, deleteSliderPoint, toggleSliderPointRed,
  resolveSliderCurveType, isRedPairPoint, hasRedPair,
} from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function eqPts(a: { x: number; y: number }[], b: [number, number][], msg: string) {
  assert(a.length === b.length && a.every((p, i) => p.x === b[i][0] && p.y === b[i][1]),
    `${msg} (got ${JSON.stringify(a.map(p => [p.x, p.y]))}, want ${JSON.stringify(b)})`);
}

// ---- nearestOnSegment: 中点投影 t=0.5, 端点外钳制 ----
{
  const n = nearestOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 });
  assert(n.t === 0.5 && n.x === 50 && n.y === 0 && n.dist === 30, '线段中点投影');
  const n2 = nearestOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 10 });
  assert(n2.t === 1 && n2.x === 100, '投影钳制到端点 (t=1)');
}

// ---- 插入: 线段中点插入下标正确 (头部是 pts[0]) ----
{
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }];
  const r = insertSliderPoint(pts, 0, 0.5); // 头 -> 第二个点 之间
  eqPts(r, [[100, 100], [200, 100], [300, 100], [300, 300]], '线段 0 中点插入到 ctrl 下标 1');
  const r2 = insertSliderPoint(pts, 1, 0.25);
  eqPts(r2, [[100, 100], [300, 100], [300, 150], [300, 300]], '线段 1 t=0.25 插入到 ctrl 下标 2');
  assert(!isRedPairPoint(r, 1) && !hasRedPair(r), '插入的是白色节点 (不产生重复对)');
}

// ---- 删除普通点 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }];
  eqPts(deleteSliderPoint(pts, 1)!, [[100, 100], [300, 300]], '删除普通中间点');
}

// ---- 删除红锚点: 成对删除 (命中对中任意一个) ----
{
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
  eqPts(deleteSliderPoint(pts, 2)!, [[100, 100], [300, 300]], '删红点对 (命中对中第二个)');
  eqPts(deleteSliderPoint(pts, 1)!, [[100, 100], [300, 300]], '删红点对 (命中对中第一个)');
}

// ---- 删除保护: 头部不可删; 两点下限 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
  assert(deleteSliderPoint(pts, 0) === null, '头部 (index 0) 不可删');
  assert(deleteSliderPoint(pts, 1) === null, '删到只剩 1 个点不可删 (至少头部+1 曲线点)');
  const withRed = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 200 }];
  assert(deleteSliderPoint(withRed, 1) === null, '删红点对后只剩 1 个点: 不可删');
}

// ---- 白->红: 复制相同坐标点插入其后 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
  const r = toggleSliderPointRed(pts, 1)!;
  eqPts(r, [[100, 100], [200, 200], [200, 200], [300, 300]], '白->红: 形成连续重复对');
  assert(hasRedPair(r) && isRedPairPoint(r, 1) && isRedPairPoint(r, 2), '重复对两个点都算红对成员');
}

// ---- 红->白: 重复对合并成一个点 (命中对中任意一个) ----
{
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
  eqPts(toggleSliderPointRed(pts, 2)!, [[100, 100], [200, 200], [300, 300]], '红->白 (命中对中第二个)');
  eqPts(toggleSliderPointRed(pts, 1)!, [[100, 100], [200, 200], [300, 300]], '红->白 (命中对中第一个)');
}

// ---- 切换保护: 头部不可切换 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
  assert(toggleSliderPointRed(pts, 0) === null, '头部不可切换红/白');
}

// ---- curveType 解析: 红点 -> 'B'; P 点数不符降级; 合法类型保持 ----
{
  const two = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const three = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  const four = [...three, { x: 150, y: 50 }];
  const red = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  assert(resolveSliderCurveType(red, 'P') === 'B', '有红点 -> B');
  assert(resolveSliderCurveType(three, 'P') === 'P', 'P 恰好 3 点保持 P');
  assert(resolveSliderCurveType(four, 'P') === 'B', 'P 变 4 点降级 B');
  assert(resolveSliderCurveType(two, 'P') === 'L', 'P 变 2 点降级 L');
  assert(resolveSliderCurveType(three, 'B') === 'B', 'B 3 点保持 B');
  assert(resolveSliderCurveType(two, 'L') === 'L', 'L 2 点保持 L');
  assert(resolveSliderCurveType(four, 'C') === 'C', 'C 保持 C');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

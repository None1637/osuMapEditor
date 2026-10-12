// v400 单元断言: 右键删除滑条头节点 (lazer 语义: 下一个控制点变新头)
import { deleteSliderPoint } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function eqPts(a: { x: number; y: number }[], b: [number, number][], msg: string) {
  assert(a.length === b.length && a.every((p, i) => p.x === b[i][0] && p.y === b[i][1]),
    `${msg} (got ${JSON.stringify(a.map(p => [p.x, p.y]))}, want ${JSON.stringify(b)})`);
}

// ---- 删头: 下一点变新头 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }];
  eqPts(deleteSliderPoint(pts, 0)!, [[300, 100], [300, 300]], '删头: 3 点 -> 2 点, 原 pts[1] 成新头');
  const four = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 }];
  eqPts(deleteSliderPoint(four, 0)!, [[50, 50], [100, 0], [150, 50]], '删头: 4 点 -> 3 点');
}

// ---- 头部成对 (pts[0]==pts[1]): 只删单点, 同坐标点留作新头 (几何起点不变) ----
{
  const headRed = [{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
  eqPts(deleteSliderPoint(headRed, 0)!, [[100, 100], [300, 300]], '头部成对只删单点');
}

// ---- 下限保护: 删后不足 2 点不可删 ----
{
  const two = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
  assert(deleteSliderPoint(two, 0) === null, '2 点滑条删头不可删 (删后只剩 1 点)');
  const one = [{ x: 100, y: 100 }];
  assert(deleteSliderPoint(one, 0) === null, '单点不可删');
  assert(deleteSliderPoint(two, -1) === null, '负下标不可删');
  assert(deleteSliderPoint(two, 5) === null, '越界下标不可删');
}

// ---- 非头部行为不变 ----
{
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
  eqPts(deleteSliderPoint(pts, 2)!, [[100, 100], [300, 300]], '红点对仍成对删除 (命中对中第二个)');
  eqPts(deleteSliderPoint(pts, 1)!, [[100, 100], [300, 300]], '红点对仍成对删除 (命中对中第一个)');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

// v408 单元断言: 锚点复制/粘贴插入 (insertAnchorGroup 纯函数)
import { insertAnchorGroup } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function eqPts(a: { x: number; y: number }[], b: [number, number][], msg: string) {
  assert(a.length === b.length && a.every((p, i) => p.x === b[i][0] && p.y === b[i][1]),
    `${msg} (got ${JSON.stringify(a.map(p => [p.x, p.y]))}, want ${JSON.stringify(b)})`);
}

// ---- 基本插入: 段后整组, 顺序保留 ----
{
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const group = [{ x: 50, y: 0 }, { x: 50, y: 50 }];
  eqPts(insertAnchorGroup(pts, 0, group), [[0, 0], [50, 0], [50, 50], [100, 0], [100, 100]], '段0后插入整组');
  eqPts(insertAnchorGroup(pts, 1, group), [[0, 0], [100, 0], [50, 0], [50, 50], [100, 100]], '段1后插入整组');
}
// ---- 红锚点重复对原样保留 ----
{
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const redPairGroup = [{ x: 30, y: 30 }, { x: 30, y: 30 }, { x: 60, y: 60 }];
  eqPts(insertAnchorGroup(pts, 0, redPairGroup), [[0, 0], [30, 30], [30, 30], [60, 60], [100, 0]], '组内红对保留');
}
// ---- 下标钳制 ----
{
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const g = [{ x: 1, y: 1 }];
  eqPts(insertAnchorGroup(pts, -5, g), [[0, 0], [1, 1], [100, 0]], '负下标钳到段0');
  eqPts(insertAnchorGroup(pts, 99, g), [[0, 0], [100, 0], [1, 1]], '超界下标钳到末段后');
}
// ---- 不改原数组 ----
{
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const g = [{ x: 1, y: 1 }];
  insertAnchorGroup(pts, 0, g);
  assert(pts.length === 2 && g.length === 1, '入参数组不被修改');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

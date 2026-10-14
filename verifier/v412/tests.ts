// v412 单元断言: 手绘滑条共线折叠 (collinearLinePoints 纯函数)
import { collinearLinePoints } from '../../src/osu/freehand/freehandFit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// ---- 直线拖动 (中间点共线) → 折叠为 头+尾 ----
{
  const out = collinearLinePoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }]);
  assert(out !== null && out.length === 2 && out[0].x === 0 && out[1].x === 300, '完全共线 → [首,尾]');
}
// ---- 微小抖动 (容差 3px 内) 仍折叠 ----
{
  const out = collinearLinePoints([{ x: 0, y: 0 }, { x: 100, y: 2 }, { x: 200, y: -2 }, { x: 300, y: 0 }]);
  assert(out !== null && out.length === 2, '±2px 抖动 → 仍折叠');
}
// ---- 超容差抖动 / 明显曲线 → null ----
{
  assert(collinearLinePoints([{ x: 0, y: 0 }, { x: 100, y: 5 }, { x: 300, y: 0 }]) === null, '5px 偏离 → null');
  assert(collinearLinePoints([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }]) === null, '明显弧形 → null');
}
// ---- 斜线也共线 ----
{
  const out = collinearLinePoints([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }]);
  assert(out !== null && out.length === 2 && out[1].y === 100, '45° 斜线 → 折叠');
}
// ---- 两点输入 (短直线拖) 直接折叠 ----
{
  const out = collinearLinePoints([{ x: 10, y: 10 }, { x: 50, y: 60 }]);
  assert(out !== null && out.length === 2, '两点 → 折叠');
}
// ---- 退化: 首尾重合 / 单点 → null ----
{
  assert(collinearLinePoints([{ x: 5, y: 5 }, { x: 5, y: 5 }]) === null, '首尾重合 → null');
  assert(collinearLinePoints([{ x: 5, y: 5 }]) === null, '单点 → null');
}
// ---- 不改入参 ----
{
  const ctrl = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  collinearLinePoints(ctrl);
  assert(ctrl.length === 3, '入参不被修改');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

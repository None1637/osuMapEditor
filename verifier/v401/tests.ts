// v401 单元断言: Alt+点选锚点同坐标整组切换 (修复太密红锚点框选后点选取消不掉)
import { altNodeToggleGroup } from '../../src/osu/sliderPath';
import { nearestNode, nodesInRect } from '../../src/osu/nodeSelection';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function eqArr(a: number[], b: number[], msg: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got [${a}], want [${b}])`);
}

type Pt = { x: number; y: number };

// ---- altNodeToggleGroup: 返回需要 toggle 的下标 ----
{
  // 普通白点: 组只有自己
  const pts: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
  eqArr(altNodeToggleGroup(pts, 1, () => false), [1], '白点未选 → 选中自己');
  eqArr(altNodeToggleGroup(pts, 1, j => j === 1), [1], '白点已选 → 取消自己');

  // 红锚点对: 整对切换 (v309 语义保留)
  const pair: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
  eqArr(altNodeToggleGroup(pair, 1, () => false), [1, 2], '红对未选 → 整对加入');
  eqArr(altNodeToggleGroup(pair, 2, () => true), [1, 2], '红对已全选 → 整对取消');
  eqArr(altNodeToggleGroup(pair, 1, j => j === 1), [2], '红对部分选中 → 先补齐 (再点即整对取消)');

  // 三连相同坐标 (太密红锚点): 三个下标整组
  const tri: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
  eqArr(altNodeToggleGroup(tri, 1, () => true), [1, 2, 3], '三连全选 → 整组取消');
  eqArr(altNodeToggleGroup(tri, 1, () => false), [1, 2, 3], '三连未选 → 整组加入');

  // 两对同坐标重合: 四个下标整组
  const quad: Pt[] = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }];
  eqArr(altNodeToggleGroup(quad, 2, () => true), [2, 3, 4, 5], '双对重合全选 → 整组取消');
}

// ---- 端到端模拟: 框选 → 连点同一坐标 4 次, 该坐标必能在第一次点掉, 且再点加回, 再点又点掉 ----
{
  const mkSlider = (id: number, pts: Pt[]) => ({
    id, type: 'slider' as const, x: pts[0].x, y: pts[0].y, time: 0, hitSound: 0,
    newCombo: false, comboSkip: 0, curveType: 'B', curvePoints: pts.slice(1), slides: 1, length: 100,
  });
  const run = (name: string, pts: Pt[], clickPos: Pt) => {
    const s = mkSlider(1, pts);
    const sel = new Set<number>();
    for (const [, idx] of nodesInRect([s as any], new Map() as any, { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 })) sel.add(idx);
    const group = pts.map((q, j) => q.x === clickPos.x && q.y === clickPos.y ? j : -1).filter(j => j >= 0);
    const groupSel = () => group.filter(j => sel.has(j)).length;
    const trace: number[] = [];
    for (let k = 0; k < 4; k++) {
      const hit = nearestNode([s as any], new Map() as any, clickPos)!;
      for (const j of altNodeToggleGroup(pts, hit.idx, jj => sel.has(jj))) {
        if (sel.has(j)) sel.delete(j); else sel.add(j);
      }
      trace.push(groupSel());
    }
    assert(JSON.stringify(trace) === JSON.stringify([0, group.length, 0, group.length]),
      `${name}: 连点 4 次该坐标选中数 0->满->0->满 稳定交替 (got [${trace}])`);
  };
  run('单红对', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }], { x: 100, y: 100 });
  run('三连', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }], { x: 100, y: 100 });
  run('双对重合', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }], { x: 100, y: 100 });
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

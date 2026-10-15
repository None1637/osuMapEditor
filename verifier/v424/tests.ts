// v424 数值测试: 批量删除滑条锚点 — deleteSliderPoints 纯函数 + withRedPartners 整组展开
import { deleteSliderPoints } from '../../src/osu/sliderPath';
import { withRedPartners } from '../../src/osu/nodeSelection';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 100, y: 100 }));
const same = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

// 批量删中间点
{
  const p = pts(6);
  const out = deleteSliderPoints(p, [2, 3])!;
  assert(out.length === 4 && out[0].x === 0 && out[1].x === 100 && out[2].x === 400, '删中间两点');
}
// 含头点: 剩余首点变新头
{
  const out = deleteSliderPoints(pts(4), [0])!;
  assert(out.length === 3 && out[0].x === 100, '删头 → 下一点成新头');
}
// 含尾点
{
  const out = deleteSliderPoints(pts(4), [3])!;
  assert(out.length === 3 && out[2].x === 200, '删尾 → 前一点成新尾');
}
// 头尾同删
{
  const out = deleteSliderPoints(pts(5), [0, 4])!;
  assert(out.length === 3 && out[0].x === 100 && out[2].x === 300, '头尾同删');
}
// 红配对整组删 (同坐标重复对两个下标都给 → 整组消失)
{
  const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
  const out = deleteSliderPoints(p, [1, 2])!;
  assert(out.length === 3 && out[1].x === 200, '红配对整组删');
}
// 剩余 <2 → null (调用方删整物件)
{
  assert(deleteSliderPoints(pts(3), [0, 1]) === null, '3 点删 2 → null');
  assert(deleteSliderPoints(pts(2), [0]) === null, '2 点删 1 → null');
  assert(deleteSliderPoints(pts(3), [0, 1, 2]) === null, '全删 → null');
}
// 越界下标忽略 / 空集返回等长副本
{
  const out = deleteSliderPoints(pts(3), [5, -1])!;
  assert(out.length === 3, '越界下标忽略');
  const p = pts(3);
  const cp = deleteSliderPoints(p, [])!;
  assert(cp.length === 3 && cp !== p && same(cp, p), '空集返回等长副本');
}
// 不改入参
{
  const p = pts(4);
  const snapshot = p.map(q => ({ ...q }));
  deleteSliderPoints(p, [1, 2]);
  assert(same(p, snapshot), '不改入参');
}

// withRedPartners 整组展开 (选中对中一个 → 删除集含整组)
{
  const slider = { id: 1, type: 'slider', x: 0, y: 0, time: 1000, curveType: 'B',
    curvePoints: [{ x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], slides: 1, length: 300 } as unknown as HitObject;
  const bm = { hitObjects: [slider] } as unknown as Beatmap;
  const sel = withRedPartners(bm, new Map([[1, new Set([1])]]));
  assert(sel.get(1)!.size === 2 && sel.get(1)!.has(1) && sel.get(1)!.has(2), '选对中一个 → 展开整组');
  // 整组删后剩头+尾 = 2 点合法
  const ctrl = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  const out = deleteSliderPoints(ctrl, sel.get(1)!)!;
  assert(out.length === 2 && out[1].x === 200, '整组删后剩头尾');
}

if (failures) { console.error(`\nV424_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV424_TESTS_PASSED');

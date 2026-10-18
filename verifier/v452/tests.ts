// v452 单元断言: 滑条锚点命中半径 = 显示尺寸 (anchorHitRadius / nearestNode)
//   stable 样式 = 屏幕固定 ~8px 方格内切圆 4/k (k = 设备px/osu单位); lazer = 头 r7 / 其余 r6 (osu 单位固定)
import { anchorHitRadius, nearestNode } from '../../src/osu/nodeSelection';
import { displaySettings } from '../../src/osu/displaySettings';
import type { HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const slider = (id: number, x: number, y: number, curvePoints: { x: number; y: number }[]): HitObject => ({
  id, type: 'slider', x, y, time: id * 1000, curveType: 'L', curvePoints, slides: 1, length: 100,
} as HitObject);
const NO_OFF = new Map<number, { dx: number; dy: number }>();

const origStyle = displaySettings.sliderPointStyle;
try {
  // ---- stable: 半径 = 4/k (方格 8/k 总宽的内切圆, 宁小勿大) ----
  displaySettings.sliderPointStyle = 'stable';
  assert(anchorHitRadius(true, 2) === 2 && anchorHitRadius(false, 2) === 2, 'stable: k=2 → 半径 2 (头尾同宽)');
  assert(anchorHitRadius(true, 1) === 4 && anchorHitRadius(false, 0.5) === 8, 'stable: 半径随 k 反比 (4/k)');
  assert(anchorHitRadius(true, 0) === 4, 'stable: k=0 兜底 ||1 (与 renderer hypot||1 同款)');

  // ---- lazer: osu 单位固定, 头 r7 / 其余 r6, 与 k 无关 ----
  displaySettings.sliderPointStyle = 'lazer';
  assert(anchorHitRadius(true, 2) === 7 && anchorHitRadius(true, 99) === 7, 'lazer: 头 r7 (与 k 无关)');
  assert(anchorHitRadius(false, 2) === 6 && anchorHitRadius(false, 99) === 6, 'lazer: 非头 r6 (与 k 无关)');

  // ---- nearestNode: 按节点各自半径判定 ----
  // stable, k=2 → 半径 2; 头 (100,100), A (110,100)
  displaySettings.sliderPointStyle = 'stable';
  {
    const s = slider(1, 100, 100, [{ x: 110, y: 100 }]);
    const hit = nearestNode([s], NO_OFF, { x: 111.5, y: 100 }, 2);
    assert(hit?.objId === 1 && hit.idx === 1, 'stable k=2: 距 A 1.5 ≤ 2 命中 A');
    assert(nearestNode([s], NO_OFF, { x: 103, y: 100 }, 2) === null, 'stable k=2: 距头 3 > 2 不命中 (旧固定 10 会误中)');
  }
  // lazer: 头 7 / 非头 6 — 距头 6.5 命中头, 距非头 6.5 不命中
  displaySettings.sliderPointStyle = 'lazer';
  {
    const s = slider(2, 100, 100, [{ x: 300, y: 100 }]);
    const hitHead = nearestNode([s], NO_OFF, { x: 106.5, y: 100 }, 1);
    assert(hitHead?.idx === 0, 'lazer: 距头 6.5 ≤ 7 命中头');
    assert(nearestNode([s], NO_OFF, { x: 293.5, y: 100 }, 1) === null, 'lazer: 距非头 6.5 > 6 不命中');
  }
  // 语义保留: 跨滑条最近优先, 并列取序号在前 (两滑条同坐标点, 数组前者胜; 同滑条红对同坐标, 下标小者胜)
  displaySettings.sliderPointStyle = 'stable';
  {
    const a = slider(3, 200, 200, [{ x: 250, y: 200 }]);
    const b = slider(4, 200, 200, [{ x: 260, y: 200 }]);
    const tie = nearestNode([a, b], NO_OFF, { x: 200, y: 200 }, 2);
    assert(tie?.objId === 3 && tie.idx === 0, '并列: 数组在前滑条胜');
    const red = slider(5, 400, 100, [{ x: 450, y: 100 }, { x: 450, y: 100 }, { x: 500, y: 150 }]);
    const tieRed = nearestNode([red], NO_OFF, { x: 450, y: 100 }, 2);
    assert(tieRed?.objId === 5 && tieRed.idx === 1, '红锚点重复对并列: 下标小者胜 (倒序绘制上层)');
    const near = nearestNode([a, b], NO_OFF, { x: 249, y: 200 }, 2); // a.A d=1 vs b 头 d=49
    assert(near?.objId === 3 && near.idx === 1, '跨滑条最近优先');
  }
} finally {
  displaySettings.sliderPointStyle = origStyle;
}

if (failures) { console.error(`\n${failures} 个断言失败`); process.exit(1); }
console.log('\nv452 纯函数全部通过');

// 验证器 v52 纯函数测试: 显示用选中框 = 路径实体盒 (lazer blueprint SelectionQuad union + INFLATE 5)
// 背景: 旧显示盒 = 控制点盒 ± 半径, 三点圆弧 (P) 的弧身鼓出控制点范围却不在框内;
//   lazer SliderSelectionBlueprint.SelectionQuad = SliderBodyPiece (整条路径含半径) ∪ 头/尾圆 ∪ 控制点手柄
import { selectionDisplayQuad, SELECTION_BOX_INFLATE } from '../../src/osu/selectionBox';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;

const bmBase = (): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap);
const circle = (id: number, x: number, y: number): HitObject =>
  ({ id, type: 'circle', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject);
const slider = (id: number, x: number, y: number, cps: { x: number; y: number }[], length: number, type = 'L'): HitObject =>
  ({ id, type: 'slider', x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0, curveType: type, curvePoints: cps, length, slides: 1 } as unknown as HitObject);
const R = 36.48; // CS4 半径; 显示盒外扩 = R + 5

section('常量: INFLATE = 5 (lazer SelectionHandler.INFLATE_SIZE)');
assert(SELECTION_BOX_INFLATE === 5, `INFLATE=5 (${SELECTION_BOX_INFLATE})`);

section('selectionDisplayQuad: 单圆圈 = 位置 ± (半径+5)');
{
  const bm = bmBase();
  const q = selectionDisplayQuad(bm, [circle(1, 200, 100)], R)!;
  assert(near(q.x, 200 - R - 5) && near(q.y, 100 - R - 5), `左上 (${q.x.toFixed(1)},${q.y.toFixed(1)})`);
  assert(near(q.w, (R + 5) * 2) && near(q.h, (R + 5) * 2), `尺寸 ${q.w.toFixed(1)}x${q.h.toFixed(1)}`);
}

section('selectionDisplayQuad: P 滑条 (三点圆弧) 包住弧身鼓出 — 不只包控制点 (v52 修复)');
{
  const bm = bmBase();
  // A(150,200) B(350,200) C(250,300): 圆心 (250,200) r=100, 270° 主弧经顶部 (250,100)
  const sl = slider(1, 150, 200, [{ x: 350, y: 200 }, { x: 250, y: 300 }], 471, 'P');
  const q = selectionDisplayQuad(bm, [sl], R)!;
  // 控制点盒顶 = 200; 弧顶 = 100 -> 显示盒顶 = 100-(R+5) ≈ 58.5 (旧实现 158.5, 弧身露出框外)
  assert(near(q.y, 100 - R - 5, 2), `框顶包住弧顶 (${q.y.toFixed(1)} ≈ 58.5)`);
  assert(near(q.x, 150 - R - 5, 2) && near(q.x + q.w, 350 + R + 5, 2), `左右缘 (${q.x.toFixed(1)}, ${(q.x + q.w).toFixed(1)})`);
  assert(near(q.y + q.h, 300 + R + 5, 2), `底缘 (${(q.y + q.h).toFixed(1)})`);
}

section('selectionDisplayQuad: L 滑条 + 圆圈 union; 转盘排除');
{
  const bm = bmBase();
  const sl = slider(2, 300, 300, [{ x: 400, y: 300 }], 100);
  const sp = { id: 3, type: 'spinner', x: 256, y: 192, time: 1000, endTime: 2000, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject;
  const q = selectionDisplayQuad(bm, [circle(1, 200, 100), sl, sp], R)!;
  assert(near(q.x, 200 - R - 5) && near(q.y, 100 - R - 5), `左上 (${q.x.toFixed(1)},${q.y.toFixed(1)})`);
  assert(near(q.x + q.w, 400 + R + 5) && near(q.y + q.h, 300 + R + 5), `右下 (${(q.x + q.w).toFixed(1)},${(q.y + q.h).toFixed(1)}) — 转盘不计入`);
}

if (failures) { console.error(`\nTESTS_V52_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V52_ALL_PASSED');

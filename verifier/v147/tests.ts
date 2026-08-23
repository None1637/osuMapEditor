// 验证器 v147 纯函数测试: 「打击动画」开关 — 关 = 命中后不放大, 原大小残留 800ms 渐隐 (stable 编辑器同款)
import { displaySettings, setDisplayFlag } from '../../src/osu/displaySettings';
import { alphaAt, isVisibleAt, HIT_FADE, HIT_LINGER } from '../../src/osu/lifecycle';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) < eps; }

const bmBase = (): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap);
const circle = (id: number, time: number): HitObject =>
  ({ id, type: 'circle', x: 100, y: 100, time, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject);
const slider = (id: number, time: number): HitObject =>
  ({ id, type: 'slider', x: 100, y: 100, time, hitSound: 0, newCombo: false, comboSkip: 0, curveType: 'L', curvePoints: [{ x: 200, y: 100 }], length: 100, slides: 1 } as unknown as HitObject);
// slider: 100px @100px/拍(500ms) = 500ms 时长

const bm = bmBase();
const c = circle(1, 1000);
const s = slider(2, 1000);

section('常量');
{
  assert(HIT_FADE === 240, `HIT_FADE=240 (实际 ${HIT_FADE})`);
  assert(HIT_LINGER === 800, `HIT_LINGER=800 (实际 ${HIT_LINGER})`);
  assert(displaySettings.hitAnimation === true, '打击动画默认开');
}

section('默认 (点击特效开 + 打击动画开): 维持 lazer 240ms 淡出');
{
  assert(near(alphaAt(bm, c, 1000 + 120), 0.5), `命中后 120ms alpha=0.5 (实际 ${alphaAt(bm, c, 1120)})`);
  assert(alphaAt(bm, c, 1000 + 240) === 0, '240ms 后消失');
  assert(isVisibleAt(bm, c, 1000 + 240) && !isVisibleAt(bm, c, 1000 + 241), '可见窗口 = 命中 + 240ms');
}

section('关打击动画: 残留 800ms 线性渐隐');
{
  setDisplayFlag('hitAnimation', false);
  assert(near(alphaAt(bm, c, 1000 + 400), 0.5), `命中后 400ms alpha=0.5 (实际 ${alphaAt(bm, c, 1400)})`);
  assert(near(alphaAt(bm, c, 1000 + 200), 0.75), `命中后 200ms alpha=0.75 (实际 ${alphaAt(bm, c, 1200)})`);
  assert(alphaAt(bm, c, 1000 + 800) === 0, '800ms 后消失');
  assert(isVisibleAt(bm, c, 1000 + 799) && !isVisibleAt(bm, c, 1000 + 801), '可见窗口延长到命中 + 800ms');
  // 滑条不受打击动画开关影响 (仍走 240ms 渐出)
  assert(near(alphaAt(bm, s, 1500 + 120), 0.5), `滑条结束 +120ms alpha=0.5 (实际 ${alphaAt(bm, s, 1620)})`);
  // v215 适配: 滑条身体 alpha 仍 240ms 渐出 (上行不变), 但暂留模式可见窗口延长到结束+800ms (头/尾圈独立残留)
  assert(isVisibleAt(bm, s, 1500 + 800) && !isVisibleAt(bm, s, 1500 + 801), '滑条可见窗口延长到结束+800ms (v215: 头/尾圈独立残留)');
  setDisplayFlag('hitAnimation', true);
}

section('关点击特效 (hitExplosion off): 仍命中立即消失 (优先级高于打击动画)');
{
  setDisplayFlag('hitExplosion', false);
  assert(alphaAt(bm, c, 1000 + 10) === 0, '打击动画开: 命中后立即消失');
  setDisplayFlag('hitAnimation', false);
  assert(alphaAt(bm, c, 1000 + 10) === 0, '打击动画关: 仍立即消失 (不残留)');
  assert(!isVisibleAt(bm, c, 1000 + 241), '可见窗口不延长');
  setDisplayFlag('hitExplosion', true);
  setDisplayFlag('hitAnimation', true);
}

section('还原后回到默认行为');
{
  assert(displaySettings.hitExplosion && displaySettings.hitAnimation, '开关已还原');
  assert(near(alphaAt(bm, c, 1000 + 120), 0.5), '240ms 淡出恢复');
}

if (failures) { console.error(`\nV147_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV147_TESTS_ALL_PASSED');

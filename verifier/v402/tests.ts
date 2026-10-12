// 验证器 v402 纯函数测试: 滑条锚点可交互窗 sliderAnchorInteractiveAt — 暂留模式不延长
// (修复: 关「打击动画」后 alt 选取/框选锚点的时间范围异常巨大 — isVisibleAt 残留窗 800ms 被误用)
import { displaySettings, setDisplayFlag } from '../../src/osu/displaySettings';
import { isVisibleAt, sliderAnchorInteractiveAt, HIT_FADE, HIT_LINGER } from '../../src/osu/lifecycle';
import { arToPreempt } from '../../src/osu/parser';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const bm = ({
  version: 14, general: {}, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap);
// slider: 100px @ 100px/拍 (500ms) × 1 = 500ms 时长 → end = 1500
const s = ({ id: 1, type: 'slider', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0,
  curveType: 'L', curvePoints: [{ x: 200, y: 100 }], length: 100, slides: 1 } as unknown as HitObject);
const end = 1500;
const preempt = arToPreempt(5); // AR5 = 1200ms

section('打击动画开 (默认): 锚点交互窗 = isVisibleAt 窗口');
{
  setDisplayFlag('hitAnimation', true);
  assert(sliderAnchorInteractiveAt(bm, s, 1000 - preempt), '淡入起点可交互');
  assert(!sliderAnchorInteractiveAt(bm, s, 1000 - preempt - 1), '淡入前不可交互');
  assert(sliderAnchorInteractiveAt(bm, s, end + HIT_FADE), '结束后 240ms 边界可交互');
  assert(!sliderAnchorInteractiveAt(bm, s, end + HIT_FADE + 1), '结束后 241ms 不可交互');
}

section('暂留模式 (点击特效开 + 打击动画关): 渲染窗 800ms, 锚点交互窗仍 240ms');
{
  setDisplayFlag('hitExplosion', true);
  setDisplayFlag('hitAnimation', false);
  assert(isVisibleAt(bm, s, end + HIT_LINGER), 'isVisibleAt: 残留窗到 end+800 (v215 头/尾圈渲染不变)');
  assert(!isVisibleAt(bm, s, end + HIT_LINGER + 1), 'isVisibleAt: end+801 剔除 (不变)');
  assert(sliderAnchorInteractiveAt(bm, s, end + HIT_FADE), '锚点交互: end+240 仍可 (滑条身淡出期)');
  assert(!sliderAnchorInteractiveAt(bm, s, end + HIT_FADE + 1), '锚点交互: end+241 不可 (不再随残留窗延长)');
  assert(!sliderAnchorInteractiveAt(bm, s, end + HIT_LINGER), '锚点交互: end+800 不可 (核心修复)');
  assert(sliderAnchorInteractiveAt(bm, s, 1000 - preempt) && !sliderAnchorInteractiveAt(bm, s, 1000 - preempt - 1), '开始侧窗口不变');
}

section('暂留但点击特效关: isVisibleAt 也不延长, 两窗一致');
{
  setDisplayFlag('hitExplosion', false);
  setDisplayFlag('hitAnimation', false);
  assert(!isVisibleAt(bm, s, end + HIT_FADE + 1) && !sliderAnchorInteractiveAt(bm, s, end + HIT_FADE + 1), '两窗一致 = end+240');
  setDisplayFlag('hitExplosion', true);
  setDisplayFlag('hitAnimation', true); // 还原默认
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');

// v27 单元断言: 折返箭头显示时机 (lazer DrawableSliderRepeat/SliderEndCircle 对齐)
import { sliderRepeatAlpha, isVisibleAt } from '../../src/osu/lifecycle';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// 基准: sliderStart=5000, span=1000ms, preempt=400
const A = (t: number, s: number, span = 1000) => sliderRepeatAlpha(t, 5000, span, 400, s);

// ---- s=1 (RepeatIndex=0): 随滑条淡入, 4600 起 150ms 渐显; 球到尾端 (6000) 立即隐藏 ----
assert(A(4500, 1) === 0, 's=1: 淡入开始前 0');
assert(Math.abs(A(4675, 1) - 0.5) < 1e-9, 's=1: 渐显中点 0.5');
assert(A(4900, 1) === 1, 's=1: 滑条未开始已全显 (随滑条出现)');
assert(A(5999, 1) === 1, 's=1: 球到达前保持 1');
assert(A(6000, 1) === 0, 's=1: 球到达尾端立即隐藏');

// ---- s=2 (RepeatIndex=1): TimePreempt=2span -> o.time 起 min(span,150) 渐显; 7000 隐藏 ----
assert(A(4999, 2) === 0, 's=2: 滑条开始前不显示 (不与滑条头重叠)');
assert(A(5000, 2) === 0, 's=2: 球在头部瞬间开始渐显 (alpha 0 起)');
assert(Math.abs(A(5075, 2) - 0.5) < 1e-9, 's=2: 渐显中点 0.5');
assert(A(5150, 2) === 1, 's=2: 150ms 后全显');
assert(A(6999, 2) === 1, 's=2: 球返回头部前保持 1');
assert(A(7000, 2) === 0, 's=2: 球到达头部立即隐藏');

// ---- s=3 (RepeatIndex=2): o.time+span 起渐显; 8000 隐藏 ----
assert(A(5999, 3) === 0, 's=3: span1 期间不显示');
assert(A(6150, 3) === 1, 's=3: 球过尾端后 150ms 全显');
assert(A(8000, 3) === 0, 's=3: 球再到尾端立即隐藏');

// ---- 短 span: 渐显时长钳制到 span ----
assert(Math.abs(A(5050, 2, 100) - 0.5) < 1e-9, 'span=100: ramp=min(100,150)=100, 中点 0.5');

// ---- isVisibleAt: 命中窗口=渲染窗口 (滑条全程+淡出可选中) ----
{
  const bm = {
    difficulty: { ar: 9, cs: 4, sliderMultiplier: 1.4 },
    timingPoints: [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  } as unknown as Beatmap;
  // 滑条: 5000 开始, length 280, vel 0.28 -> span 1000, slides 3 -> end 8000
  const sl = { type: 'slider', x: 0, y: 0, time: 5000, curveType: 'L', curvePoints: [{ x: 280, y: 0 }], slides: 3, length: 280 } as HitObject;
  assert(!isVisibleAt(bm, sl, 4399), 'AR9 preempt=600: 4399 不可见');
  assert(isVisibleAt(bm, sl, 4400), '4400 起可见 (淡入)');
  assert(isVisibleAt(bm, sl, 7000), '7000 (span2 中) 可见 — 旧窗口 time+600 会误判不可见');
  assert(isVisibleAt(bm, sl, 8100), '8100 (结束后 100ms, 淡出中) 可见可选中');
  assert(!isVisibleAt(bm, sl, 8241), '8241 (结束+241) 已消失不可选');
  const c = { type: 'circle', x: 0, y: 0, time: 5000 } as HitObject;
  assert(isVisibleAt(bm, c, 5200), '单点结束后 200ms (淡出中) 可见');
  assert(!isVisibleAt(bm, c, 5241), '单点结束+241 不可见');
}

if (failures) { console.error(`V27_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('v27 纯函数断言全部通过');

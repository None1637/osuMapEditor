// v204: slidertick 出现时机对齐 lazer SliderTick.ApplyDefaultsToSelf
// 运行方式: 由 check.mjs esbuild 打包后 import
import assert from 'node:assert';
import { sliderTickPreempt, sliderTickState } from '../../src/osu/renderer';

const P = 1200; // 滑条 preempt (AR~5)

// ---- T1: 首段 tick (spanIndex=0) — offset = preempt*0.66 ----
{
  const spanStart = 5000, tickTime = 5400; // span 开始 400ms 后的 tick
  const pre = sliderTickPreempt(tickTime, spanStart, 0, P);
  assert.ok(Math.abs(pre - (200 + 792)) < 1e-9, `T1 首段 tick preempt = (400/2 + 1200*0.66) = 992 (实际 ${pre})`);
  // 出现时刻 = 5400 - 992 = 4408 — 早于旧逻辑的 5400-1200=4200? 不, 992<1200 故更晚出现但远早于 tick 本身
  assert.ok(tickTime - pre > spanStart - P, 'T1 出现在滑条淡入之后');
}

// ---- T2: 后续 span (spanIndex>0) — offset = 200 (stable 偏移) ----
{
  const spanStart = 5000, tickTime = 5100;
  const pre = sliderTickPreempt(tickTime, spanStart, 1, P);
  assert.ok(Math.abs(pre - (50 + 200)) < 1e-9, `T2 后续 span tick preempt = (100/2 + 200) = 250 (实际 ${pre})`);
  // 出现时刻 4850 < spanStart 5000: span 开始前 150ms 即出现 (lazer 注释: 避免 repeat 上 tick 出现太晚)
  assert.ok(tickTime - pre < spanStart, 'T2 在 span 开始前出现 (对齐 stable)');
}

// ---- T3: 与旧逻辑差异 — 旧: tickTime - P ----
{
  const spanStart = 5000, tickTime = 5800; // span 开始 800ms 后
  const pre = sliderTickPreempt(tickTime, spanStart, 0, P);
  assert.ok(Math.abs(pre - (400 + 792)) < 1e-9, 'T3 preempt = 1192');
  assert.ok(Math.abs((tickTime - pre) - (tickTime - P)) < 10, 'T3 接近 span 末端的 tick 与旧逻辑几乎相同');
  const pre2 = sliderTickPreempt(5100, spanStart, 0, P); // span 开始 100ms 后
  assert.ok(Math.abs(pre2 - (50 + 792)) < 1e-9 && pre2 < P, 'T3 span 前段的 tick 比旧逻辑晚出现 (842 < 1200)');
}

// ---- T4: 状态机边界 (经 sliderTickState) ----
{
  const spanStart = 9600, tickTime = 10000;
  const showAt = tickTime - sliderTickPreempt(tickTime, spanStart, 0, P); // 10000-992=9008
  assert.strictEqual(sliderTickState(showAt - 1, tickTime, spanStart, 0, P), null, 'T4 出现前不显示');
  assert.ok(sliderTickState(showAt + 150, tickTime, spanStart, 0, P)!.alpha === 1, 'T4 150ms 淡入完成');
  assert.strictEqual(sliderTickState(tickTime + 151, tickTime, spanStart, 0, P), null, 'T4 淡出后不显示');
}

console.log('V204_TESTS_PASSED');

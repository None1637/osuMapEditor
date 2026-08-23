import assert from 'node:assert';
import { sliderHeadHitState, sliderTickState, outElasticHalf } from '../../src/osu/renderer';

// v178: 滑条头命中后消失 (默认显示设置: hitExplosion=on, hitAnimation=on —
// lazer DrawableHitCircle 命中爆炸: 240ms 放大到 1.4x 淡出)
assert.deepStrictEqual(sliderHeadHitState(-1), { alpha: 1, scale: 1 }, '命中前完整显示');
assert.deepStrictEqual(sliderHeadHitState(0), { alpha: 1, scale: 1 }, '命中瞬间仍完整');
{
  const s = sliderHeadHitState(120);
  assert.ok(Math.abs(s.alpha - 0.5) < 1e-9 && Math.abs(s.scale - 1.2) < 1e-9, '120ms: 半淡出 + 1.2x');
}
assert.strictEqual(sliderHeadHitState(240).alpha, 0, '240ms 后头圈完全消失');
assert.strictEqual(sliderHeadHitState(1000).alpha, 0, '之后保持消失');

// v178: tick 渐进显示 (FadeIn 150ms + ScaleTo 0.5→1 600ms OutElasticHalf; 球经过后 150ms 淡出)
// v204: 出现时刻对齐 lazer SliderTick.ApplyDefaultsToSelf — TimePreempt = (tickTime-spanStart)/2 + offset
const T = 10000, P = 1200; // tick 时间 / 滑条 preempt
// v204: 出现时刻改走 lazer SliderTick 公式 — sliderTickState(time, tickTime, spanStart, spanIndex, preempt)
const spanStart = 9600; // 首段 (spanIndex=0), tick 在 span 开始 400ms 后
const tickPre = (T - spanStart) / 2 + P * 0.66; // = 200 + 792 = 992 (v204 sliderTickPreempt)
const showAt = T - tickPre;
assert.strictEqual(sliderTickState(showAt - 1, T, spanStart, 0, P), null, '出现前 1ms 不显示 (不再一次性全显示)');
const s0 = sliderTickState(showAt, T, spanStart, 0, P)!;
assert.ok(s0.alpha === 0 && Math.abs(s0.scale - 0.5) < 1e-9, '刚出现: alpha 0, scale 0.5');
const sIn = sliderTickState(showAt + 150, T, spanStart, 0, P)!;
assert.ok(Math.abs(sIn.alpha - 1) < 1e-9, '150ms 淡入完成 (ANIM_DURATION)');
assert.ok(sIn.scale > 0.9, '弹入进行中 (OutElasticHalf 快速接近/越过 1)');
const sFull = sliderTickState(T, T, spanStart, 0, P)!;
assert.ok(Math.abs(sFull.alpha - 1) < 1e-9 && Math.abs(sFull.scale - 1) < 1e-9, '到达时刻: 完全不透明 + 原大小');
const sOut = sliderTickState(T + 75, T, spanStart, 0, P)!;
assert.ok(Math.abs(sOut.alpha - 0.5) < 1e-9, '球经过后 150ms 淡出 (75ms 时一半)');
assert.strictEqual(sliderTickState(T + 151, T, spanStart, 0, P), null, '淡出结束后不再显示');

// outElasticHalf 端点 (osu-framework DefaultEasingFunction Easing.OutElasticHalf)
assert.ok(Math.abs(outElasticHalf(0)) < 1e-9, 'OutElasticHalf(0)=0');
assert.ok(Math.abs(outElasticHalf(1) - 1) < 1e-9, 'OutElasticHalf(1)=1');
assert.ok(outElasticHalf(0.25) > 1, 'OutElasticHalf 中途过冲 (弹性)');

console.log('V178_TESTS_PASSED');

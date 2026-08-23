// v203: 暂留模式滑条头暂留 — sliderHeadHitState / 头部变白
// 运行方式: 由 check.mjs esbuild 打包后 import
import assert from 'node:assert';
import { sliderHeadHitState } from '../../src/osu/renderer';
import { displaySettings } from '../../src/osu/displaySettings';
import { HIT_LINGER } from '../../src/osu/lifecycle';

// 暂留模式: 点击特效开 + 打击动画关
displaySettings.hitExplosion = true;
displaySettings.hitAnimation = false;

assert.deepStrictEqual(sliderHeadHitState(-1), { alpha: 1, scale: 1 }, '命中前完整显示');
assert.deepStrictEqual(sliderHeadHitState(0), { alpha: 1, scale: 1 }, '命中瞬间仍完整 (暂留开始)');
{
  const s = sliderHeadHitState(400);
  assert.ok(Math.abs(s.alpha - 0.5) < 1e-9 && s.scale === 1, '暂留半程 400ms: alpha 0.5 不放大 (与单点 HIT_LINGER 一致)');
}
assert.strictEqual(sliderHeadHitState(HIT_LINGER).alpha, 0, 'HIT_LINGER 后完全消失');
assert.strictEqual(sliderHeadHitState(2000).alpha, 0, '之后保持消失');

// 打击动画开: 保持 240ms 爆炸
displaySettings.hitAnimation = true;
{
  const s = sliderHeadHitState(120);
  assert.ok(Math.abs(s.alpha - 0.5) < 1e-9 && Math.abs(s.scale - 1.2) < 1e-9, '打击动画开: 120ms 半淡出 + 1.2x (不变)');
}
// 点击特效关: 立即消失
displaySettings.hitExplosion = false;
assert.strictEqual(sliderHeadHitState(0).alpha, 0, '点击特效关: 命中即消失 (不变)');
displaySettings.hitExplosion = true;

console.log('V203_TESTS_PASSED');

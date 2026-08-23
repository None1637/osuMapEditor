// v215: 暂留模式 (打击动画关) 滑条头/尾圈同单点淡出 — 纯函数单测
// 运行: cd app && npx esbuild verifier/v215/tests.ts --bundle --platform=node --outfile=verifier/v215/_bundle.mjs && node verifier/v215/_bundle.mjs
import { sliderTailLingerAlpha, sliderHeadHitState } from '../../src/osu/renderer';
import { isVisibleAt, hitObjectEndTime, HIT_LINGER, HIT_FADE } from '../../src/osu/lifecycle';
import { displaySettings } from '../../src/osu/displaySettings';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 暂留模式: 点击特效开 + 打击动画关
displaySettings.hitExplosion = true;
displaySettings.hitAnimation = false;

console.log('== sliderTailLingerAlpha: 尾圈结束=命中, 800ms 线性渐隐');
assert(sliderTailLingerAlpha(-1) === null, '滑条未结束 → null (随滑条身)');
assert(sliderTailLingerAlpha(0) === 1, '结束瞬间 alpha 1');
assert(Math.abs((sliderTailLingerAlpha(400) ?? 0) - 0.5) < 1e-9, '结束后 400ms alpha 0.5 (与单点 HIT_LINGER 一致)');
assert(sliderTailLingerAlpha(HIT_LINGER) === 0, 'HIT_LINGER 后完全消失');
assert(sliderTailLingerAlpha(2000) === 0, '之后保持 0');

// 非暂留模式: 尾圈无独立残留
displaySettings.hitAnimation = true;
assert(sliderTailLingerAlpha(0) === null, '打击动画开 → null (尾随身体淡出, 不变)');
displaySettings.hitAnimation = false;
displaySettings.hitExplosion = false;
assert(sliderTailLingerAlpha(0) === null, '点击特效关 → null (立即消失, 不变)');
displaySettings.hitExplosion = true;

console.log('== sliderHeadHitState 暂留回归 (v203 语义不变)');
{
  const s0 = sliderHeadHitState(0);
  assert(s0.alpha === 1 && s0.scale === 1, '头命中瞬间完整');
  assert(Math.abs(sliderHeadHitState(400).alpha - 0.5) < 1e-9, '头暂留半程 alpha 0.5');
}

console.log('== isVisibleAt: 暂留模式滑条残留窗口延长到 HIT_LINGER');
{
  const slider: HitObject = { id: 1, type: 'slider', x: 0, y: 0, time: 1000, slides: 1, length: 140, curveType: 'L', curvePoints: [{ x: 100, y: 0 }] };
  const bm = {
    timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
    hitObjects: [slider],
    difficulty: { ar: 9, sliderMultiplier: 1.4 },
  } as unknown as Beatmap;
  const end = hitObjectEndTime(bm, slider);
  assert(end > 1000, `滑条有时长 (end=${end})`);
  assert(isVisibleAt(bm, slider, end + HIT_FADE + 100), '身淡出 (240ms) 后仍在窗口内 (头/尾残留)');
  assert(isVisibleAt(bm, slider, end + HIT_LINGER), 'HIT_LINGER 边界仍可见');
  assert(!isVisibleAt(bm, slider, end + HIT_LINGER + 1), 'HIT_LINGER 后剔除');
  // 非暂留模式: 窗口不变 (HIT_FADE)
  displaySettings.hitAnimation = true;
  assert(!isVisibleAt(bm, slider, end + HIT_FADE + 100), '打击动画开: 240ms 后剔除 (不变)');
  displaySettings.hitAnimation = false;
}

if (failures) { console.error(`TESTS FAILED: ${failures}`); process.exit(1); }
console.log('TESTS ALL PASSED');

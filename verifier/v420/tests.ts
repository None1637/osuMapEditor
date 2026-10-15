// v420 数值测试: hit lighting 泛光状态 (240ms 放大淡出)
import { HIT_LIGHTING_MS, hitLightingState } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

assert(HIT_LIGHTING_MS === 240, '泛光 240ms');
assert(hitLightingState(-1) === null, '命中前不画');
assert(hitLightingState(241) === null, '240ms 后不画');
{
  const s0 = hitLightingState(0)!;
  assert(s0.alpha === 1 && s0.scale === 1, '命中瞬刻 alpha=1 scale=1');
  const sEnd = hitLightingState(240)!;
  assert(Math.abs(sEnd.alpha) < 1e-9 && Math.abs(sEnd.scale - 1.8) < 1e-9, '末端淡出 alpha=0, 放大 1.8x');
  const sMid = hitLightingState(120)!;
  assert(sMid.alpha < 1 && sMid.alpha > 0 && sMid.scale > 1 && sMid.scale < 1.8, '中段介于两端');
  assert(hitLightingState(60)!.alpha > hitLightingState(180)!.alpha, 'alpha 单调渐隐');
}

if (failures) { console.error(`\nV420_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV420_TESTS_PASSED');

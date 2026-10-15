// v416 数值测试: 光标拖尾轨迹 — updateTrail 采样/修剪 / trailAlpha 淡出 / trailScale 渐缩
import { TRAIL_MS, updateTrail, trailAlpha, trailScale, type TrailPoint } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

assert(TRAIL_MS === 120, '拖尾保留 120ms');

// updateTrail: 未按住 8ms 节流, 按住逐帧采样 (更密)
{
  const tr: TrailPoint[] = [];
  for (let t = 0; t <= 40; t += 4) updateTrail(tr, t, 0, t, false); // 4ms 间隔 → 隔点采样
  const idleN = tr.length;
  assert(idleN < 11 && idleN >= 5, `未按住 8ms 节流 (${idleN}/11 点)`);
  const tr2: TrailPoint[] = [];
  for (let t = 0; t <= 40; t += 4) updateTrail(tr2, t, 0, t, true);
  assert(tr2.length === 11, `按住逐帧采样 (${tr2.length}/11 点, 更密)`);
}
// updateTrail: 修剪 120ms 以外的旧点
{
  const tr: TrailPoint[] = [];
  for (let t = 0; t <= 512; t += 16) updateTrail(tr, t, 0, t, false);
  assert(tr.length > 0 && tr[0].t >= 512 - TRAIL_MS, `旧点已修剪 (最早 t=${tr[0]?.t})`);
  assert(tr[tr.length - 1].t === 512, '最新点在队尾');
}

// trailAlpha: 新点不透明度高, 越旧越淡; 按住更不透明
assert(Math.abs(trailAlpha(100, 100, false) - 0.45) < 1e-9, '新点未按住 alpha=0.45');
assert(Math.abs(trailAlpha(100, 100, true) - 0.8) < 1e-9, '新点按住 alpha=0.8 (更不透明)');
assert(trailAlpha(0, TRAIL_MS, false) === 0, '120ms 老点淡出到 0');
assert(trailAlpha(0, 60, false) < trailAlpha(0, 30, false), '沿轨迹单调渐隐');
assert(trailAlpha(0, 1000, false) === 0, '超窗钳 0');

// trailScale: 1 → 0.3 渐缩
assert(trailScale(100, 100) === 1, '新点 scale=1');
assert(Math.abs(trailScale(0, TRAIL_MS) - 0.3) < 1e-9, '末端 scale=0.3');
assert(trailScale(0, 60) < 1 && trailScale(0, 60) > 0.3, '中段介于 0.3~1');

if (failures) { console.error(`\nV416_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV416_TESTS_PASSED');

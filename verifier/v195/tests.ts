// v195: 关「打击动画」时缩圈命中后反弹 — 缩到圈边后以缩小速度向外扩大 APPROACH_BOUNCE 再停住
import { approachBounceScale, APPROACH_BOUNCE } from '../../src/osu/lifecycle';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.error(`  FAIL ${msg}`); }
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ---- T1: 基本形状 ----
{
  const preempt = 600; // AR9
  const dur = (APPROACH_BOUNCE * preempt) / 3; // 40ms
  assert(near(approachBounceScale(0, preempt), 1, 1e-9), 'T1 命中瞬间 = 1 (与缩圈终点连续)');
  assert(near(approachBounceScale(dur / 2, preempt), 1 + APPROACH_BOUNCE / 2, 1e-9), 'T1 半程 = 1.05');
  assert(near(approachBounceScale(dur, preempt), 1 + APPROACH_BOUNCE, 1e-9), 'T1 反弹结束 = 1.1');
  assert(near(approachBounceScale(500, preempt), 1 + APPROACH_BOUNCE, 1e-9), 'T1 之后停住不再变');
  assert(near(approachBounceScale(-50, preempt), 1, 1e-9), 'T1 负 dt clamp 到 1');
}

// ---- T2: 反弹速度 = 缩圈速度 (任意 AR 下一致) ----
{
  // 缩圈: preempt ms 内 scale 4→1, 速度 = 3/preempt (盒子/ms); 反弹: APPROACH_BOUNCE / dur 应相等
  for (const preempt of [450, 600, 1200, 1800]) {
    const dur = (APPROACH_BOUNCE * preempt) / 3;
    const speed = APPROACH_BOUNCE / dur;
    assert(near(speed, 3 / preempt, 1e-12), `T2 preempt=${preempt} 反弹速度=缩圈速度`);
  }
}

// ---- T3: 幅度常量 ----
assert(APPROACH_BOUNCE === 0.1, `T3 APPROACH_BOUNCE=0.1 (实际 ${APPROACH_BOUNCE})`);

console.log(failures ? `\nV195_TESTS_FAILED: ${failures}` : '\nV195_TESTS_PASSED');
process.exit(failures ? 1 : 0);

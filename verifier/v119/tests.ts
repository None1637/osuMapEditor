// v119 测试: 网格类型 'none' (无网格) — snapToGrid 直通, 其余类型行为不变
// 运行: cd app && npx esbuild verifier/v119/tests.ts --bundle --platform=node --outfile=/tmp/v119.cjs --log-level=error --alias:@=./src && node /tmp/v119.cjs
import { snapToGrid, rotationPeriod } from '../../src/osu/gridSnap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const O = { x: 256, y: 192 };

// none: 任何输入原样返回 (不吸附, 也不钳制 — 与不开启网格吸附行为一致)
{
  const p = { x: 100.7, y: 50.3 };
  const r = snapToGrid(p, 'none', O, 32, 15);
  assert(r === p || (r.x === p.x && r.y === p.y), 'none: 点原样返回 (不吸附)');
  const out = snapToGrid({ x: 600, y: -20 }, 'none', O, 32, 0);
  assert(out.x === 600 && out.y === -20, 'none: 出界点也不钳制 (游玩表现一致)');
  const zero = snapToGrid(p, 'none', O, 0, 0);
  assert(zero.x === p.x && zero.y === p.y, 'none: spacing 0 同样直通');
}

// none: 无旋转周期 (与 circle 同款 — 旋转输入禁用)
assert(rotationPeriod('none') === null, 'rotationPeriod(none) = null (旋转禁用)');

// 其余类型不受影响 (v56 行为)
{
  const s = snapToGrid({ x: 100.7, y: 50.3 }, 'square', O, 32, 0);
  assert(s.x === 96 && s.y === 64, 'square: 吸附不变');
  const clamped = snapToGrid({ x: 600, y: -20 }, 'square', O, 32, 0);
  assert(clamped.x === 512 && clamped.y === 0, 'square: 钳制回游玩区不变');
  assert(rotationPeriod('square') === 90 && rotationPeriod('triangle') === 60 && rotationPeriod('circle') === null, 'rotationPeriod 其余类型不变');
}

console.log(failures ? `\nV119_TESTS_FAILED: ${failures}` : '\nV119_TESTS_PASSED');
process.exit(failures ? 1 : 0);

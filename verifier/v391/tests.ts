// v391 纯函数断言: 游玩区旋转正/逆变换 (pfRotate.ts)
import { pfRotFwd, pfRotInv, PF_CX, PF_CY } from '@/osu/pfRotate';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

section('pfRotFwd / pfRotInv');
{
  const p = { x: 300, y: 100 };
  assert(pfRotFwd(p, 0) === p, 'deg=0 原样返回 (同一引用, 零开销)');
  // 中心是不动点
  const c = pfRotFwd({ x: PF_CX, y: PF_CY }, 37.5);
  assert(near(c.x, PF_CX) && near(c.y, PF_CY), '中心不动点');
  // 90°: 中心右侧 100px → 中心下侧 100px (y 向下为正, 顺时针)
  const q = pfRotFwd({ x: PF_CX + 100, y: PF_CY }, 90);
  assert(near(q.x, PF_CX) && near(q.y, PF_CY + 100), `90° 顺时针 (实际 ${q.x.toFixed(3)},${q.y.toFixed(3)})`);
  // 180°: 对角翻转
  const r = pfRotFwd({ x: 0, y: 0 }, 180);
  assert(near(r.x, 512) && near(r.y, 384), '180° 对角');
  // 往返一致 (任意角度)
  for (const deg of [15, -42.7, 123.4, 359]) {
    const rt = pfRotInv(pfRotFwd(p, deg), deg);
    assert(near(rt.x, p.x) && near(rt.y, p.y), `往返一致 deg=${deg}`);
  }
}

if (failures) { console.error(`V391_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V391_TESTS_ALL_PASSED');

// 验证器 v78 纯函数测试: snapToGrid 自定义原点 (网格中心) — 正方形/圆形网格均以 start 为原点
import { snapToGrid, GRID_ORIGIN } from '../../src/osu/gridSnap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('snapToGrid 方形网格: 自定义原点');
{
  // 原点 (100,80), 间距 32: 格点 = (100+32k, 80+32m)
  const s = snapToGrid({ x: 290, y: 190 }, 'square', { x: 100, y: 80 }, 32, 0);
  assert(s.x === 292 && s.y === 176, `(290,190) => (${s.x},${s.y}) 期望 (292,176)`);
  const at = snapToGrid({ x: 101, y: 81 }, 'square', { x: 100, y: 80 }, 32, 0);
  assert(at.x === 100 && at.y === 80, '原点附近的点吸附到原点自身');
  // 默认原点回归: (290,190) => (288,192) (GRID_ORIGIN=(256,192))
  const d = snapToGrid({ x: 290, y: 190 }, 'square', GRID_ORIGIN, 32, 0);
  assert(d.x === 288 && d.y === 192, '默认原点行为不变');
}

section('snapToGrid 圆形网格: 自定义原点 (径向距离吸附)');
{
  // 原点 (100,80), 间距 32: (150,80) 距离 50 => 50/32≈1.56 => 2 圈 => 距离 64
  const c = snapToGrid({ x: 150, y: 80 }, 'circle', { x: 100, y: 80 }, 32, 0);
  assert(Math.abs(c.x - 164) < 0.01 && Math.abs(c.y - 80) < 0.01, `(150,80) => (${c.x.toFixed(1)},${c.y.toFixed(1)}) 期望 (164,80)`);
  const c2 = snapToGrid({ x: 105, y: 85 }, 'circle', { x: 100, y: 80 }, 32, 0);
  assert(Math.abs(Math.hypot(c2.x - 100, c2.y - 80)) < 0.01, '极近点吸附到原点 (0 圈)');
}

section('snapToGrid 三角形网格: 自定义原点过原点');
{
  const t = snapToGrid({ x: 102, y: 82 }, 'triangle', { x: 100, y: 80 }, 32, 0);
  assert(Math.abs(t.x - 100) < 0.01 && Math.abs(t.y - 80) < 0.01, '原点附近吸附到原点');
}

if (failures) { console.error(`\nTESTS_V78_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V78_ALL_PASSED');

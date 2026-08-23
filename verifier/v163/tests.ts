// 验证器 v163 纯函数测试: snapToGrid 的 clampToPlayfield 参数 (默认钳制 = 旧行为)
import { snapToGrid } from '../../src/osu/gridSnap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 方形网格: 原点 (256,192), 间距 32 → 网格线 x ∈ {..., 480, 512?} 256+32k: ..., 608; y: 192+32k
const ORIGIN = { x: 256, y: 192 };

section('snapToGrid: 默认 (省略参数) = 钳制到游玩区 (旧行为)');
{
  const r = snapToGrid({ x: 600, y: 390 }, 'square', ORIGIN, 32, 0);
  assert(r.x === 512 && r.y === 384, `(600,390) → 吸附 (608,384) 后钳到 (512,384) (得 ${r.x},${r.y})`);
  const r2 = snapToGrid({ x: -50, y: -50 }, 'square', ORIGIN, 32, 0);
  assert(r2.x === 0 && r2.y === 0, `负坐标钳到 (0,0) (得 ${r2.x},${r2.y})`);
}

section('snapToGrid: clampToPlayfield=false → 不钳制 (可出游玩区)');
{
  const r = snapToGrid({ x: 600, y: 390 }, 'square', ORIGIN, 32, 0, false);
  assert(r.x === 608 && r.y === 384, `(600,390) → (608,384) 不钳制 (得 ${r.x},${r.y})`);
  const r2 = snapToGrid({ x: -50, y: -50 }, 'square', ORIGIN, 32, 0, false);
  assert(r2.x === -64 && r2.y === -64, `(-50,-50) → (-64,-64) 不钳制 (得 ${r2.x},${r2.y})`);
  // 区内点不受影响
  const r3 = snapToGrid({ x: 300, y: 200 }, 'square', ORIGIN, 32, 0, false);
  assert(r3.x === 288 && r3.y === 192, `区内吸附不变 (得 ${r3.x},${r3.y})`);
}

section('snapToGrid: none/无效间距 原样返回 (两种模式一致)');
{
  const p = { x: 600, y: 400 };
  assert(snapToGrid(p, 'none', ORIGIN, 32, 0) === p, 'none 原样 (钳制模式)');
  assert(snapToGrid(p, 'none', ORIGIN, 32, 0, false) === p, 'none 原样 (不钳制模式)');
}

if (failures) { console.error(`V163_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V163_TESTS_PASSED');

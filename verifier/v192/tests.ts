// 验证器 v192 纯函数测试: 快捷键镜像/旋转围绕游玩区中心 (256,192) 的几何语义
// 注意: flipObjects/rotateObjects 原地改写坐标, 返回值只含被改动的滑条 — 断言读输入对象
import { flipObjects, rotateObjects } from '../../src/osu/transform';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const C = { x: 256, y: 192 };
const circle = (id: number, x: number, y: number) =>
  ({ id, type: 'circle' as const, x, y, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0 });

// 水平镜像: x' = 2*256 - x, y 不变
{
  const o = circle(1, 100, 150);
  flipObjects([o], C, 'h');
  assert(o.x === 412 && o.y === 150, `水平镜像: (100,150) → (412,150) (得 ${o.x},${o.y})`);
}
// 垂直镜像: y' = 2*192 - y, x 不变
{
  const o = circle(1, 100, 150);
  flipObjects([o], C, 'v');
  assert(o.x === 100 && o.y === 234, `垂直镜像: (100,150) → (100,234) (得 ${o.x},${o.y})`);
}
// 旋转 90° (屏幕 y 向下, 顺时针为正): +90° (356,192) → (256,292); -90° → (256,92)
{
  const o = circle(1, 356, 192);
  rotateObjects([o], C, 90);
  assert(o.x === 256 && o.y === 292, `顺转90°: (356,192) → (256,292) (得 ${o.x},${o.y})`);
  const o2 = circle(2, 356, 192);
  rotateObjects([o2], C, -90);
  assert(o2.x === 256 && o2.y === 92, `逆转90°: (356,192) → (256,92) (得 ${o2.x},${o2.y})`);
}
// 滑条控制点同步变换 (围绕游玩区中心; 水平镜像 x=256 的头不动, 控制点 (356,100)→(156,100))
{
  const s = { id: 3, type: 'slider' as const, x: 256, y: 100, time: 1000, hitSound: 0, newCombo: false, comboSkip: 0,
    curveType: 'L' as const, curvePoints: [{ x: 356, y: 100 }], slides: 1, length: 100 };
  const ret = flipObjects([s], C, 'h');
  assert(s.x === 256 && s.y === 100 && s.curvePoints![0].x === 156 && s.curvePoints![0].y === 100,
    `滑条水平镜像: 头 (256,100) 不动, 控制点 (356,100)→(156,100) (得 ${s.x},${s.y} / ${s.curvePoints![0].x},${s.curvePoints![0].y})`);
  assert(ret.length === 1 && ret[0].id === 3, '滑条入返回表 (供 invalidatePath)');
}

if (failures) { console.error(`V192_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V192_TESTS_PASSED');

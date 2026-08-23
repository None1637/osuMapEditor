// 验证器 v56 纯函数测试: 位置网格吸附 (lazer PositionSnapGrid 三类网格)
import {
  rotateVector, normalizeRotation, rotationPeriod, snapSquare, snapTriangle, snapCircle, snapToGrid,
  pixelToHex, hexToPixel, squareNormals, triangleGrid,
  GRID_ORIGIN, GRID_SPACING_MIN, GRID_SPACING_MAX,
} from '../../src/osu/gridSnap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const O = GRID_ORIGIN; // (256,192)

section('常量 (lazer OsuGridToolboxGroup)');
assert(GRID_ORIGIN.x === 256 && GRID_ORIGIN.y === 192, '原点默认游玩区中心');
assert(GRID_SPACING_MIN === 4 && GRID_SPACING_MAX === 256, '间距范围 4..256');

section('rotateVector (lazer GeometryUtils.RotateVector 逐行移植)');
{
  const v = rotateVector({ x: 1, y: 0 }, 90);
  assert(near(v.x, 0) && near(v.y, -1), `(1,0) 转 90° -> (0,-1) (实际 ${v.x.toFixed(2)},${v.y.toFixed(2)})`);
}

section('normalizeRotation / rotationPeriod (lazer 类型切换归一)');
assert(normalizeRotation(50, 90) === -40, `50° 周期 90 -> -40`);
assert(normalizeRotation(100, 60) === -20, `100° 周期 60 -> -20`);
assert(rotationPeriod('square') === 90 && rotationPeriod('triangle') === 60 && rotationPeriod('circle') === null, '周期 90/60/禁用');

section('snapSquare: 旋转后逐轴取整再转回');
{
  let r = snapSquare({ x: 270, y: 200 }, O, 32, 0);
  assert(r.x === 256 && r.y === 192, `(270,200) 间距 32 -> (256,192) (实际 ${r.x},${r.y})`);
  r = snapSquare({ x: 280, y: 210 }, O, 32, 0);
  assert(r.x === 288 && r.y === 224, `(280,210) -> (288,224)`);
  // 旋转 45°: 手算 rel=(34,8) -> 旋转后 (29.7,-18.4) -> 取整 (32,-32) -> 转回 (45.25,0)
  r = snapSquare({ x: 290, y: 200 }, O, 32, 45);
  assert(near(r.x, 301.25) && near(r.y, 192), `旋转 45° -> (301.25,192) (实际 ${r.x.toFixed(2)},${r.y.toFixed(2)})`);
}

section('snapTriangle: 六边形网格 (lazer pixelToHex/hexToPixel)');
{
  // 往返: hex(2,1) -> pixel -> hex 还原
  const pix = hexToPixel(2, 1, 32);
  const hex = pixelToHex(pix, 32);
  assert(hex.q === 2 && hex.r === 1, `hex(2,1) 往返`);
  // 晶格点: origin+(32,0) = (288,192); p=(273,194) 最近 (288,192) (dist 15.0 < 17.0)
  const r = snapTriangle({ x: 273, y: 194 }, O, 32, 0);
  assert(near(r.x, 288) && near(r.y, 192), `(273,194) -> (288,192) (实际 ${r.x.toFixed(2)},${r.y.toFixed(2)})`);
  // 第二晶格点 (16,27.71): q=1,r=1 -> x=256+32-16=272, y=192+27.71=219.71
  const r2 = snapTriangle({ x: 272, y: 218 }, O, 32, 0);
  assert(near(r2.x, 272) && near(r2.y, 192 + 32 / Math.sqrt(3) * 1.5), `(272,218) -> (272,219.71) (实际 ${r2.x.toFixed(2)},${r2.y.toFixed(2)})`);
}

section('snapCircle: 半径按间距取整, 方向不变');
{
  let r = snapCircle({ x: 306, y: 192 }, O, 32); // len 50 -> 64
  assert(near(r.x, 320) && near(r.y, 192), `len 50 -> 64: (320,192) (实际 ${r.x},${r.y})`);
  r = snapCircle({ x: 296, y: 192 }, O, 32); // len 40 -> 32
  assert(near(r.x, 288) && near(r.y, 192), `len 40 -> 32: (288,192)`);
  r = snapCircle({ x: 256.0001, y: 192 }, O, 32); // 中心点原样 (lazer FLOAT_EPSILON)
  assert(r.x === 256 && r.y === 192, `中心点 -> 原点`);
}

section('snapToGrid: 钳制回游玩区 (lazer TrySnapToPositionGrid Clamp)');
{
  const r = snapToGrid({ x: 600, y: 192 }, 'circle', O, 32, 0); // len 344 -> 352 -> x 608 -> 钳 512
  assert(r.x === 512 && r.y === 192, `(600,192) -> 钳 (512,192) (实际 ${r.x},${r.y})`);
  const r2 = snapToGrid({ x: 273, y: 194 }, 'triangle', O, 32, 0);
  assert(near(r2.x, 288) && near(r2.y, 192), '类型分发 triangle');
}

section('渲染辅助: 线族法向');
{
  const n = squareNormals(0);
  assert(near(n[0].x, 0) && near(n[0].y, 1) && near(n[1].x, 1) && near(n[1].y, 0), '正方形 rot 0 -> 两正交法向');
  const t = triangleGrid(32, 0);
  assert(near(t.lineSpacing, 32 * Math.sqrt(3) / 2), `三角形线间距 = spacing*sqrt3/2 (${t.lineSpacing.toFixed(2)})`);
  // lazer step1 = RotateVector((stepSpacing,0), -rot-30): rot 0 -> 方向 -30° -> (cos30, sin30) = (0.866, 0.5)
  assert(t.normals.length === 3 && near(t.normals[0].x, Math.cos(Math.PI / 6)) && near(t.normals[0].y, 0.5, 1e-6),
    `三角形首法向 -30° (${t.normals[0].x.toFixed(3)},${t.normals[0].y.toFixed(3)})`);
}

if (failures) { console.error(`\nTESTS_V56_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V56_ALL_PASSED');

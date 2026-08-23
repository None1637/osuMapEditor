// 验证器 v84 纯函数测试: 几何辅助 (外接圆/辅助线筛选/裁剪/吸附)
import { circumCircle, sliderHelperCircle, sliderHelperLines, clipLineToBox, geoHelperSnap, GEO_CLIP_BOX } from '../../src/osu/geometryHelpers';
import type { HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const slider = (x: number, y: number, curveType: string, curvePoints: { x: number; y: number }[]) =>
  ({ type: 'slider', x, y, curveType, curvePoints }) as unknown as HitObject;

section('circumCircle: 三点外接圆 (barycentric 外心)');
{
  const c = circumCircle({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 })!;
  assert(Math.abs(c.cx - 1) < 1e-6 && Math.abs(c.cy - 0) < 1e-6 && Math.abs(c.r - 1) < 1e-6, `(0,0)(2,0)(1,1) => 圆心(1,0) r=1 (实际 ${c.cx},${c.cy},${c.r})`);
  assert(circumCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }) === null, '共线 => null');
  assert(circumCircle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }) === null, '重合点 => null');
}

section('sliderHelperCircle: 仅 P 且恰好 3 控制点 (mapping tools 语义)');
{
  assert(sliderHelperCircle(slider(100, 100, 'P', [{ x: 200, y: 100 }, { x: 150, y: 200 }])) !== null, 'P 3 点 => 有圆');
  assert(sliderHelperCircle(slider(0, 0, 'P', [{ x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }, { x: -50, y: 0 }])) === null, 'P 5 点 => 排除');
  assert(sliderHelperCircle(slider(0, 0, 'L', [{ x: 100, y: 0 }])) === null, 'L => 无圆');
}

section('sliderHelperLines: L = 头->最后锚点; 直线开头/结尾段扩展');
{
  const l1 = sliderHelperLines(slider(300, 300, 'L', [{ x: 450, y: 300 }]));
  assert(l1.length === 1 && Math.abs(l1[0].dx - 1) < 1e-6 && Math.abs(l1[0].dy) < 1e-6, 'L 2 点 => 一条水平线');
  const l2 = sliderHelperLines(slider(0, 0, 'L', [{ x: 50, y: 50 }, { x: 100, y: 0 }]));
  assert(l2.length === 1 && l2[0].x === 0 && l2[0].y === 0 && Math.abs(l2[0].dx - 1) < 1e-6, 'L 多锚点 => 头->最后锚点 (中间忽略)');
  // B 滑条红锚点对: 首段 2 点 + 尾段 2 点 => 头尾各一条延伸线
  const b = sliderHelperLines(slider(0, 0, 'B', [{ x: 100, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 50 }]));
  assert(b.length === 2, `B 首尾直线段 => 2 条线 (实际 ${b.length})`);
  // B 3 点无重复 => 首段 3 点非直线 => 无线
  assert(sliderHelperLines(slider(0, 0, 'B', [{ x: 50, y: 30 }, { x: 100, y: 0 }])).length === 0, 'B 单曲段 => 无线');
}

section('clipLineToBox: 无限线裁剪 (playfield 外扩 1000px)');
{
  const { left, top, right, bottom } = GEO_CLIP_BOX;
  assert(left === -1000 && right === 1512 && top === -1000 && bottom === 1384, '裁剪框 = (-1000,-1000)-(1512,1384)');
  const h = clipLineToBox({ x: 0, y: 192, dx: 1, dy: 0 }, left, top, right, bottom)!;
  assert(h.x1 === -1000 && h.x2 === 1512 && h.y1 === 192 && h.y2 === 192, '水平线贯穿整框');
  const v = clipLineToBox({ x: 256, y: 0, dx: 0, dy: 1 }, left, top, right, bottom)!;
  assert(v.y1 === -1000 && v.y2 === 1384 && v.x1 === 256, '垂直线贯穿整框');
  assert(clipLineToBox({ x: 5000, y: 0, dx: 0, dy: 1 }, left, top, right, bottom) === null, '框外线 => null');
  const d = clipLineToBox({ x: 0, y: 0, dx: Math.SQRT1_2, dy: Math.SQRT1_2 }, left, top, right, bottom)!;
  assert(Math.abs(d.x1 - -1000) < 1e-6 && Math.abs(d.y1 - -1000) < 1e-6, '对角线交角点 (-1000,-1000)');
}

section('geoHelperSnap: 点/圆/线候选 + 点偏置优先 (阈值 6.4)');
{
  // 线 y=300 水平: 垂足吸附
  const line = { x: 300, y: 300, dx: 1, dy: 0 };
  const s1 = geoHelperSnap({ x: 250, y: 295 }, [line], [], [])!;
  assert(s1 && Math.abs(s1.x - 250) < 1e-6 && Math.abs(s1.y - 300) < 1e-6, '距线 5px => 垂足 (250,300)');
  assert(geoHelperSnap({ x: 250, y: 293 }, [line], [], []) === null, '距线 7px => 不吸附');
  // 圆 (150,137.5) r=62.5: 径向投射
  const circ = { cx: 150, cy: 137.5, r: 62.5 };
  const s2 = geoHelperSnap({ x: 150 + 58, y: 137.5 }, [], [circ], [])!;
  assert(s2 && Math.abs(s2.x - 212.5) < 1e-6 && Math.abs(s2.y - 137.5) < 1e-6, '距圆周 4.5px => 投射到 (212.5,137.5)');
  // 点偏置 -3: 点距 4.5 (score 1.5) 优先于线距 2 (score 2)
  const s3 = geoHelperSnap({ x: 250, y: 302 }, [line], [], [{ x: 254.5, y: 302 }])!;
  assert(s3 && s3.x === 254.5, '点偏置优先 (点距 4.5 胜线距 2)');
  // 圆心点吸附
  const s4 = geoHelperSnap({ x: 152, y: 139 }, [], [], [{ x: 150, y: 137.5 }])!;
  assert(s4 && s4.x === 150 && s4.y === 137.5, '圆心点吸附');
}

if (failures) { console.error(`\nTESTS_V84_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V84_ALL_PASSED');

// 验证器 v133: 视觉间距辅助线滑条轮廓修复 — 折线 miter 偏移改描边环带法 (精确等距)
// 背景: v126 用 offsetPolyline (顶点法线 + miter 补偿) 画滑条双侧轮廓, 在曲率半径 < 偏移量的
//   内弯处产生尖刺/回折, 贝塞尔/完美圆弧等曲线滑条的"边缘外扩等距"轮廓不准。
// 修复: renderer.drawDistanceGuideRing — 粗描边 (半径 distR+w/2, 圆角 join/cap) 后 destination-out
//   镂空 粗描边 (半径 distR-w/2), 留下宽度 w 的环带, 中心线距路径恒为 distR;
//   canvas round join/cap 粗描边区域 = 路径与半径 R 圆盘的 Minkowski 和 => 任意滑条类型精确等距,
//   内弯自动裁剪, 端帽自动半圆 (无需单独画端帽)。同时辅助线随堆叠偏移平移 (对齐物件显示位置)。
// 运行: node verifier/v133/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

const rn = read('src/osu/renderer.ts');
const cv = read('src/components/EditorCanvas.tsx');
const gh = read('src/osu/geometryHelpers.ts');

section('renderer.ts: drawDistanceGuideRing 描边环带法');
{
  assert(/export function drawDistanceGuideRing\(g: CanvasRenderingContext2D, points: \{ x: number; y: number \}\[\], distR: number, w: number, style: string\)/.test(rn),
    'drawDistanceGuideRing 导出 (路径点 + 等距半径 + 环带宽 + 颜色)');
  const i = rn.indexOf('export function drawDistanceGuideRing');
  const body = rn.slice(i, i + 1800);
  assert(/og\.lineJoin = 'round'; og\.lineCap = 'round';/.test(body), '圆角 join/cap (Minkowski 和, 端帽自动半圆)');
  assert(/trace\(distR \* 2 \+ w\)/.test(body), '外描边半径 = distR + w/2');
  assert(/destination-out/.test(body) && /trace\(Math\.max\(0\.001, distR \* 2 - w\)\)/.test(body), '镂空半径 = distR - w/2 (下限保护)');
  assert(/og\.setTransform\(g\.getTransform\(\)\)/.test(body), '沿用调用方变换 (含 dpr*scale 与堆叠平移)');
  assert(/outlineCanvas/.test(body), '复用离屏画布 (与 drawSliderBodyOutline 同模式)');
  assert(/g\.drawImage\(outlineCanvas, 0, 0\)/.test(body), '按设备像素贴回主画布');
}

section('EditorCanvas.tsx: 辅助线接线');
{
  assert(/import \{[^}]*drawDistanceGuideRing[^}]*\} from '@\/osu\/renderer'/.test(cv), '引入 drawDistanceGuideRing');
  assert(!/offsetPolyline/.test(cv), 'offsetPolyline 导入/调用已移除');
  assert(/drawDistanceGuideRing\(g, pts, distR, 1\.5, 'rgba\(242,181,68,0\.8\)'\)/.test(cv), '滑条走环带 (金色, 宽 1.5 osu px)');
  assert(/g\.translate\(dx, dy\); \/\/ v133: 环带随堆叠偏移/.test(cv), '滑条环带随堆叠偏移平移');
  assert(/g\.arc\(o\.x \+ dx, o\.y \+ dy, distR, 0, Math\.PI \* 2\)/.test(cv), '单点圆环随堆叠偏移');
  const gi = cv.indexOf('if (store.geoDist && store.geoEnabled)');
  assert(gi > 0 && /getStackOffsets\(bm\)/.test(cv.slice(gi, gi + 700)), '辅助线块内取堆叠偏移表');
}

section('geometryHelpers.ts: offsetPolyline 保留但标注废弃');
{
  assert(/export function offsetPolyline/.test(gh), 'offsetPolyline 保留 (v126 纯函数测试仍用)');
  assert(/v133: 渲染已改用描边环带法/.test(gh), '标注已被描边环带法取代');
}

console.log(failures ? `\nV133_CHECK_FAILED: ${failures}` : '\nV133_CHECK_PASSED');
process.exit(failures ? 1 : 0);

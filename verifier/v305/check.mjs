// 验证器 v305: F03 stable 选中效果对齐实机截图 —
//   圆圈/转盘选中 = 橙黄圆环 (hover = 蓝环), 滑条选中 = 蓝色边框高亮描边 + 头尾橙黄圆环;
//   取代 v232 的皮肤 hitcircleselect 方框 (用户截图确认 stable 无方框)
// 运行: node verifier/v305/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: stable 选中圆环/描边');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(!/function drawSelectionBox/.test(src), 'v232 方框绘制已移除');
  assert(/export function drawSelectionRing[\s\S]{0,120}color = '#f5a623'/.test(src), '选中环默认橙黄 #f5a623');
  // v308: 环改为覆盖圆圈白边, 不再是圈外 1.06r; v314: 环带 = 滑条选中蓝边带 0.81..0.925r (lw=0.115r, 弧 0.8675r = 带中心)
  assert(/const rad = r \* 0\.8675;/.test(src) && /og\.arc\(0, 0, rad, 0, Math\.PI \* 2\)/.test(src), 'v314: 圆环精确覆盖滑条选中描边带 (弧半径 0.8675r)');
  assert(/export function drawSliderBodyOutline\(g: CanvasRenderingContext2D, points: \{ x: number; y: number \}\[\], r: number, color = '#4df3ff', cover = false\)/.test(src),
    '滑条描边环支持颜色参数并导出 (v308: +cover 参数)');
  assert(/og\.strokeStyle = color;/.test(src), '描边环用传入颜色');
}

section('EditorCanvas.tsx: v308 hover 选中环已移除');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  // v308: 用户反馈 stable 悬停无任何效果 (单点黄环/滑条蓝边都不该有), v305 hoverObjRef 移除
  assert(!/hoverObjRef/.test(src), 'v308: hoverObjRef 已移除 (hover 不画选中样式)');
  assert(/hoverSliderRef/.test(src), 'hoverSliderRef 保留 (滑条控制点 hover 预览不受影响)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv305 全部通过');
process.exit(failures ? 1 : 0);

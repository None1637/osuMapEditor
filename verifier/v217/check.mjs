// 验证器 v217: 全局等比缩放 — 基准 2560×1440, zoom = clamp(min(w/2560, h/1440), 0.6, 1)。
// 背景: 原布局「四周 shrink-0 固定 + 中间 flex-1 弹性」, 窗口变小时只挤压中间游玩区。
// v217 在最外层套 zoom 容器; 单一系数 X/Y 等比不变形, 不等比余量由 flex-1 中间区吸收。
// canvas 适配 (v217 修正): CSS zoom 下 getBoundingClientRect/clientX 返回视觉 px,
// 而 canvas 内固定 px 绘制 (物件大圆 RAD=24/药丸/面板预留高度) 必须在布局 px 空间进行,
// 否则元素缩了内容不缩 (物件圆溢出) / 游玩区与上下时间轴间距比例变化。
// 统一约定: 绘制与命中用 zoomRect + zoomClientX/Y, 光栅用 zoomDpr (= dpr × zoom)。
// 运行: node verifier/v217/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('uiZoom.ts: 共享模块');
{
  const src = readSrc('src/osu/uiZoom.ts');
  assert(/export const DESIGN_W = 2560, DESIGN_H = 1440, UI_ZOOM_MIN = 0\.6;/.test(src), '基准 2560×1440, 下限 0.6');
  assert(/Math\.min\(window\.innerWidth \/ DESIGN_W, window\.innerHeight \/ DESIGN_H\)/.test(src), 'zoom = min(宽比, 高比) (等比, 不变形)');
  assert(/Math\.max\(UI_ZOOM_MIN, Math\.min\(1,/.test(src), 'clamp 到 [0.6, 1] (不放大)');
  assert(/export function useUiZoom/.test(src) && /window\.addEventListener\('resize', on\)/.test(src), 'useUiZoom hook + resize 监听');
  assert(/export function zoomRect\(el: Element\): LayoutRect/.test(src), 'zoomRect: 布局空间 rect');
  assert(/width: r\.width \/ z, height: r\.height \/ z, left: r\.left \/ z, top: r\.top \/ z/.test(src), 'zoomRect 四维均除以 zoom');
  assert(/export function zoomClientX/.test(src) && /export function zoomClientY/.test(src), 'zoomClientX/Y: 事件坐标转布局空间');
  assert(/\(window\.devicePixelRatio \|\| 1\) \* uiZoom\(\)/.test(src), 'zoomDpr = dpr × zoom (backing = 屏幕物理像素)');
}

section('App.tsx: zoom 容器');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ useUiZoom[^}]*\} from '@\/osu\/uiZoom';/.test(src), 'useUiZoom 来自共享模块 (无本地副本)'); // v225: import 同排新增 textZoomComp, 放宽断言
  assert(!/const DESIGN_W = 2560/.test(src), 'App.tsx 不再本地定义基准常量');
  assert(/zoom: uiZoom, width: `\$\{100 \/ uiZoom\}vw`, height: `\$\{100 \/ uiZoom\}vh`/.test(src), '内层布局尺寸 = 视口/zoom (缩放后填满窗口)');
  assert(/h-screen w-screen overflow-hidden/.test(src), '外层容器撑满窗口 (不缩放)');
}

section('EditorCanvas.tsx: 布局空间绘制/命中');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/import \{ uiZoom, zoomRect, zoomClientX, zoomClientY, zoomDpr \} from '@\/osu\/uiZoom';/.test(src), '导入适配工具');
  assert(!/c\.getBoundingClientRect\(\)/.test(src), '不再直接用视觉 rect');
  assert(/const dpr = zoomDpr\(\);/.test(src) && /const r = zoomRect\(c\);/.test(src), '渲染: zoomDpr + zoomRect');
  assert(/zoomClientX\(e\.clientX\) - r\.left - ox/.test(src), 'toOsu: 布局空间命中');
  assert(/10 \/ uiZoom\(\) \/ playfieldTransform\(zoomRect\(c\)\)\.scale/.test(src), '手柄命中容差按视觉 px 基准换算 (v223: 经 playfieldTransform, 含游玩区平移/缩放)');
  assert(/\(r\.left \+ ox \+ x \* scale\) \* z/.test(src), '__osuToClient 乘 zoom 回视觉 client 坐标 (CDP 测试兼容)');
}

section('Timelines.tsx: 布局空间绘制/命中');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/import \{ zoomRect, zoomClientX, zoomClientY, zoomDpr \} from '@\/osu\/uiZoom';/.test(src), '导入适配工具');
  assert(!/getBoundingClientRect/.test(src), '不再直接用视觉 rect (物件大圆/药丸随整体缩放)');
  assert(!/window\.devicePixelRatio/.test(src), '光栅统一 zoomDpr');
  assert(!/(?<!zoomClientX\()e\.clientX/.test(src) && !/(?<!zoomClientY\()e\.clientY/.test(src), '事件坐标全部经 zoomClientX/Y');
  assert(/r: \{ width: number; height: number \}/.test(src), 'drawWaveLayer/drawDimOverlay 参数放宽为尺寸接口');
}

section('回归: 四周面板布局未被破坏');
{
  const src = readSrc('src/App.tsx');
  assert((src.match(/w-56 shrink-0/g) ?? []).length >= 2, '左右栏 w-56 shrink-0 保留 (基准分辨率下尺寸不变)');
  assert(/flex-1 flex min-h-0/.test(src), '中间弹性行保留 (不等比余量吸收处)');
}

if (failures) { console.error(`V217 FAILED: ${failures}`); process.exit(1); }
console.log('V217 ALL PASSED');

// 验证器 v232: 物件选中效果默认 stable。
// v305 修正 (F03): 用户对比 stable 实机截图确认 — stable 选中是橙黄圆环 + 滑条蓝色边框高亮,
//   不是 hitcircleselect 方框; drawSelectionBox 移除, 改 drawSelectionRing (renderer.ts)。
//   皮肤 hitcircleselect 加载/回退保留 (本验证器前段仍覆盖)。
// v308 再修正: hover 不显示任何选中样式 (v305 hover 蓝环移除); 选中环/描边改为覆盖原边框
//   (圆环弧半径 r-0.3lw 压在 hitcircle 白边上; 滑条描边 cover 模式环带 0.79..0.96r + 外缘辉光)。
// displaySettings 新增 selectionStyle ('stable'|'lazer', 默认 'stable', 白名单解析);
// DisplayPanel 增加「物件选中效果」下拉行 (stable 圆环 / lazer 描边)。
// 运行: node verifier/v232/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('skin.ts: hitcircleselect 加载与程序化回退');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/hitcircleselect\?: SkinImage;/.test(src), 'Skin 接口含可选 hitcircleselect');
  assert(/\['hitcircleselect', 'hitcircleselect\.png'\],/.test(src), 'SKIN_FILES 加载 hitcircleselect.png (@2x 走 fileVariants 既有通道)');
  assert(/function drawHitcircleSelect\(size: number\): HTMLCanvasElement/.test(src), '程序化回退生成函数 drawHitcircleSelect');
  assert(/g\.arcTo\(/.test(src) && /#99ccff/.test(src), '回退 = 浅蓝圆角方框描边 (arcTo 圆角)');
  assert(/hitcircleselect: drawHitcircleSelect\(256\),/.test(src), 'makeProceduralBase 默认生成 256px 选框');
}

section('displaySettings.ts: selectionStyle 字段 (默认 stable)');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/selectionStyle: 'stable' \| 'lazer';/.test(src), '接口含 selectionStyle 字符串枚举字段');
  assert(/selectionStyle: 'stable',/.test(src), '默认值 stable');
  assert(/p\.selectionStyle === 'stable' \|\| p\.selectionStyle === 'lazer' \? p\.selectionStyle : def\.selectionStyle/.test(src), 'load 白名单解析, 非法值回退默认');
}

section('renderer.ts: drawSelectionDecor 按 selectionStyle 分支');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const stableSel = displaySettings\.selectionStyle === 'stable';/.test(src), 'stable 分支判断');
  // v305: F03 — 用户对比 stable 截图确认选中是圆环/边框高亮而非 hitcircleselect 方框, drawSelectionBox 已移除
  assert(/export function drawSelectionRing\(g: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#f5a623'\)/.test(src),
    'stable 选中 = 橙黄圆环 drawSelectionRing (v305, 取代 v232 皮肤方框)');
  assert(/sliderOutlineSprite\(p\.points, radius, stableSel \? '#4a90e2' : '#4df3ff', stableSel, o\.id/.test(src), // v340: 缓存 sprite
    'stable 滑条选中 = sliderborder 蓝色高亮描边 (v305; v308 起 cover 模式覆盖原白边)');
  assert(/drawSelectionRing\(g, o\.x, o\.y, radius\);\s*const tail = p\.points\[p\.points\.length - 1\];\s*if \(tail\) drawSelectionRing\(g, tail\.x, tail\.y, radius\);/.test(src),
    'stable 滑条: 头 (x,y) 与尾 (路径终点) 各画橙黄圆环 (v305)');
  assert(/else if \(stableSel\) \{[\s\S]*?drawSelectionRing\(g, o\.x, o\.y, radius\);/.test(src), 'stable 其他物件在 (x,y) 画橙黄圆环 (v305)');
  assert(/drawSliderBodyOutline/.test(src) && /setLineDash\(\[6, 4\]\)/.test(src), 'lazer 描边环/虚线环旧行为未删');
  {
    const ec = readSrc('src/components/EditorCanvas.tsx');
    // v308: 用户反馈 stable 悬停无任何效果 — hover 蓝环/蓝边已移除, 仅选中才显示选中效果
    assert(!/hoverObjRef/.test(ec), 'v308: hover 选中环移除 (stable 悬停无效果)');
  }
}

section('DisplayPanel.tsx: 「物件选中效果」下拉行');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  const dict = readSrc('src/i18n/dicts/zh-CN/display.ts');
  // v346 i18n: name/options 改 nameKey+nameEn / [value, key, en] 元组, zh-CN 译文在 display 词典分片
  assert(/key: 'selectionStyle', nameKey: 'display\.selection_style_name'/.test(src), 'SELECT_ROWS 含物件选中效果行');
  assert(/'display\.selection_style_name': '物件选中效果/.test(dict), '词典行名译文 = 物件选中效果');
  assert(/\['stable', 'display\.selection_style_option_stable', 'stable rings'\], \['lazer', 'display\.selection_style_option_lazer', 'lazer outline'\]/.test(src), '选项 stable 圆环 / lazer 描边 (v305 改名; i18n key)');
  assert(/'display\.selection_style_option_stable': 'stable 圆环'/.test(dict) && /'display\.selection_style_option_lazer': 'lazer 描边'/.test(dict), '词典选项译文 = stable 圆环 / lazer 描边');
}

if (failures) { console.error(`V232 FAILED: ${failures}`); process.exit(1); }
console.log('V232 ALL PASSED');

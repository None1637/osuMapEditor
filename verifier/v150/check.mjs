// 验证器 v150: ① 皮肤 altruism v1 hitcircle 偏小 — hitcircle 族按贴图固有尺寸显示
//   (lazer LegacyMainCirclePiece: AutoSize + WithMaximumSize(256), 不再拉伸进 2r 盒子)
// ② 播放音乐时无法点击皮肤面板 — SkinListPanel 的 Row 是组件内定义组件, 播放中 App 60fps 重渲染
//   导致按钮每帧重挂载吞掉 click; 提升为模块级组件
// 运行: node verifier/v150/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v150/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v150/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V150_TESTS_*)
fs.unlinkSync(out);

section('skin.ts: hitcircle 族固有宽度登记 + hitcircleSpriteWidth 辅助');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/const INTRINSIC_SIZE_KEYS = new Set<keyof Skin>\(\[/.test(src), 'INTRINSIC_SIZE_KEYS 集合存在');
  const setBlk = src.slice(src.indexOf('INTRINSIC_SIZE_KEYS = new Set'), src.indexOf('])', src.indexOf('INTRINSIC_SIZE_KEYS = new Set')));
  for (const k of ['hitcircle', 'hitcircleoverlay', 'sliderstartcircle', 'sliderstartcircleoverlay', 'sliderendcircle', 'sliderendcircleoverlay', 'sliderb'])
    assert(setBlk.includes(`'${k}'`), `集合含 ${k}`);
  assert(/if \(INTRINSIC_SIZE_KEYS\.has\(key\)\) skinSpriteWidth\.set\(img, img\.width/.test(src), 'SKIN_FILES 循环按集合登记固有宽度 (原仅 sliderb)');
  assert(/export function hitcircleSpriteWidth\(img: SkinImage\): number \{/.test(src), 'hitcircleSpriteWidth 导出');
  assert(/Math\.min\(skinSpriteWidth\.get\(img\) \?\? 128, 256\)/.test(src), '上限 256 (lazer WithMaximumSize), 未登记回退 128');
}

section('renderer.ts: hitcircle 族调用点按固有尺寸绘制');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/hitcircleSpriteWidth/.test(src.split('\n').slice(0, 12).join('\n')), '导入 hitcircleSpriteWidth');
  // drawCircle (命中缩放 scale 也乘入)
  assert(/const cw = \(img: SkinImage\) => size \* scale \* hitcircleSpriteWidth\(img\) \/ 128;/.test(src), 'drawCircle cw 含 scale');
  assert(/drawSprite\(g, tintedSprite\(skin\.hitcircle, bodyColor\), x, y, cw\(skin\.hitcircle\)\)/.test(src), 'drawCircle hitcircle 固有尺寸 (v200: 染色变量改名 bodyColor)');
  assert(/drawSprite\(g, skin\.hitcircleoverlay, x, y, cw\(skin\.hitcircleoverlay\)\)/.test(src), 'drawCircle overlay 固有尺寸');
  // drawSlider 头/尾 (v178 适配: 头 cw 乘入命中缩放 hs.scale; 尾独立 ecw)
  assert(/drawSprite\(g, tintedSprite\(skin\.sliderstartcircle, headColor\), o\.x, o\.y, cw\(skin\.sliderstartcircle\)\)/.test(src), 'slider 头固有尺寸 (v203: 染色变量改名 headColor)');
  assert(/const cw = \(img: SkinImage\) => size \* hs\.scale \* hitcircleSpriteWidth\(img\) \/ 128;/.test(src), 'slider 头 cw 含命中缩放 (v178)');
  assert(/drawSprite\(g, skin\.sliderendcircleoverlay, endP\.x, endP\.y, ecw\(skin\.sliderendcircleoverlay\)\)/.test(src), 'slider 尾 overlay 固有尺寸 (v178: 尾部 ecw)');
  // pending 放置预览头部
  assert(/const scw = \(img: SkinImage\) => size \* hitcircleSpriteWidth\(img\) \/ 128;/.test(src), 'pending 头部 scw');
  // 旧撑满盒子调用已移除
  assert(!/tintedSprite\(skin\.hitcircle, color\), x, y, size \* scale\)/.test(src), 'drawCircle 旧 size*scale 调用已移除');
  assert(!/tintedSprite\(skin\.sliderstartcircle, color\), o\.x, o\.y, size\)/.test(src), 'slider 头旧 size 调用已移除');
}

section('SkinListPanel.tsx: Row 提升模块级 (播放中 60fps 重渲染不再重挂载按钮)');
{
  const src = readSrc('src/components/SkinListPanel.tsx');
  const panelIdx = src.indexOf('export function SkinListPanel');
  const rowIdx = src.indexOf('function Row(');
  assert(rowIdx !== -1 && rowIdx < panelIdx, 'Row 定义在 SkinListPanel 之前 (模块级)');
  assert(!src.includes('const Row = ('), '组件内 Row 定义已移除');
  assert(/function Row\(\{ name, label, current, busy, onChoose \}:/.test(src), 'Row 接收 current/busy/onChoose props');
  assert(/<Row name=\{null\} label="默认皮肤 \(内置\)" current=\{current\} busy=\{busy\} onChoose=\{choose\} \/>/.test(src), '默认皮肤行传 props');
  assert(/skins\.map\(name => <Row key=\{name\} name=\{name\} label=\{name\} current=\{current\} busy=\{busy\} onChoose=\{choose\} \/>\)/.test(src), '皮肤行传 props');
}

if (failures) { console.error(`\nV150_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV150_ALL_PASSED');

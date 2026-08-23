// 验证器 v19: 滑条身宽度/分层对齐 lazer LegacySliderBody (经典皮肤)
// 依据 (ppy/osu master, 本地克隆 osu/):
//  - PlaySliderBody.PathRadius = OBJECT_RADIUS(64) * Scale -> 滑条身总宽 = 2r, 与单点直径相同
//  - LegacySliderBody.ColourAt: shadow_portion = 5/64 ≈ 0.078 (外缘阴影), border_portion = 0.1875 (白边)
//    -> 白边外径 = 2r*(1-0.078) = 1.844r, 轨道外径 = 2r*(1-0.1875) = 1.625r
//  - 轨道 = (SliderTrackOverride ?? combo色).Opacity(0.7), 径向 Darken(0.1) -> Lighten(0.5)
//  - Colour4.Lighten: amount *= 0.5; c*(1+0.5a)+a clamp (Darken(n)=Lighten(-n))
// v19 修订: 轨道离屏合成 — 先不透明画渐变再 destination-out 降到 0.7 alpha,
//   内部透出深色背景 (修复: 白边衬底把轨道内部洗白, lazer 内部是暗的)
// v19 实验修订 (用户要求对齐 stable 观感试看): 轨道基色纯黑, lazer 三级渐变整段注释备查,
//   lazerLighten 函数同步注释; 恢复 lazer 观感 = 取消注释 + 删掉 '#000' 填充行
// 运行: cd app && node verifier/v19/check.mjs; node verifier/v19/cdp-visual.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: 滑条身宽度对齐 lazer (总宽 2r, 不再 2.1r)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(src.includes('function paintSliderBody'), 'paintSliderBody 离屏分层函数');
  assert(!src.includes('1.05'), '白描边不再放大到 2.1r');
  assert(!src.includes('18,18,26'), '删除暗底填充层 (lazer 轨道自身半透明, 无暗底)');
  assert(src.includes("stroke(r * 2, 'rgba(0,0,0,0.25)')"), '外缘阴影层总宽 = 2r (与单点同宽)');
  assert(src.includes('r * 2 * 0.922'), '白边外径 = 1.844r (1 - shadow_portion)');
  assert(src.includes('r * 2 * 0.8125'), '轨道外径 = 1.625r (1 - border_portion 0.1875)');
}

section('renderer.ts: 轨道 = 纯黑实验样式 (lazer 渐变注释备查) + 离屏统一 0.7 alpha (内部不透白)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(src.includes('// function lazerLighten(color: string, amount: number): string {'), 'lazerLighten 公式整段注释备查 (恢复渐变时取消注释)');
  assert(src.includes('//   const a = amount * 0.5'), 'Lighten 公式保留在注释中 (amount 先乘 0.5)');
  assert(src.includes("stroke(r * 2 * 0.8125, '#000')"), '轨道基色纯黑填充 (对齐 stable 观感试看)');
  assert(src.includes('// stroke(r * 2 * 0.3, lazerLighten(track, 0.5));'), 'lazer 中心 Lighten(0.5) 渐变行已注释');
  assert(src.includes('// stroke(r * 2 * 0.8125, lazerLighten(track, -0.1));'), 'lazer 外圈 Darken(0.1) 渐变行已注释');
  assert(src.includes("'destination-over'"), '轨道用 destination-over 垫进镂空 (不与白边相叠)');
  assert(src.includes("stroke(r * 2 * 0.8125, 'rgba(0,0,0,0.3)')"), '轨道区域 alpha 统一 x0.7 (Opacity(0.7))');
  assert(src.indexOf('r * 2 * 0.922') < src.indexOf("'destination-out'"), '白边整条描边后才镂空内部成环');
  assert(src.indexOf("'destination-over'") < src.lastIndexOf("stroke(r * 2 * 0.8125, '#000')"), '镂空后才垫入黑色轨道 (lastIndexOf: 镂空 cut 也用同字面量)');
  assert(src.lastIndexOf("stroke(r * 2 * 0.8125, '#000')") < src.indexOf("rgba(0,0,0,0.3)"), '最后才把轨道区域降到 0.7 alpha');
}

section('renderer.ts: 离屏合成 + 缓存接线');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(src.includes('function sliderBodySprite'), 'sliderBodySprite 离屏合成入口');
  assert(src.includes('bodyCache.set'), '已放置滑条按物件 id 缓存');
  assert(src.includes('bodyCache.clear()') && src.includes('bodyCache.delete(id)'), 'invalidatePath 同步失效 bodyCache');
  const calls = src.match(/sliderBodySprite\(/g) ?? [];
  assert(calls.length === 3, `sliderBodySprite 一定义两调用 (drawSlider 带缓存 + drawPendingSlider 用 scratch), 实际 ${calls.length - 1} 处调用`);
  assert(src.includes('bm.colors.sliderTrackOverride || color'), '轨道色 SliderTrackOverride 优先于 combo 色');
  assert(src.includes("bm.colors.sliderBorder || '#ffffff'"), '白边取 sliderBorder 皮肤色');
}

section('renderer.ts: 离屏超采样抗锯齿 (按主画布 dpr*scale 高分绘制)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(src.includes('g.getTransform().a'), '超采样倍数取主画布当前变换 (dpr*scale)');
  assert(src.includes('g.scale(q, q)'), '离屏按 q 倍放大坐标系绘制');
  assert(src.includes('Math.min(4, Math.max(1, ss))'), '超采样倍数钳制 [1,4]');
  assert(src.includes('${q.toFixed(2)}'), '缓存 key 含超采样倍数 (缩放变化重新合成)');
  assert(src.includes('g.drawImage(body.c, body.dx, body.dy, body.w, body.h)'), 'drawImage 缩回 osu 坐标矩形');
}

if (failures) { console.error(`\nVERIFIER_V19_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V19_ALL_TESTS_PASSED');

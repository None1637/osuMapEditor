// 验证器 v173: 数字按贴图固有逻辑尺寸显示 (lazer LegacySpriteText 自然尺寸, 单位 = 128 盒子)
// 修复"数字即圈"皮肤 (a(No Number): default-N = 160x160 整圈, hitcircle = 1x1) 数字被固定 52/128 高度压小
// 运行: node verifier/v173/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: drawNumber 固有尺寸');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/function drawNumber\(g: CanvasRenderingContext2D, skin: Skin, num: number, x: number, y: number, box: number\)/.test(src),
    '签名改收 128 盒子 (box = 2r)');
  // v174 适配: 末尾补 × TEXT_SCALE (0.8, lazer hitcircle_text_scale)
  assert(/const heights = glyphs\.map\(gl => box \* \(gl\.height \/ \(skinScaleAdjust\.get\(gl\) \?\? 1\)\) \/ 128 \* TEXT_SCALE\);/.test(src),
    '每字形高 = 贴图逻辑高 (÷ScaleAdjust) / 128 盒子 × 0.8 (v174)');
  assert(/const widths = glyphs\.map\(\(gl, i\) => heights\[i\] \* \(gl\.width \/ gl\.height\)\);/.test(src),
    '宽按贴图宽高比');
  assert(!/52 \/ 128/.test(src), '旧固定 52/128 高度已移除');
  // 两处调用点都传盒子 (v178 适配: 滑条头盒子乘命中缩放 hs.scale, size = r*2)
  const calls = src.match(/drawNumber\(g, skin, num, [^)]*r \* 2\)/g) ?? [];
  assert(calls.length === 1 && /drawNumber\(g, skin, num, o\.x, o\.y, size \* hs\.scale\)/.test(src),
    `单点 (r*2) + 滑条头 (size*hs.scale, v178) 两处调用都传盒子 (r*2 实际 ${calls.length})`);
}

section('行为保持: 经典皮肤与 overlap 分支');
{
  const src = readSrc('src/osu/renderer.ts');
  // 经典 35x52 数字: v174 起 box*52*0.8/128 (lazer 0.8x blanket scale) — 由公式保证, 注释留档
  assert(/经典 35x52 数字: box\*52\*0\.8\/128, 与 lazer 一致/.test(src), '注释记录经典皮肤等价性 (v174: ×0.8)');
  assert(/if \(skin\.hitCircleOverlap !== null\)/.test(src), 'v170 overlap 分支保留');
  // v174: overlap 连同 0.8 换算
  assert(/const ovDraw = skin\.hitCircleOverlap \* box \/ 128 \* TEXT_SCALE;/.test(src), 'overlap 换算盒子单位 (×0.8, v174)');
  assert(/const spacing = 33 \/ 35;/.test(src), '未定义 overlap 保持旧 33/35 字距');
  assert(/y - heights\[i\] \/ 2/.test(src), '每字形各自垂直居中');
}

console.log(failures ? `\nV173 FAILED: ${failures}` : '\nV173 ALL PASSED');
process.exit(failures ? 1 : 0);

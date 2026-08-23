// 验证器 v48: followpoint 尺寸 = lazer WithMaximumSize 居中裁剪 (修复: 等比缩放导致箭头偏窄/视觉间距偏宽)
// 运行: cd app && node verifier/v48/check.mjs; node verifier/v48/cdp-v48.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v48/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v48/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('followPoints.ts: followPointCrop (lazer LegacySkinExtensions.WithMaximumSize)');
{
  const src = readSrc('src/osu/followPoints.ts');
  assert(/export const FP_MAX_W = 128/.test(src) && /export const FP_MAX_H = 64/.test(src), 'maxSize 常量 (128, 64) = (OBJECT_RADIUS*2, OBJECT_RADIUS)');
  assert(/export function followPointCrop/.test(src), '导出 followPointCrop');
  assert(/dispW <= FP_MAX_W && dispH <= FP_MAX_H/.test(src), '未超限 (DisplayWidth/Height) 原样返回');
  assert(/Math\.min\(imgW, FP_MAX_W \* scaleAdjust\)/.test(src) && /Math\.min\(imgH, FP_MAX_H \* scaleAdjust\)/.test(src), '逐轴独立 min (maxSize *= ScaleAdjust)');
  assert(/imgW \/ 2 - sw \/ 2/.test(src) && /imgH \/ 2 - sh \/ 2/.test(src), '居中裁剪 (Crop 中心)');
  assert(/dw: sw \/ scaleAdjust, dh: sh \/ scaleAdjust/.test(src), '显示尺寸 = 裁剪像素 / ScaleAdjust (croppedTexture.ScaleAdjust 保留)');
}

section('renderer.ts: drawFollowPoints 用裁剪矩形绘制, 移除等比缩放');
{
  const rn = readSrc('src/osu/renderer.ts');
  assert(/followPointCrop\(img\.width, img\.height, adj\)/.test(rn), '调用 followPointCrop');
  assert(/drawImage\(img, c\.sx, c\.sy, c\.sw, c\.sh, -w \/ 2, -h \/ 2, w, h\)/.test(rn), 'drawImage 带源裁剪矩形 (9 参数)');
  assert(/w = c\.dw \* k, h = c\.dh \* k/.test(rn) && /k = \(radius \/ 64\) \* p\.scale/.test(rn), '绘制尺寸 = 显示尺寸 * end.Scale * 动画缩放');
  assert(!/Math\.min\(1, 128 \/ tw, 64 \/ th\)/.test(rn), '旧的等比缩放 box 已移除');
  // v173 适配: box 检查限定在 drawFollowPoints 函数体内 (v173 起 drawNumber 参数名也叫 box)
  const fpIdx = rn.indexOf('drawFollowPoints');
  const fpBody = rn.slice(fpIdx, rn.indexOf('\nfunction ', fpIdx + 1) > 0 ? rn.indexOf('\nfunction ', fpIdx + 1) : rn.length);
  assert(!/box\b/.test(fpBody), 'drawFollowPoints 内无残留 box 变量');
}

if (failures) { console.error(`\nVERIFIER_V48_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V48_ALL_TESTS_PASSED');

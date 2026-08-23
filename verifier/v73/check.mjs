// 验证器 v73: 手绘滑条对齐 lazer 导出 stable (B 样条段 => BSplineToBezier, 弧段 => 圆预设贝塞尔锚点)
// 运行: cd app && node verifier/v73/check.mjs; node verifier/v73/cdp-v73.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v73/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v73/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('pathApproximator.ts: bSplineToBezier 导出');
{
  const src = readSrc('src/osu/freehand/pathApproximator.ts');
  assert(/export function bSplineToBezier\(/.test(src), '导出 bSplineToBezier');
  assert(/bSplineToBezierInternal\(controlPoints, degreeIn\)/.test(src), '复用 Boehm 内部实现');
}

section('freehandFit.ts: 转换器保留 (stable 兼容备用) + v74 落盘语义');
{
  const src = readSrc('src/osu/freehand/freehandFit.ts');
  assert(/CIRCLE_PRESETS/.test(src) && /5\.69720464620727/.test(src), '圆预设 (BezierConverter circle_presets)');
  assert(/export function convertCircleToBezierAnchors/.test(src), '导出 convertCircleToBezierAnchors (stable 导出备用)');
  // v74 语义变更: 落盘 'B4' 保留 builder 原始控制点, 弧特判仅单段
  assert(/segments\.length === 1 \? tryCircleArc/.test(src), "v74: 弧特判仅单段 (整条 'P'), 多段保留 B 样条控制点");
  assert(!/bSplineToBezier\(segment, degree\)/.test(src), 'v74: 不再转贝塞尔锚点落盘');
}

section('freehandFit.ts: tryCircleArc continue 语义修正');
{
  const src = readSrc('src/osu/freehand/freehandFit.ts');
  assert(/if \(dir === 0\) continue;/.test(src), 'dir==0 => continue (跳过状态更新)');
  assert(/if \(dir2 === 0\) continue;/.test(src), 'dir2==0 => continue');
}

section('EditorCanvas.tsx: 预览与成图同源 (均走 fitSegmentsToPoints)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const calls = src.split('fitSegmentsToPoints(').length - 1;
  assert(calls === 2, `fitSegmentsToPoints 调用点 = 2 (预览+成图) (实际 ${calls})`);
  assert(/updateFreehandPreview[\s\S]{0,300}fitSegmentsToPoints/.test(src), '预览走转换后数据');
  assert(/finishFreehandSlider[\s\S]{0,400}fitSegmentsToPoints/.test(src), '成图走转换后数据');
}

if (failures) { console.error(`\nVERIFIER_V73_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V73_ALL_PASSED');

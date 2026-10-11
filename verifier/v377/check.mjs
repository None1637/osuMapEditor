// 验证器 v377: 手绘滑条落盘 'B4' -> stable 兼容 'B' + 渲染层移除 B4 (soulten 反馈: stable osu 读不了 B4) —
//   1) bsplineToStableBezier: 双候选 (Schneider 容差拟合 / Boehm 精确) 取锚点少者, 红锚点分段保留;
//   2) finishFreehandSlider 落盘 'B' (单段圆弧仍 'P'), 转换后锚点取整;
//   3) parser: 读入 'B<n>' 即转 'B' (内存不再持有 B4) + 序列化兜底转换;
//   4) 渲染层移除 B4 (computeRawPath 无分支 / resolveSliderCurveType 不再特判 / 预览经 bsplineRawPath 直接求值),
//      杜绝以后再存出 B4。
// 运行: node verifier/v377/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v377/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v377/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V377_TESTS_*)
fs.unlinkSync(out);

section('pathApproximator.ts: bsplineToStableBezier (双候选少锚点)');
{
  const src = read('src/osu/freehand/pathApproximator.ts');
  assert(/export function bsplineToStableBezier<T extends Vec>\(pts: T\[\], degree = 4/.test(src), 'bsplineToStableBezier 导出 (degree 参数)');
  assert(/export function fitBezierToPolyline\(input: Vec\[\], maxError: number\): Vec\[\]/.test(src), 'Schneider 拟合导出');
  assert(/const fitted = fitBezierToPolyline\(bSplineToPiecewiseLinear\(seg, degree\), maxError\);/.test(src), '候选 b: 容差拟合');
  assert(/const best = fitted\.length < exact\.length \? fitted : exact;/.test(src), '双候选取锚点少者');
  assert(/function fitCubic\([\s\S]*reparameterize/.test(src) && /function generateBezier\(/.test(src), 'FitCurve 核心 (最小二乘 + Newton 重参数化)');
}

section('EditorCanvas.tsx: 落盘与预览 (v387 适配: B4 恢复一等类型, v377 落盘转 B 已撤销)');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/const curveType = singleP \? 'P' : 'B4';/.test(src) && !/bsplineToStableBezier\(ctrl\)/.test(src),
    "finishFreehandSlider 落盘 'B4' (单段圆弧 => P; v387 撤销 v377 转 'B')");
  assert(/sliderGeometryLength\(curveType, finalPts\)/.test(src), '长度按落盘控制点列计算');
  assert(/curveType: bspline \? 'B4' : computed\.curveType/.test(src), "手绘幽灵按 'B4' 渲染 (预览=落盘, v387)");
}

section('parser.ts: B4 读入/落盘原样保留 (v387 适配: v377 读入转换+序列化兜底已撤销)');
{
  const src = read('src/osu/parser.ts');
  assert(!/bsplineToStableBezier/.test(src), 'parser 不再引用 bsplineToStableBezier (v387 撤销读入/落盘转换)');
  assert(/!s\.includes\(':'\)/.test(src), '段内类型字母 token 容错跳过 (v387)');
}

section('sliderPath.ts: B4 渲染恢复 (v387 适配)');
{
  const src = read('src/osu/sliderPath.ts');
  assert(/if \(bSplineDeg !== null\) return bsplineRawPath\(pts, bSplineDeg\);/.test(src), "computeRawPath 'B<n>' 分支 (v387 恢复)");
  assert(/if \(parseBSplineType\(current\) !== null\) return current;/.test(src), 'resolveSliderCurveType 保持 B4 (v387)');
  assert(/export function bsplineRawPath\(pts: Vec2\[\], degree = 4\)/.test(src), 'bsplineRawPath 导出 (v387 degree 参数化)');
  assert(/bspline \? bsplineRawPath\(s\) : SliderPath\.computeRawPath/.test(src), 'computePendingPath 手绘预览 B 样条求值');
}

if (failures) { console.error(`V377 FAILED: ${failures}`); process.exit(1); }
console.log('V377 ALL PASSED');

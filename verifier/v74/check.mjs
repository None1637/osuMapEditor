// 验证器 v74: 手绘滑条四项 — B4 少控制点落盘 / 拖过时间轴不 seek / 预览控制点连线 / 按下即放头续拖手绘
// 运行: cd app && node verifier/v74/check.mjs; node verifier/v74/cdp-v74.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v74/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v74/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section("sliderPath.ts: 'B4' 路径 + 类型解析 + 预览");
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/case 'B4': return bsplinePath/.test(src), "computeRawPath 'B4' 分支");
  assert(/bSplineToPiecewiseLinear\(segment, 4\)/.test(src), 'bsplinePath 逐段 degree-4');
  assert(/current === 'B4'\) return 'B4'/.test(src), 'resolveSliderCurveType 保持 B4');
  assert(/p\.bspline/.test(src) && /bspline \? 'B4' : inferSegmentType/.test(src), 'computePendingPath bspline 标记 => B4 渲染');
}

section('EditorCanvas.tsx: B4 落盘 + 一键手绘 + 候选期 canvasDragging');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/singleArc && ctrl\.length === 3 \? 'P' : 'B4'/.test(src), "finishFreehandSlider 落盘 'B4'");
  assert(/bspline: true/.test(src), '预览点带 bspline 标记');
  assert(/isHead = store\.pendingSlider\.length === 0/.test(src), '无待放点 => 按下即放头 (isHead 候选)');
  assert(/drawCandRef\.current = \{ x: p\.x, y: p\.y, sp: sp0, redAnchor: e\.ctrlKey, isHead \}/.test(src), '头部候选登记');
  assert(/store\.canvasDragging = true;[\s\S]{0,60}store\.emit\(\);[\s\S]{0,20}return;/.test(src), '候选期 canvasDragging=true (拖过时间轴不 seek)');
  assert(/!c\.isHead/.test(src), '头部候选松开不加点不切红');
  assert(/freehandRef\.current && e\.target !== canvasRef\.current/.test(src), '手绘拖出画布 (时间轴上方) 继续采样');
  assert(/!freehandRef\.current && !drawCandRef\.current[\s\S]{0,140}\) onMouseUp\(\)/.test(src), 'onMouseLeave 不提前终止手绘/候选 (根因: 提前 finish 后 canvasDragging 被清 => 时间轴误 seek; v228 同条件追加物件/节点拖拽豁免)');
}

section('renderer.ts: 放置预览控制点连线');
{
  const src = readSrc('src/osu/renderer.ts');
  const fnStart = src.indexOf('function drawPendingSlider');
  const fnEnd = src.indexOf('// 选中滑条的外形描边');
  const body = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';
  assert(/strokeStyle = '#ffffff'; g\.lineWidth = 2/.test(body) && /moveTo/.test(body) && /lineTo/.test(body), '预览画 2px 白线连接控制点 (与选中滑条一致)');
}

section('freehandFit.ts: v74 落盘语义 (raw 控制点, 弧仅单段)');
{
  const src = readSrc('src/osu/freehand/freehandFit.ts');
  assert(/segments\.length === 1 \? tryCircleArc/.test(src), '弧特判仅单段');
  assert(!/bSplineToBezier\(segment/.test(src), '不再转贝塞尔锚点落盘');
}

if (failures) { console.error(`\nVERIFIER_V74_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V74_ALL_PASSED');

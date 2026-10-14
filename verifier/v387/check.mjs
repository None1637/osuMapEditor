// 验证器 v387: 手绘滑条全面对齐 lazer — B4 恢复一等 curveType + stable 兼容警告/全图转换
//   1) parser: 读入 'B<n>' 原样保留 (撤销 v377 读入转换) + 段内类型字母 token 容错 + 序列化原样写回 (撤销兜底);
//   2) sliderPath: computeRawPath 恢复 'B<n>' 分支 (bsplineRawPath 上浮, degree 参数化),
//      resolveSliderCurveType 保持 B4 (编辑锚点不冲掉类型);
//   3) EditorCanvas: finishFreehandSlider 落 'B4' (单弧仍 'P'; 撤销 v377 bsplineToStableBezier 落盘),
//      手绘幽灵直接 'B4' 渲染 — 预览=落盘同形;
//   4) convert/bezierPath.sliderToBezierSegments 加 B<n> 分支 (Boehm 精确; 下游 split/merge/stream/sym 全通);
//      symSlider 拼接保持 'B4' (红锚点接缝 = B 样条分段);
//   5) UI: 右侧栏 B4 警告条 (data-b4-warning) + 一键全图转贝塞尔 (store.convertAllBSplineSliders),
//      作图菜单 compose-convert-b4, Inspector 下拉 B4 选项;
//   6) convert/convertB4.ts: countBSplineSliders / convertBSplineSlidersToBezier (bsplineToStableBezier 双候选, 取整)。
// 运行: node verifier/v387/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v387/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v387/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V387_TESTS_*)
fs.unlinkSync(out);

section('parser.ts: B4 读入保留 + 序列化原样 (v377 转换已撤销)');
{
  const src = read('src/osu/parser.ts');
  assert(!/bsplineToStableBezier/.test(src), 'parser 不再引用 bsplineToStableBezier (读入/落盘转换均撤销)');
  assert(/!s\.includes\(':'\)/.test(src), '段内类型字母 token 容错跳过');
  assert(/base\.curveType = curve\[0\];/.test(src), 'curveType = 首 token 原样');
}

section('sliderPath.ts: B4 一等类型');
{
  const src = read('src/osu/sliderPath.ts');
  assert(/export function parseBSplineType\(/.test(src) && /\/\^B\(\\d\+\)\$\//.test(src), 'parseBSplineType 导出');
  assert(/if \(bSplineDeg !== null\) return bsplineRawPath\(pts, bSplineDeg\);/.test(src), 'computeRawPath B<n> 分支');
  assert(/export function bsplineRawPath\(pts: Vec2\[\], degree = 4\)/.test(src), 'bsplineRawPath degree 参数化');
  assert(/if \(parseBSplineType\(current\) !== null\) return current;/.test(src), 'resolveSliderCurveType 保持 B4');
}

section('EditorCanvas.tsx: 手绘落盘 B4 + 幽灵直渲');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/const curveType = singleP \? 'P' : linePts \? 'L' : 'B4';/.test(src), "finishFreehandSlider 落盘 'B4' (单弧 => 'P'; v412: 共线无红锚点 => 'L')");
  assert(/curveType: bspline \? 'B4' : computed\.curveType/.test(src), "手绘幽灵按 'B4' 渲染 (预览=落盘)");
  assert(!/import \{ bsplineToStableBezier \}/.test(src), 'EditorCanvas 不再引入 bsplineToStableBezier');
}

section('convert: B4 下游工具链');
{
  const src = read('src/osu/convert/bezierPath.ts');
  assert(/bSplineToBezierSegments\(g, bSplineDeg\)/.test(src), 'sliderToBezierSegments B<n> Boehm 分支');
  const sym = read('src/osu/convert/symSlider.ts');
  assert(/parseBSplineType\(workType\) !== null \? workType : 'B'/.test(sym), 'symSlider 拼接保持 B4');
  const conv = read('src/osu/convert/convertB4.ts');
  assert(/export function countBSplineSliders\(/.test(conv) && /export function convertBSplineSlidersToBezier\(/.test(conv), 'convertB4 导出计数+转换');
  assert(/bsplineToStableBezier\(pts, deg\)/.test(conv) && /Math\.round\(p\.x\)/.test(conv), '转换走双候选 + 取整');
}

section('UI: 警告条 + 菜单 + Inspector');
{
  const app = read('src/App.tsx');
  assert(/data-b4-warning/.test(app) && /store\.convertAllBSplineSliders\(\)/.test(app) && /store\.b4SliderCount > 0/.test(app), '右侧栏 B4 警告条 + 按钮');
  const store = read('src/osu/store.ts');
  assert(/get b4SliderCount\(\)/.test(store) && /convertAllBSplineSliders\(\)/.test(store) && /pushUndo\(\)/.test(store), 'store: b4SliderCount + convertAllBSplineSliders (一次 undo)');
  const menu = read('electron/main.cjs');
  assert(/compose-convert-b4/.test(menu) && /menu\.convert_b4/.test(menu), '作图菜单 compose-convert-b4 + 三语标签');
  const bridge = read('src/osu/electronBridge.ts');
  assert(/'compose-convert-b4'/.test(bridge), 'electronBridge 命令类型');
  const emenu = read('src/osu/electronMenu.ts');
  assert(/case 'compose-convert-b4': store\.convertAllBSplineSliders\(\); return;/.test(emenu), 'electronMenu 分发');
  const insp = read('src/components/Inspector.tsx');
  assert(/bSplineOption/.test(insp) && /inspector\.curve_bspline/.test(insp), 'Inspector 下拉 B4 选项 + 内联提示');
}

section('i18n: zh-CN 文案');
{
  assert(/'app\.b4_warning'/.test(read('src/i18n/dicts/zh-CN/app.ts')), 'app.b4_warning');
  assert(/'app\.b4_convert_all'/.test(read('src/i18n/dicts/zh-CN/app.ts')), 'app.b4_convert_all');
  assert(/'convert\.b4_none'/.test(read('src/i18n/dicts/zh-CN/convert.ts')) && /'convert\.b4_converted'/.test(read('src/i18n/dicts/zh-CN/convert.ts')), 'convert.b4_*');
  assert(/'inspector\.curve_bspline'/.test(read('src/i18n/dicts/zh-CN/inspector.ts')), 'inspector.curve_bspline*');
}

if (failures) { console.error(`V387 FAILED: ${failures}`); process.exit(1); }
console.log('V387 ALL PASSED');

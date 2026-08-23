// 验证器 v84: 几何辅助点/线吸附 (参考 Mapping Tools SnappingTools) —
// 三点圆弧滑条圆心(点)/圆(红虚线)/直线滑条头尾延伸辅助线(红虚线), 三类参与吸附, 可开关面板
// 运行: cd app && node verifier/v84/check.mjs; node verifier/v84/cdp-v84.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v84/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v84/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('geometryHelpers.ts: 纯函数与 mapping_tools 语义');
{
  const src = readSrc('src/osu/geometryHelpers.ts');
  assert(/export function circumCircle/.test(src), '导出 circumCircle');
  assert(/export function sliderHelperCircle/.test(src), '导出 sliderHelperCircle');
  assert(/export function sliderHelperLines/.test(src), '导出 sliderHelperLines');
  assert(/export function clipLineToBox/.test(src), '导出 clipLineToBox');
  assert(/export function geoHelperSnap/.test(src), '导出 geoHelperSnap');
  assert(/GEO_CLIP_BOX\s*=\s*\{[^}]*-1000/.test(src) && /1512/.test(src) && /1384/.test(src),
    'GEO_CLIP_BOX = 游玩区外扩 1000px');
  assert(/curveType !== 'P'/.test(src) && /length !== 3/.test(src), '圆仅 P 型且恰 3 控制点');
  assert(/mk\(pts\[0\], pts\[pts\.length - 1\]\)/.test(src), 'L 型线 = 头→最后锚点');
  assert(/-\s*3/.test(src), '吸附点偏置 -3 (mapping_tools 点优先)');
}

section('store.ts: 三开关默认开 + 面板开关');
{
  const src = readSrc('src/osu/store.ts');
  assert(/geoCenter = true/.test(src) && /geoCircle = true/.test(src) && /geoLines = true/.test(src), '三开关默认 true');
  assert(/geoPanelOpen = false/.test(src), '面板默认关');
  assert(/setGeoFlag\(k: 'geoCenter' \| 'geoCircle' \| 'geoLines'/.test(src), 'setGeoFlag');
  assert(/setGeoPanelOpen/.test(src), 'setGeoPanelOpen');
}

section('EditorCanvas.tsx: 渲染 + 4 处吸附接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/sliderHelperLines\(o\)/.test(src), '渲染: 辅助线收集');
  assert(/clipLineToBox/.test(src), '渲染: 线裁剪到游玩区外扩框');
  assert(/arc\(circ\.cx, circ\.cy, circ\.r/.test(src), '渲染: 圆绘制');
  assert(/255,\s*60,\s*60/.test(src), '渲染: 红虚线颜色');
  assert(/setLineDash\(\[8,\s*6\]\)/.test(src), '渲染: 虚线样式');
  // v207: 放置 2 处收敛进 snapSliderCtrlPoint (内部 snapWithGeo(bm0, ...)) — 逻辑吸附点仍是 9 处
  // v210: 自定义对称轴端点拖拽 +1 (与自定义原点同级吸附)
  const n = (src.match(/snapWithGeo\(bm,/g) ?? []).length;
  const nShared = (src.match(/snapWithGeo\(bm0,/g) ?? []).length;
  const nCtrl = (src.match(/snapSliderCtrlPoint\(p\)/g) ?? []).length;
  assert(n === 7 && nShared === 1 && nCtrl >= 2, `吸附点走 snapWithGeo (v84/v91/v117 直接 6 处 + v210 对称轴端点 1 处 + v207 共享 1 处 × ${nCtrl} 个控制点落点, 实际 ${n}+${nShared}, 调用 ${nCtrl})`);
}

section('GeoSnapPanel.tsx + App.tsx: 面板与按钮');
{
  const panel = readSrc('src/components/GeoSnapPanel.tsx');
  assert(/testid="geo-snap"/.test(panel), '面板 testid (DraggableDialog => data-dialog)');
  assert(/data-geo-toggle=\{r\.key\}/.test(panel), '开关行 data-geo-toggle');
  const rows = (panel.match(/^  \{ key: 'geo(Center|Circle|Lines)'/gm) ?? []).length;
  assert(rows === 3, `面板 3 行配置 (实际 ${rows})`);
  const app = readSrc('src/App.tsx');
  assert(/data-geo-input="panel-toggle"/.test(app), '工具栏辅助按钮');
  assert(/store\.geoPanelOpen && <GeoSnapPanel/.test(app), '面板挂载');
}

if (failures) { console.error(`\nVERIFIER_V84_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V84_ALL_PASSED');

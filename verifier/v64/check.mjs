// 验证器 v64: 多边形生成 (lazer PolygonGenerationPopover) — 弹窗 + 实时预览 + Ctrl+Shift+D
// 运行: cd app && node verifier/v64/check.mjs; node verifier/v64/cdp-v64.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v64/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v64/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('convert/polygon.ts: lazer 公式移植');
{
  const src = readSrc('src/osu/convert/polygon.ts');
  assert(/chord \/ \(2 \* Math\.sin\(Math\.PI \/ p\.vertices\)\)/.test(src), '半径 R = 弦长/(2·sin(π/n))');
  assert(/\(i \+ 1\) \* \(\(2 \* Math\.PI\) \/ p\.vertices\)/.test(src), '角 θᵢ = 起始角 + (i+1)·2π/n');
  assert(/256 \+ radius \* Math\.cos/.test(src) && /192 \+ radius \* Math\.sin/.test(src), '圆心固定 (256,192)');
  assert(/100 \* sm \* lastSliderSv/.test(src), 'velocity = 100×SM×sv/beatLength (BASE_SCORING_DISTANCE×SliderMultiplier)');
  assert(/lastSliderSv/.test(src) && /end > time \+ 1e-6\) continue/.test(src), 'SV 取最近 endTime<=t 滑条 (lastWithSliderVelocity)');
  assert(/Math\.min\(10, Math\.max\(0\.01, sv\)\)/.test(src), 'SV clamp [0.01,10] (GetPrecisionAdjustedBeatLength)');
  assert(/x < 0 \|\| y < 0 \|\| x > 512 \|\| y > 384/.test(src), '出界检测 => outOfBounds (禁用创建)');
  assert(/snapBeatTime\(bm\.timingPoints, divisor, t \+ timeSpacing\)/.test(src), '每点时间再吸附 (SnapTime(t+timeSpacing))');
  assert(/vertices: \[3, 32\]/.test(src) && /repeats: \[1, 10\]/.test(src) && /distanceSnap: \[0\.1, 6\]/.test(src), 'lazer 参数范围 3-32/1-10/0.1-6');
}

section('PolygonDialog.tsx: 参数窗口 + 实时预览 + 一次 undo');
{
  const src = readSrc('src/components/convert/PolygonDialog.tsx');
  assert(/testid="vertices"/.test(src) && /testid="repeats"/.test(src) && /testid="offsetAngle"/.test(src) && /testid="distanceSnap"/.test(src), '四个参数输入');
  assert(/data-conv="newCombo"/.test(src), 'newCombo 勾选 (首件, 默认跟随选区)');
  assert(/setConversionPreview\(result\.objects\.length \? \{ hideIds: \[\], objects: result\.objects \}/.test(src), '实时预览 (纯新增, hideIds 空)');
  assert(/saveParams\('polygon', params\); store\.applyConversion\(\[\], result\.objects\)/.test(src), '应用 = 参数记忆 + applyConversion (一次 undo)');
  assert(/disabled=\{!result\.objects\.length\}/.test(src), '出界/空结果禁用创建');
}

section('接线: store/App/Inspector');
{
  const store = readSrc('src/osu/store.ts');
  assert(/'polygon'( \| 'duplicate')?( \| 'symSlider')? \| null = null/.test(store), 'conversionDialog 含 polygon (v236: 兼容新增 symSlider 可选项)');
  const app = readSrc('src/App.tsx');
  assert(/\{store\.conversionDialog === 'polygon' && <PolygonDialog \/>\}/.test(app), 'App 挂载 PolygonDialog');
  assert(/e\.shiftKey && e\.key\.toLowerCase\(\) === 'd'/.test(app) && /openConversion\('polygon'\)/.test(app), 'Ctrl+Shift+D 快捷键 (lazer 同款)');
  const insp = readSrc('src/components/Inspector.tsx');
  assert((insp.match(/data-conv-open="polygon"/g) || []).length === 2, 'Inspector 两分支均有 多边形生成 按钮');
}

if (failures) { console.error(`\nVERIFIER_V64_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V64_ALL_PASSED');

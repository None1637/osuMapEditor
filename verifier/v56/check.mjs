// 验证器 v56: 位置网格吸附 (lazer 正方形/三角形/圆形 + 间距/旋转 + 开关)
// 运行: cd app && node verifier/v56/check.mjs; node verifier/v56/cdp-v56.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v56/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v56/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('gridSnap.ts: lazer 三类网格');
{
  const src = readSrc('src/osu/gridSnap.ts');
  assert(/GRID_ORIGIN: Pt = \{ x: 256, y: 192 \}/.test(src), '原点游玩区中心');
  assert(/GRID_SPACING_MIN = 4/.test(src) && /GRID_SPACING_MAX = 256/.test(src), '间距 4..256');
  assert(/export function snapSquare/.test(src) && /export function snapTriangle/.test(src) && /export function snapCircle/.test(src), '三类吸附函数');
  assert(/export function snapToGrid/.test(src) && /Math\.min\(PW, r\.x\)/.test(src), '结果钳制游玩区');
  assert(/Math\.round\(len \/ spacing\) \* spacing/.test(src), '圆形半径取整 (lazer)');
}

section('store.ts: 网格状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/gridSnap = false/.test(src), '开关默认关 (lazer TernaryState.False)');
  assert(/gridType: 'square' \| 'triangle' \| 'circle' \| 'none' = 'square'/.test(src), '类型默认正方形 (v119: +none 无网格)');
  assert(/gridSpacing: number \| null = null/.test(src) && /gridRotation = 0/.test(src), '间距跟随 GridSize + 旋转 0');
}

section('EditorCanvas.tsx: 渲染 + 放置/拖拽接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.gridSpacing \?\? bm\.editor\.gridSize/.test(src), '间距 = gridSpacing ?? 谱面 GridSize');
  assert(/squareNormals\(store\.gridRotation\)/.test(src) && /triangleGrid\(gs, store\.gridRotation\)/.test(src), '正方形/三角形线族渲染');
  assert(/g\.arc\(O\.x, O\.y, Math\.max\(1\.5 \/ scale, i \* gs\)/.test(src), '圆形同心圆渲染 (lazer 中心最小直径)');
  assert(/k === 0 \? 0\.2 : 0\.1/.test(src) && /i === 0 \? 0\.8 : 0\.2/.test(src), '过原点首线/首圆更亮 (lazer alpha)');
  const iNear = src.indexOf('if (near) return gridSnapAt(bm, near);');
  assert(iNear > 0, 'snapPlacement: 物件吸附后也过网格 (lazer 位置网格最后覆盖)');
  assert(/snapToGrid\(\{ x: orig\.x \+ dx, y: orig\.y \+ dy \}, store\.gridType/.test(src), '拖拽: 锚头网格修正');
  assert(/store\.pendingSlider\.push\(\{ x: Math\.round\(sp\.x\)/.test(src), '滑条控制点吃网格吸附');
}

section('App.tsx: 工具栏控件');
{
  const src = readSrc('src/App.tsx');
  assert(/store\.gridSnap = !store\.gridSnap/.test(src), '网格开关按钮');
  assert(/data-grid-input="type"/.test(src) && /data-grid-input="spacing"/.test(src) && /data-grid-input="rotation"/.test(src), '类型/间距/旋转输入');
  assert(/store\.beatmap\.editor\.gridSize = v/.test(src), '间距写回 [Editor] GridSize (lazer)');
  assert(/rotationPeriod\(store\.gridType\)/.test(src) && /normalizeRotation\(store\.gridRotation, period\)/.test(src), '切类型归一旋转');
  assert(/store\.gridType === 'circle'\}/.test(src) || /store\.gridType === 'circle'\}/.test(src) || /gridType === 'circle'/.test(src), '圆形禁用旋转');
}

if (failures) { console.error(`\nVERIFIER_V56_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V56_ALL_TESTS_PASSED');

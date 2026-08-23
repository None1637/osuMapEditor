// 验证器 v91: 拖物件吸附辅助线/点 + 自定义锚点 (变换原点/网格中心/批量复制向量头) 拖拽吸附辅助线/点
// 运行: cd app && node verifier/v91/check.mjs; node verifier/v91/cdp-v91.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v91/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v91/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('geometryHelpers.ts: geoDragCorrection');
{
  const src = readSrc('src/osu/geometryHelpers.ts');
  assert(/export function geoDragCorrection/.test(src), '导出 geoDragCorrection');
  assert(/if \(objCorrDist !== null && best\.dist >= objCorrDist\) return null/.test(src), '与物件修正取更近者');
}

section('EditorCanvas.tsx: 移动拖拽吸附辅助 (排除自身)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/geoDragCorrection\(dragPts, dx, dy, p => geoSnap\(bm, p, store\.selected\), corrDist\)/.test(src), '移动拖拽接 geoDragCorrection, 排除被拖物件');
  assert(/corrDist = Math\.hypot\(corr\.dx - dx, corr\.dy - dy\)/.test(src), '物件修正距离供比较');
  assert(/exclude\?\.has\(o\.id\)/.test(src), 'geoSnap 支持 exclude');
}

section('EditorCanvas.tsx: 三个自定义锚点拖拽接吸附');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.setGridOrigin\(snapWithGeo\(bm, cp, snapToNearby\(cp, targets\)\) \?\? cp\)/.test(src), '网格中心拖拽: 物件+辅助取更近');
  // v166 适配: 拖拽经 setO 路由 (批量复制窗口打开时写 dupCustomOrigin, 否则 setCustomOrigin), 吸附链不变
  assert(/setO\(gridSnapAt\(bm, snapWithGeo\(bm, cp, snapToNearby\(cp, targets\)\) \?\? cp\)\)/.test(src), '变换原点拖拽: 物件+辅助取更近再网格 (v166: setO 路由)');
  assert(/dupVectorDragHandler\(sp\.x - dv\.anchor\.x, sp\.y - dv\.anchor\.y\)/.test(src), '批量复制向量头拖拽接吸附');
  assert(/const sp = bm \? snapWithGeo\(bm, cp, snapToNearby\(cp, objectSnapPoints/.test(src), '向量头吸附点计算');
}

if (failures) { console.error(`\nVERIFIER_V91_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V91_ALL_PASSED');

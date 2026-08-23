// 验证器 v95: 新建滑条尾端吸附节拍 — placementLength 非锁定分支接 snapSliderLength (lazer FindSnappedDistance)
// 运行: cd app && node verifier/v95/check.mjs; node verifier/v95/cdp-v95.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v95/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v95/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: placementLength 加 beatSnap, 非锁走 snapSliderLength');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/geometryLength: number, distanceLock: boolean, distanceSpacing: number, beatSnap: number,/.test(src), 'placementLength 第 7 参 beatSnap');
  assert(/return Math\.min\(Math\.max\(20, snapSliderLength\(points, currentTime, sliderMultiplier, geometryLength, beatSnap\)\), geoCap\)/.test(src), '非锁定分支 = snapSliderLength 节拍吸附 (v160: 再钳到几何全长 geoCap)');
  assert(/computePendingPath\(pend, cursor\)\.length, distanceLock, distanceSpacing, beatSnap\)/.test(src), 'pendingSliderTimeline 透传 beatSnap (预览=落盘)');
}

section('EditorCanvas.tsx: 两个落盘点都传 store.beatSnap');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const n = (src.match(/placementLength\(bm\.timingPoints/g) ?? []).length;
  assert(n === 2, `finishSlider + finishFreehandSlider 两处 (实际 ${n})`);
  const m = (src.match(/bm\.editor\.distanceSpacing, store\.beatSnap\)/g) ?? []).length;
  assert(m === 2, `两处都传 store.beatSnap (实际 ${m})`);
}

if (failures) { console.error(`\nVERIFIER_V95_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V95_ALL_PASSED');

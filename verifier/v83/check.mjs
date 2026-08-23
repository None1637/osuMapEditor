// 验证器 v83: 预览代码复用收敛 — 落盘规则 (snapPlacementTime/placementLength) + 时间轴绘制 (drawTimelineObject) 共用
// 运行: cd app && node verifier/v83/check.mjs; node verifier/v83/cdp-v83.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v83/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v83/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: 共享纯函数');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/export function snapPlacementTime/.test(src), '导出 snapPlacementTime');
  assert(/export function placementLength/.test(src), '导出 placementLength');
  const pv = src.match(/export function pendingSliderTimeline[\s\S]*?\n\}/);
  assert(!!pv && /snapPlacementTime\(points, currentTime, beatSnap\)/.test(pv[0]) && /placementLength\(points, currentTime, sliderMultiplier/.test(pv[0]),
    'pendingSliderTimeline 委托两个共享纯函数 (预览=落盘同源)');
}

section('EditorCanvas.tsx: 两个 finish 函数收敛 (规则不再各抄一份)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const n = (src.match(/const len = placementLength\(bm\.timingPoints/g) ?? []).length;
  assert(n === 2, `finishSlider + finishFreehandSlider 都走 placementLength (实际 ${n} 处)`);
  const t = (src.match(/snapPlacementTime\(bm\.timingPoints, store\.currentTime, store\.beatSnap\)/g) ?? []).length;
  assert(t === 2, `两处落盘时间都走 snapPlacementTime (实际 ${t} 处)`);
  assert(!/beatPx = vel \* red\.beatLength/.test(src), 'EditorCanvas 内不再有第三份长度规则拷贝');
}

section('Timelines.tsx: drawTimelineObject 共用');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/function drawTimelineObject\(/.test(src), 'drawTimelineObject 提取');
  assert(/drawTimelineObject\(g, sx, ex, lay\.yOf\(si\.level\), lay\.rad, \{/.test(src), '真实物件走共用绘制 (v162: 堆叠位置/半径)');
  assert(/drawTimelineObject\(g, psx, pex, cy, RAD, \{/.test(src), '放置预览幻影走共用绘制');
}

if (failures) { console.error(`\nVERIFIER_V83_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V83_ALL_PASSED');

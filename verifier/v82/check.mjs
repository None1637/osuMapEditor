// 验证器 v82: 上方时间轴显示放置中滑条预览 (幻影虚线条)
// 运行: cd app && node verifier/v82/check.mjs; node verifier/v82/cdp-v82.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v82/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v82/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: pendingSliderTimeline 纯函数');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/export function pendingSliderTimeline/.test(src), '导出 pendingSliderTimeline');
  assert(/computePendingPath\(pend, cursor\)\.length/.test(src), '长度 = 预览路径几何全长 (含幻影光标点)');
  assert(/distanceLock && distanceSpacing > 0 && beatPx > 0/.test(src), '锁定间距吸整拍 (与 finishSlider 同规则)');
  assert(/Math\.min\(Math\.max\(20, Math\.round\(beats \* beatPx\)\), geoCap\)/.test(src), '下限 20px (v160: 再钳到几何全长 geoCap)');
}

section('store.ts / EditorCanvas.tsx: 放置中光标维护');
{
  const store = readSrc('src/osu/store.ts');
  assert(/pendingCursor: \{ x: number; y: number \} \| null = null/.test(store), 'store.pendingCursor 字段');
  const ec = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.pendingCursor = store\.tool === 'slider' && store\.pendingSlider\.length > 0/.test(ec), 'mousemove 维护 pendingCursor (仅滑条放置中)');
  assert(/store\.pendingSlider = \[\]; store\.pendingCursor = null; store\.emit\(\); return; \}/.test(ec), 'finishSlider 退化路径清光标');
  assert(/store\.pendingSlider = \[\];\s*store\.pendingCursor = null;/.test(ec), 'finishSlider/finishFreehand 落盘后清光标');
}

section('Timelines.tsx: 幻影预览渲染');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/store\.tool === 'slider' && store\.pendingSlider\.length > 0/.test(src), '仅滑条放置中显示');
  assert(/pendingSliderTimeline\(bm\.timingPoints, bm\.difficulty\.sliderMultiplier/.test(src), '走纯函数 (与落盘同规则)');
  assert(/setLineDash\(\[6, 4\]\)/.test(src), '虚线幻影样式');
}

if (failures) { console.error(`\nVERIFIER_V82_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V82_ALL_PASSED');

// 验证器 v27: 三个修复 — ① 可见物件即可选中 (hitTest 窗口=渲染窗口) ② 选中滑条外形描边 ③ 折返箭头按 span 渐显
// 运行: cd app && node verifier/v27/check.mjs; node verifier/v27/cdp-v27.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v27/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v27/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (折返箭头时机 / isVisibleAt 窗口)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('lifecycle.ts: sliderRepeatAlpha');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(src.includes('export function sliderRepeatAlpha'), '导出 sliderRepeatAlpha');
  assert(/time >= sliderStart \+ s \* span\) return 0/.test(src), '球到达端点立即隐藏');
  assert(/s === 1 \? sliderStart - preempt : sliderStart \+ \(s - 2\) \* span/.test(src), 's=1 随滑条淡入 / s>=2 过前一同侧端点时出现');
}

section('renderer.ts: 折返箭头 + 选中描边');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/sliderRepeatAlpha\(time, o\.time, span, preempt, s\)/.test(src), '箭头循环走 sliderRepeatAlpha');
  assert(/if \(a <= 0\) continue/.test(src), '不可见箭头跳过');
  assert(src.includes('function drawSliderBodyOutline'), 'drawSliderBodyOutline 已定义');
  assert(/drawSliderBodyOutline\(g, p\.points, radius\)/.test(src), '选中滑条走外形描边');
  assert(/destination-out[\s\S]*?r \* 2 - 1\.5/.test(src), '离屏镂空出环');
}

section('EditorCanvas.tsx: hitTest 可见窗口');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/isVisibleAt\(bm, o, store\.currentTime\)/.test(src), 'hitTest 用 isVisibleAt (与渲染同窗口)');
  assert(!src.includes('const preempt = 1200'), '不再硬编码 preempt=1200');
  assert(src.includes(`from '@/osu/lifecycle'`), '导入 lifecycle');
}

if (failures) { console.error(`\nVERIFIER_V27_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V27_ALL_TESTS_PASSED');

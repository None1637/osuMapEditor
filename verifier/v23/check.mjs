// 验证器 v23: 物件堆叠 (stacking) 渲染 — lazer OsuBeatmapProcessor.applyStacking 移植
// 运行: cd app && node verifier/v23/check.mjs; node verifier/v23/cdp-stack.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v23/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v23/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (堆叠算法: 方向/阈值/负堆叠特例/spinner 跳过)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('stacking.ts: lazer applyStacking 移植');
{
  const src = readSrc('src/osu/stacking.ts');
  assert(src.includes('export function computeStackHeights'), '导出 computeStackHeights');
  assert(src.includes('export function computeStackOffsets'), '导出 computeStackOffsets');
  assert(src.includes('STACK_DISTANCE = 3'), 'STACK_DISTANCE = 3');
  assert(/Math\.floor\(arToPreempt/.test(src) && src.includes('stackLeniency'), 'threshold = floor(preempt) * stackLeniency');
  assert(src.includes('Math.trunc(objs[objectI].time) - Math.trunc(endTimes[n])'), 'HitCircle 分支 (int) 截断对齐 stable');
  assert(src.includes('heights[j] -= offset'), '滑条末端负堆叠特例 (StackHeight -= offset)');
  assert(src.includes("from './sliderPath'") && !src.includes("from './renderer'"), '滑条路径依赖 sliderPath.ts (不 import renderer, 无循环)');
  assert(src.includes('* -0.1') || src.includes('-6.4'), '偏移公式 StackHeight * r * -0.1 (= scale*-6.4)');
}

section('sliderPath.ts: getSliderPath 迁移');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('export function getSliderPath'), '导出 getSliderPath');
  assert(src.includes('export function invalidateSliderPath'), '导出 invalidateSliderPath');
}

section('renderer.ts: 渲染偏移接线');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(src.includes('stackOffsets: Map<number, { dx: number; dy: number }>'), 'RenderCtx.stackOffsets');
  assert(src.includes("export { getSliderPath } from './sliderPath'"), 'getSliderPath re-export 兼容旧调用');
  assert(src.includes('export function invalidatePath'), 'invalidatePath 保留 (清 bodyCache)');
  assert(/function drawSlider[\s\S]*?g\.translate\(so\.dx, so\.dy\)/.test(src), 'drawSlider 整体 g.translate 堆叠偏移');
  assert(/function drawCircle[\s\S]*?o\.x \+ so\.dx/.test(src), 'drawCircle 位置加偏移');
  assert(/rc\.selected\.has[\s\S]*?g\.translate\(so\.dx, so\.dy\)/.test(src), '选中高亮/控制点手柄随偏移');
}

section('EditorCanvas.tsx: 偏移缓存与交互命中');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('computeStackOffsets'), '引入 computeStackOffsets');
  assert(src.includes('getDataVersion()') || src.includes('getDataVersion'), '按 dataVersion 缓存重算');
  assert(src.includes('stackOffsets: getStackOffsets(bm)'), 'renderPlayfield 传入 stackOffsets');
  assert(/const hitTest[\s\S]*?getStackOffsets/.test(src), '点击命中用堆叠后位置');
  // v45: 框选增加可见物件过滤, 调用变为多行; 断言放宽为 objectsInRect + getStackOffsets 同现
  assert(/objectsInRect\([\s\S]{0,250}getStackOffsets\(bm\)\)/.test(src), '框选命中用堆叠后位置');
}

section('transform.ts / store.ts: 框选偏移参数 + 数据版本访问');
{
  const t = readSrc('src/osu/transform.ts');
  assert(/objectsInRect\(objs: HitObject\[\], r: Rect, offsets\?/.test(t), 'objectsInRect 可选 offsets 参数');
  const s = readSrc('src/osu/store.ts');
  assert(s.includes('getDataVersion'), 'store.getDataVersion 只读访问');
}

if (failures) { console.error(`\nVERIFIER_V23_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V23_ALL_TESTS_PASSED');

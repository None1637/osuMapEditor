// 验证器 v17: hitsound 排程延迟修复 + P0-1 框选/多选变换
// 运行: cd app && node verifier/v17/check.mjs; node verifier/v17/cdp-latency.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v17/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v17/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (AudioClock 非零原点回归 + 变换数学)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('AudioClock.ts: 排程延迟修复');
{
  const src = readSrc('src/osu/clock/AudioClock.ts');
  const fn = src.match(/ctxTimeForMapTime\(mapMs: number\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(fn.includes('atCtx = this.phaseStartSec +'), '排程时刻直接取自 ctx 时钟线锚点');
  assert(!fn.includes('phaseSec'), 'ctxTimeForMapTime 不再依赖 phaseSec (旧 bug: 统一晚 |phaseSec|)');
}

section('store.ts: 选区变换 + 选择集刷新不触发事件表重建');
{
  const src = readSrc('src/osu/store.ts');
  assert(/rotateSelected\(deg: number/.test(src) && src.includes('flipSelected(axis') && /scaleSelected\(sx: number/.test(src), 'rotate/flip/scale 选区变换方法 (v33 起带 origin 参数; v282 起 scale 双轴)');
  assert(/applyTransform[\s\S]*?pushUndo\(\)/.test(src), '变换一次操作一次 undo');
  assert(/applyTransform[\s\S]*?invalidatePath\(s\.id\)/.test(src), '变换后滑条路径缓存失效');
  assert(src.includes('emitSelection()'), '选择集专用刷新 (不 bump dataVersion)');
  assert(/select\(ids[\s\S]*?emitSelection\(\)/.test(src), 'select 走 emitSelection (框选期间不重建 hitsound 事件表)');
}

section('transform.ts: 纯函数模块');
{
  const src = readSrc('src/osu/transform.ts');
  for (const f of ['selectionCenter', 'rotateObjects', 'flipObjects', 'scaleObjects', 'objectsInRect'])
    assert(src.includes(`export function ${f}`), `导出 ${f}`);
  assert(/scaleObjects[\s\S]*?o\.length = /.test(src), '缩放同步滑条 pixelLength');
}

section('EditorCanvas.tsx: 框选 + 滑条整体拖拽');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('marqueeRef') && src.includes('objectsInRect'), '框选状态与命中测试接入');
  assert(/marqueeRef\.current = \{ x0/.test(src), '空白处按下开始框选');
  assert(src.includes('base: e.shiftKey'), 'Shift 框选追加');
  assert(src.includes('orig.curve'), '拖拽快照含滑条控制点 (整体平移防变形)');
}

section('App.tsx / Inspector.tsx: 快捷键与变换按钮');
{
  const app = readSrc('src/App.tsx');
  assert(app.includes("store.rotateSelected(-90, 'playfield')") && app.includes("store.rotateSelected(90, 'playfield')"), 'Ctrl+,/. 旋转 90° (v75 起 lazer 键位; v192 起游玩区中心)');
  assert(app.includes("store.flipSelected('h', 'playfield')") && app.includes("store.flipSelected('v', 'playfield')"), 'Ctrl+H/J 镜像 (v192 起游玩区中心)');
  const insp = readSrc('src/components/Inspector.tsx');
  assert(insp.includes('TransformPanel') && insp.includes('scaleSelected(factor, factorY, origin)'), 'Inspector 变换面板 (v33 起任意倍率输入 + 原点)');
}

if (failures) { console.error(`\nVERIFIER_V17_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V17_ALL_TESTS_PASSED');

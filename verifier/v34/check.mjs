// 验证器 v34: 自定义变换原点 — 画布标记渲染 + 可拖拽
// 需求: 勾选"自定义"原点时, 原点需在游玩区渲染为标记并支持拖动 (Inspector 输入与拖拽双向同步)
// 运行: cd app && node verifier/v34/check.mjs; node verifier/v34/cdp-origin-marker.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 原点 UI 状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/originMode: 'selection' \| 'playfield' \| 'custom' = 'selection'/.test(src), 'originMode 字段 (默认 selection)');
  assert(/customOrigin: Pt = \{ x: 256, y: 192 \}/.test(src), 'customOrigin 字段 (默认游玩区中心)');
  assert(/setOriginMode\(m: 'selection' \| 'playfield' \| 'custom'\)/.test(src), 'setOriginMode');
  assert(/setCustomOrigin\(p: Pt\)/.test(src), 'setCustomOrigin');
  assert(/currentOrigin\(\): TransformOrigin/.test(src), 'currentOrigin (custom 时取 customOrigin)');
  // UI 状态不进 undo / 不 bump dataVersion: 两个 setter 都用 emitSelection
  assert(/setOriginMode[\s\S]{0,140}emitSelection\(\)/.test(src), 'setOriginMode 用 emitSelection (不触发事件表重建)');
  assert(/setCustomOrigin[\s\S]{0,160}emitSelection\(\)/.test(src), 'setCustomOrigin 用 emitSelection');
}

section('Inspector.tsx: 面板状态来自 store (拖拽/输入双向同步)');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(src.includes('store.originMode'), 'originMode 读 store');
  assert(src.includes('store.customOrigin'), 'customOrigin 读 store');
  assert(/store\.setOriginMode\(m\)/.test(src), 'radio -> store.setOriginMode');
  assert(/store\.setCustomOrigin\(/.test(src), 'x/y 输入 -> store.setCustomOrigin');
  assert(/store\.currentOrigin\(\)/.test(src), '变换按钮用 store.currentOrigin()');
  assert(!/useState<'selection' \| 'playfield' \| 'custom'>/.test(src), '本地 originMode useState 已移除');
}

section('EditorCanvas.tsx: 标记渲染 + 拖拽');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('originDragRef'), 'originDragRef');
  assert(/originMarkerVisible[\s\S]{0,120}originMode === 'custom'/.test(src), '可见条件: 自定义模式');
  assert(src.includes("'#ffaa00'"), '标记颜色 #ffaa00');
  // mousedown: 标记命中优先于物件/控制点, 且不进 undo (无 beginDrag/pushUndo)
  // v166 适配: 命中改走 activeCustomOrigin() (批量复制窗口打开时 = 弹窗独立原点)
  assert(/originMarkerVisible\(\) && Math\.hypot\(activeCustomOrigin\(\)\.x/.test(src), 'mousedown 标记命中检测 (v166: activeCustomOrigin)');
  assert(/originDragRef\.current = true;\s*store\.canvasDragging = true;/.test(src), '标记拖拽置 canvasDragging (时间轴守卫)');
  // mousemove: 拖拽更新原点
  assert(/if \(originDragRef\.current\) \{[\s\S]{0,420}store\.setCustomOrigin\(/.test(src), 'mousemove 拖拽更新 customOrigin (v68 起带物件+网格吸附)');
  // window mouseup 兜底清除 (拖出画布经过时间轴时不能中途丢标志)
  assert(/store\.canvasDragging = false; originDragRef\.current = false;/.test(src), 'window mouseup 统一清除');
}

if (failures) { console.error(`\nVERIFIER_V34_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V34_ALL_TESTS_PASSED');

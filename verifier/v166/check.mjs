// 验证器 v166: 批量复制弹窗与左侧栏变换(选区)各自独立原点数据
// 弹窗勾选自定义锚点不再影响左侧栏 originMode; 画布标记/拖拽在弹窗打开时绑定 dupCustomOrigin
// 运行: node verifier/v166/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 独立 dup 原点状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/dupOriginMode: 'selection' \| 'playfield' \| 'custom' = 'selection';/.test(src), 'dupOriginMode 字段 (默认 selection)');
  assert(/dupCustomOrigin: Pt = \{ x: 256, y: 192 \}/.test(src), 'dupCustomOrigin 字段 (默认游玩区中心)');
  assert(/setDupOriginMode\(m: 'selection' \| 'playfield' \| 'custom'\) \{ this\.dupOriginMode = m; this\.emitSelection\(\); \}/.test(src), 'setDupOriginMode');
  assert(/setDupCustomOrigin\(p: Pt\) \{ this\.dupCustomOrigin = \{ x: Math\.round\(p\.x\), y: Math\.round\(p\.y\) \}; this\.emitSelection\(\); \}/.test(src), 'setDupCustomOrigin (取整, 对齐 customOrigin 惯例)');
  assert(/currentDupOrigin\(\): TransformOrigin/.test(src), 'currentDupOrigin()');
}

section('DuplicateDialog.tsx: 改用独立原点');
{
  const src = readSrc('src/components/convert/DuplicateDialog.tsx');
  assert(/const originMode = store\.dupOriginMode;/.test(src), '读 dupOriginMode');
  assert(/originMode === 'custom' \? store\.dupCustomOrigin : originMode/.test(src), 'computeDuplicate 用 dupCustomOrigin');
  assert(/store\.setDupOriginMode\(m\)/.test(src), 'radio 写 setDupOriginMode');
  assert(/store\.setDupCustomOrigin\(\{ x: v, y: store\.dupCustomOrigin\.y \}\)/.test(src), '锚点坐标 x 输入');
  assert(/store\.setDupCustomOrigin\(\{ x: store\.dupCustomOrigin\.x, y: v \}\)/.test(src), '锚点坐标 y 输入');
  assert(!/store\.setOriginMode|store\.setCustomOrigin|store\.customOrigin\b/.test(src.replace(/dupCustomOrigin/g, '')),
    '弹窗不再触碰左侧栏 originMode/customOrigin');
}

section('EditorCanvas.tsx: 标记按窗口绑定对应原点');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.conversionDialog === 'duplicate'\s*\? store\.dupOriginMode === 'custom'/.test(src), '可见条件: 弹窗打开看 dupOriginMode');
  assert(/const activeCustomOrigin = \(\) => \(store\.conversionDialog === 'duplicate' \? store\.dupCustomOrigin : store\.customOrigin\);/.test(src), 'activeCustomOrigin 路由');
  assert(/const m = activeCustomOrigin\(\);/.test(src), '绘制用 activeCustomOrigin');
  assert(/Math\.hypot\(activeCustomOrigin\(\)\.x - p\.x/.test(src), '命中用 activeCustomOrigin');
  assert(/if \(store\.conversionDialog === 'duplicate'\) store\.setDupCustomOrigin\(p\); else store\.setCustomOrigin\(p\);/.test(src),
    '拖拽按窗口路由写入 dup/普通原点');
}

section('隔离: 左侧栏变换仍用自己的 originMode/customOrigin');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/store\.setOriginMode\(m\)/.test(src), 'Inspector radio 仍写 originMode');
  assert(/store\.setCustomOrigin\(\{ x: v, y: store\.customOrigin\.y \}\)/.test(src), 'Inspector 自定义坐标仍写 customOrigin');
}

console.log(failures ? `\nV166 FAILED: ${failures}` : '\nV166 ALL PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v168: 显示设置新增「背景图亮度」数值项 (0-100%, 默认 35 = 旧固定 alpha 0.35, 默认表现不变)
// 运行: node verifier/v168/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v168/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v168/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V168_TESTS_*)
fs.unlinkSync(out);

section('displaySettings.ts: bgBrightness 数值项');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/bgBrightness: number;/.test(src), 'interface 含 bgBrightness: number');
  assert(/bgBrightness: 35/.test(src), '默认 35 (= 旧固定 alpha 0.35)');
  assert(/Math\.max\(0, Math\.min\(100, Math\.round\(p\.bgBrightness\)\)\)/.test(src), '读取时钳制 0-100');
  assert(/export type BoolDisplayKey/.test(src), 'BoolDisplayKey 布尔键类型 (数值项不混进开关行)');
  assert(/export function setDisplayNumber\(k: 'bgBrightness', v: number\)/.test(src), 'setDisplayNumber 导出');
  assert(/displaySettings\[k\] = Math\.max\(0, Math\.min\(100, Math\.round\(v\)\)\);/.test(src), '写入时钳制 0-100');
}

section('store.ts: setDisplayNumber 转发');
{
  const src = readSrc('src/osu/store.ts');
  assert(/setDisplayNumber\(k: 'bgBrightness', v: number\) \{ applyDisplayNumber\(k, v\); this\.emitSelection\(\); \}/.test(src), 'setDisplayNumber 转发 + emitSelection');
  assert(/setDisplayFlag\(k: BoolDisplayKey, v: boolean\)/.test(src), 'setDisplayFlag 改 BoolDisplayKey');
}

section('DisplayPanel.tsx: 亮度滑条行');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  assert(/data-display-slider="bgBrightness"/.test(src), '滑条行存在');
  assert(/store\.setDisplayNumber\('bgBrightness', parseInt\(e\.target\.value\)\)/.test(src), '滑条 onChange 接线');
  assert(/data-display-value="bgBrightness"/.test(src) && /\{displaySettings\.bgBrightness\}%/.test(src), '百分比文本');
  assert(/const ROWS: \{ key: BoolDisplayKey;/.test(src), '开关行用 BoolDisplayKey (数值项独立成行)');
}

section('EditorCanvas.tsx: 背景渲染用 bgBrightness');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/g\.globalAlpha = displaySettings\.bgBrightness \/ 100;/.test(src), '背景 alpha = bgBrightness/100');
  assert(!/g\.globalAlpha = 0\.35;/.test(src), '旧固定 0.35 已移除');
}

console.log(failures ? `\nV168 FAILED: ${failures}` : '\nV168 ALL PASSED');
process.exit(failures ? 1 : 0);

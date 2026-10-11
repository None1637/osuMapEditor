// 验证器 v224: 游玩区平移控件布局调整 —
//   开关按钮半宽 (flex-1) 与「缩放」输入框同一行 (缩放放按钮后); x/y 两个输入框平分下一行 (PanNumInput grow)。
// 运行: node verifier/v224/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('App.tsx: PanNumInput grow 属性');
{
  const src = readSrc('src/App.tsx');
  assert(/grow\?: boolean;/.test(src), 'PanNumInput 增 grow 属性');
  assert(/\$\{grow \? 'flex-1 min-w-0' : 'shrink-0'\}/.test(src), 'grow 时外层平分行宽');
  assert(/\$\{grow \? 'flex-1' : 'w-12'\}/.test(src), 'grow 时输入框弹性占满');
}

section('App.tsx: 开关半宽 + 缩放同行 (v391 修订: 开关独占一行, 缩放/旋转下一行)');
{
  const src = readSrc('src/App.tsx');
  // v391 适配: 加旋转输入后开关恢复整行宽 (撤销 v224 的 flex-1 半宽同行), 缩放/旋转平分下一行
  assert(/data-pan-input="toggle"\s*\n?\s*className=\{`w-full/.test(src), '开关按钮整行宽 (v391: 独占一行)');
  assert(/<PanNumInput label="Rot" labelKey="app\.playfield_rot" grow/.test(src), '旋转输入框 (v391 新增, 与缩放平分一行)');
  // v346 i18n: 缩放输入框 label 改英文原文 'Zoom' + labelKey 'app.playfield_zoom'
  // v367 修订: 缩放精细度 ×10 — 步进 0.1→0.01, 显示 2 位→3 位小数 (注明有意变更)
  // v391 修订: 缩放带 grow 移到旋转同行 (不再跟开关同行)
  assert(/label="Zoom" labelKey="app\.playfield_zoom" grow value=\{Math\.round\(store\.playfieldScale \* 1000\) \/ 1000\} step=\{0\.01\} min=\{0\.1\} max=\{10\} digits=\{3\}/.test(src), '缩放 = 原 scale 输入 (倍率, 钳 0.1..10; v367: 步进 0.01 + 3 位小数; v391: grow 与旋转同行)');
}

section('App.tsx: x/y 平分一行');
{
  const src = readSrc('src/App.tsx');
  assert(/<PanNumInput label="x" grow /.test(src) && /<PanNumInput label="y" grow /.test(src), 'x/y 均带 grow (平分行宽)');
  assert(/<PanNumInput label="Zoom" labelKey="app\.playfield_zoom" grow/.test(src), 'v391: 缩放带 grow 与旋转平分一行 (原「不 grow」断言撤销)');
}

if (failures) { console.error(`V224 FAILED: ${failures}`); process.exit(1); }
console.log('V224 ALL PASSED');

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

section('App.tsx: 开关半宽 + 缩放同行');
{
  const src = readSrc('src/App.tsx');
  assert(/data-pan-input="toggle"\s*\n?\s*className=\{`flex-1 min-w-0 text-left/.test(src), '开关按钮 flex-1 (约半宽, 不再 w-full)');
  assert(!/data-pan-input="toggle"\s*\n?\s*className=\{`w-full/.test(src), '开关不再整行宽');
  assert(/<\/button>\s*\n\s*<PanNumInput label="缩放"/.test(src), '缩放输入框紧跟开关按钮 (同一 flex 行)');
  assert(/label="缩放" value=\{Math\.round\(store\.playfieldScale \* 100\) \/ 100\} step=\{0\.1\} min=\{0\.1\} max=\{10\}/.test(src), '缩放 = 原 scale 输入 (倍率, 钳 0.1..10)');
}

section('App.tsx: x/y 平分一行');
{
  const src = readSrc('src/App.tsx');
  assert(/<PanNumInput label="x" grow /.test(src) && /<PanNumInput label="y" grow /.test(src), 'x/y 均带 grow (平分行宽)');
  assert(!/<PanNumInput label="缩放" grow/.test(src), '缩放不 grow (固定宽, 在开关行)');
}

if (failures) { console.error(`V224 FAILED: ${failures}`); process.exit(1); }
console.log('V224 ALL PASSED');

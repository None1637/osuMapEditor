// 验证器 v161: 下方时间轴微调 — 红/绿/蓝/黄线改 1px; kiai 橙区垂直居中于中线
// 运行: node verifier/v161/check.mjs (纯源码断言)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/Timelines.tsx');
const bt = src.slice(src.indexOf('export function BottomTimeline'));

section('红/绿/蓝/黄线 1px');
{
  assert(/lg\.rect\(x\(tp\.time\), 0, 1, mid\)/.test(bt), '红/绿线 1px (上半; v245: 静态层内红/绿各合批一次 fill)');
  assert(/g\.fillRect\(x\(b\), mid, 1, r\.height - mid\)/.test(bt), '蓝线 1px (下半)');
  assert(/g\.fillRect\(x\(bm\.general\.previewTime\), 0, 1, r\.height\)/.test(bt), '黄线 1px (全高)');
  assert(!/fillRect\(x\(tp\.time\), 0, 2/.test(bt) && !/fillRect\(x\(b\), mid, 2/.test(bt), '无残留 2px 色线');
}

section('kiai 垂直居中于中线');
{
  assert(/lg\.rect\(x0, mid \/ 2, Math\.max\(1, x1 - x0\), mid\)/.test(bt), 'kiai: y=mid/2 高=mid → 中心恰在 mid (中线) 上 (v245: 静态层内合批)');
}

section('不动的部分');
{
  assert(/g\.strokeStyle = '#ffffff'; g\.lineWidth = 2;/.test(bt), '白色播放头保持 2px');
  assert(/fillRect\(0, mid, r\.width, 1\)/.test(bt), '中线保持 1px');
}

console.log(failures ? `\nV161 FAILED: ${failures}` : '\nV161 ALL PASSED');
process.exit(failures ? 1 : 0);

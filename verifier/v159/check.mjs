// 验证器 v159: 下方时间轴 stable 布局精调
//   水平中线; 粉点 r=1 落在中线上; 红/绿线只画中线上方; 蓝线只画中线下方;
//   黄线(预览点)全高; kiai 橙区约半高 (上半)
// 运行: node verifier/v159/check.mjs (纯源码断言)
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

section('中线 + 粉点');
{
  assert(/const mid = r\.height \* 0\.5;/.test(bt), '定义中线 mid = 高度一半');
  assert(/fillRect\(0, mid, r\.width, 1\)/.test(bt), '绘制水平中线 (全宽 1px)');
  assert(/g\.arc\(x\(o\.time\), mid, 1, 0, Math\.PI \* 2\)/.test(bt), '粉点 r=1 落在中线上');
  // 中线画在粉点之前 (粉点压住中线)
  assert(bt.indexOf('fillRect(0, mid, r.width, 1)') < bt.indexOf('g.arc(x(o.time), mid, 1,'), '中线在粉点之前绘制');
}

section('红/绿线上半 · 蓝线下半 · 黄线全高');
{
  assert(/g\.fillRect\(x\(tp\.time\), 0, 1, mid\)/.test(bt), '红/绿 timing 线只画上半 (0 ~ mid; v161 起 1px)');
  assert(/g\.fillRect\(x\(b\), mid, 1, r\.height - mid\)/.test(bt), '书签蓝线只画下半 (mid ~ height; v161 起 1px)');
  assert(/g\.fillRect\(x\(bm\.general\.previewTime\), 0, 1, r\.height\)/.test(bt), '预览点黄线全高 (中线上下; v161 起 1px)');
}

section('kiai 半高');
{
  assert(/g\.fillRect\(x0, mid \/ 2, Math\.max\(1, x1 - x0\), mid\)/.test(bt), 'kiai 橙区高度 = mid (约一半; v161 垂直居中于中线)');
  assert(!/fillRect\(x0, 0, Math\.max\(1, x1 - x0\), r\.height\)/.test(bt), 'kiai 不再全高');
}

console.log(failures ? `\nV159 FAILED: ${failures}` : '\nV159 ALL PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v227: 红线重置滑条 SV 为 1.0x (stable 语义; 用户反馈 "遇到紅線不會重製成1.0x滑條速度")。
// v148 曾按 lazer ControlPointInfo 分表语义改为"红线不重置", 现按 stable 复原
// ("不重置"只是社区提案/lazer 改动, 见 ppy/osu#10267 讨论串; 本编辑器对齐 stable)。
// 行为断言见 verifier/v148/tests.ts (已按 v227 反转); 本文件做源码结构断言。
// 运行: node verifier/v227/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('parser.ts: svPointAt 红线重置');
{
  const src = readSrc('src/osu/parser.ts');
  const fn = src.slice(src.indexOf('export function svPointAt'), src.indexOf('export function svMultiplierAt'));
  assert(/if \(p\.uninherited\) green = null;/.test(fn), '红线清零 SV 绿线');
  assert(/else green = p;/.test(fn), '绿线照常跟踪');
  assert(!/if \(!p\.uninherited\) green = p;/.test(fn), 'v148 不重置实现已移除');
  // timingAt 采样语义不变 (hitsound 依赖)
  assert(/if \(p\.uninherited\) \{ red = p; green = null; \}/.test(src), 'timingAt 采样语义不变');
}

section('patternLibrary.ts / duplicate.ts: 同步');
{
  const pl = readSrc('src/osu/patternLibrary.ts');
  assert((pl.match(/svPointAt\(points, time\)/g) || []).length === 2, 'pxPerBeatAt/svAt 共用 svPointAt (自动获得 v227 语义)');
  const dup = readSrc('src/osu/duplicate.ts');
  assert(/if \(q\.uninherited\) sv = 1;/.test(dup), 'duplicate 局部 svAt 红线重置');
  assert(/else if \(q\.beatLength < 0\) sv = -100 \/ q\.beatLength;/.test(dup), 'duplicate 局部 svAt 绿线生效');
}

if (failures) { console.error(`V227 FAILED: ${failures}`); process.exit(1); }
console.log('V227 ALL PASSED');

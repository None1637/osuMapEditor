// v58 接线断言: 选区信息面板加宽防换行 (999.00x(600px) 不换行, 时间轴让出宽度)
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(t) { console.log('== ' + t); }
const readSrc = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8');

section('Timelines.tsx: SelectionInfoPanel 加宽 + 禁换行');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/SelectionInfoPanel/.test(src), 'SelectionInfoPanel 存在');
  assert(/w-40 shrink-0/.test(src), '面板加宽至 w-40 (160px, 容纳 Prev: 999.00x(600px) ≈ 149px)');
  assert(!/w-32 shrink-0 bg-\[#0c0c11\]/.test(src), '移除旧 w-32 (128px 不够)');
  assert(/whitespace-nowrap/.test(src), 'whitespace-nowrap 兜底防换行');
}

section('App.tsx: 时间轴 flex-1 让出宽度 (布局不变, 面板变宽即时间轴缩短)');
{
  const src = readSrc('src/App.tsx');
  assert(/flex-1 min-w-0/.test(src), 'TopTimeline 容器 flex-1 min-w-0 (随面板加宽自动缩短)');
  assert(/<SelectionInfoPanel \/>/.test(src), '面板仍与时间轴同行');
}

section('tsc -b 通过');
{
  try { execSync('npx tsc -b', { cwd: appRoot, stdio: 'pipe' }); assert(true, 'npx tsc -b'); }
  catch (e) { assert(false, 'npx tsc -b: ' + String(e.stdout ?? e).slice(0, 400)); }
}

if (failures) { console.error(`\nVERIFIER_V58_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V58_ALL_PASSED');

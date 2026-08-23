// v57 接线断言: 锁定间距默认关 (lazer DistanceSnapToggle 默认 TernaryState.False) + 网格间距输入自由输入 (局部文本态)
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(t) { console.log('== ' + t); }
const readSrc = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8');

section('store.ts: 锁定间距默认关 (lazer ComposerDistanceSnapProvider.DistanceSnapToggle 默认 False)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/distanceLock = false;/.test(src), 'distanceLock 默认 false');
  assert(!/distanceLock = true;/.test(src), '不存在 distanceLock 默认 true');
  assert(/TernaryState\.False/.test(src), '注释引用 lazer TernaryState.False 依据');
}

section('App.tsx: 网格间距输入自由输入 (输入中不钳制, 合法才提交, 失焦还原)');
{
  const src = readSrc('src/App.tsx');
  assert(/function GridSpacingInput\(/.test(src), 'GridSpacingInput 组件存在');
  assert(/useState<string \| null>\(null\)/.test(src), '局部文本态 (null = 未编辑)');
  assert(/value=\{text \?\? String\(committed\)\}/.test(src), '显示值 = 编辑中文本 ?? 已提交值');
  assert(/v >= 4 && v <= 256/.test(src), '提交时校验 lazer 范围 4..256 (输入中不钳制)');
  assert(!/Math\.max\(4, Math\.min\(256/.test(src), '移除逐键钳制 Math.max(4, Math.min(256, ...))');
  assert(/onBlur=\{\(\) => setText\(null\)\}/.test(src), '失焦还原为已提交值');
  assert(/store\.beatmap\.editor\.gridSize = v/.test(src), '合法提交仍写回 [Editor] GridSize (lazer)');
  assert(/<GridSpacingInput disabled=\{!bm\} \/>/.test(src), '工具栏使用 GridSpacingInput');
}

section('tsc -b 通过');
{
  try { execSync('npx tsc -b', { cwd: appRoot, stdio: 'pipe' }); assert(true, 'npx tsc -b'); }
  catch (e) { assert(false, 'npx tsc -b: ' + String(e.stdout ?? e).slice(0, 400)); }
}

if (failures) { console.error(`\nVERIFIER_V57_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V57_ALL_PASSED');

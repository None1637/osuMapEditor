// 验证器 v171: 命中中含已选中物件时优先返回已选中者
// (拖动/右键已选物件不被重叠的未选中物件触发 v154"离当前时间最近"重选)
// 运行: node verifier/v171/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('EditorCanvas.tsx: hitTest 已选优先');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const selHits = hits\.filter\(o => store\.selected\.has\(o\.id\)\);/.test(src), '命中列表筛出已选子集');
  assert(/return pickTimeNearestHit\(selHits\.length \? selHits : hits, store\.currentTime\);/.test(src),
    '有已选命中 → 已选子集内挑时间最近; 否则维持 v154 全命中挑时间最近');
  // 两处调用点 (mousedown 拖动/选中 + 右键删除) 共用 hitTest, 一处修复全生效
  const calls = src.match(/hitTest\(p\.x, p\.y\)/g) ?? [];
  assert(calls.length === 2, `hitTest 两处调用点共用 (实际 ${calls.length})`);
}

console.log(failures ? `\nV171 FAILED: ${failures}` : '\nV171 ALL PASSED');
process.exit(failures ? 1 : 0);

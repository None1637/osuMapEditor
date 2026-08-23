// 验证器 v202: 上时间轴 new combo 圆圈不再加粗描边 (lazer/stable 时间轴 NC 无特殊粗环)
// 运行: node verifier/v202/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: NC 描边去加粗');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(!/o\.newCombo \? '#ffffff'/.test(src), 'newCombo 特亮描边已删');
  assert(!/o\.newCombo \? 3\.5/.test(src), 'newCombo 加粗 3.5 已删');
  assert(/headWidth: sel \? 4 : 2\.5/.test(src), '仅选中保留粗环 (4), 其余统一 2.5');
  assert(/v202: newCombo 不再加粗描边/.test(src), 'v202 注释存在');
}

if (failures) { console.error(`V202 FAILED: ${failures}`); process.exit(1); }
console.log('V202 ALL PASSED');

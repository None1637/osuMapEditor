// 验证器 v205: 上时间轴折返箭头与 note 圆等大 (rad*2, 对齐游玩区 reversearrow 盒子 = 2r)
// 运行: node verifier/v205/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: drawTimelineObject 折返箭头尺寸');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/const size = rad \* 2; \/\/ v205/.test(src), '箭头 = rad*2 (与头/尾圆直径一致)');
  assert(!/rad \* 1\.3/.test(src), '旧的 1.3rad 已删');
  assert(/g\.drawImage\(img, -size \/ 2, -size \/ 2, size, size\)/.test(src), '仍按 size 盒子居中绘制');
}

if (failures) { console.error(`V205 FAILED: ${failures}`); process.exit(1); }
console.log('V205 ALL PASSED');

// 验证器 v199: 滑条折返箭头画在头/尾圈之下 (对齐 lazer DrawableSliderRepeat 层级)
// 运行: node verifier/v199/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: 箭头绘制先于头圈/尾圈');
{
  const src = readSrc('src/osu/renderer.ts');
  const iArrow = src.indexOf('v199: 折返箭头先画');
  const iHead = src.indexOf('// 头: sliderstartcircle 着色');
  const iTail = src.indexOf('// 尾端 (半透明)');
  assert(iArrow > 0, 'v199 箭头段存在');
  assert(iArrow > 0 && iHead > iArrow && iTail > iHead, '顺序: 箭头 -> 头圈 -> 尾圈 (箭头在最下层)');
  assert(/drawSprite\(g, skin\.reversearrow, p\.x, p\.y, size, ang\);/.test(src), 'reversearrow 仍按切线角绘制');
  // size 声明已提到箭头段之前 (箭头用 size) — 从箭头段起找 (drawCircle 里也有同名声明)
  const iSize = src.indexOf('const size = r * 2;', iArrow);
  assert(iSize > iArrow && iSize < iHead, 'size 声明位于箭头段内 (使用之前)');
}

if (failures) { console.error(`V199 FAILED: ${failures}`); process.exit(1); }
console.log('V199 ALL PASSED');

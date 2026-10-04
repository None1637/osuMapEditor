// 验证器 v311: 圆圈橙黄环与滑条选中描边同宽且完全覆盖 —
//   环带 = 蓝边带 = 0.81r..0.925r (lw = 0.115r, 弧半径 r-0.5lw), 滑条头不再露出蓝色圆弧
// 运行: node verifier/v311/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/osu/renderer.ts');

section('drawSelectionRing: 环带 = 滑条选中蓝边带');
{
  const ring = src.match(/export function drawSelectionRing[\s\S]{0,600}?\n\}/);
  assert(!!ring, 'drawSelectionRing 存在');
  assert(!!ring && /const lw = Math\.max\(1\.5, r \* 0\.115\);/.test(ring[0]), '线宽 0.115r (= 蓝边带宽 0.925-0.81), 保底 1.5');
  // v314 修正: v311 的 r-0.5lw 是环中心线, 环带实为 [r-lw, r] = 0.885r..1.0r 整体偏外;
  //   蓝边带中心 = (0.81+0.925)/2 = 0.8675r, 弧半径改为 r*0.8675 后环带恰为 0.81r..0.925r
  assert(!!ring && /g\.arc\(x, y, r \* 0\.8675, 0, Math\.PI \* 2\)/.test(ring[0]), '弧半径 0.8675r (v314 修正) → 环带 0.81r..0.925r, 与蓝边带完全重合');
}

section('drawSliderBodyOutline cover: 蓝边带保持 0.81..0.925r (环的覆盖目标)');
{
  const cov = src.match(/if \(cover\) \{[\s\S]{0,500}?source-over';\n  \}/);
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.925;/.test(cov[0]), 'cover 描边 0.925r');
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.81;/.test(cov[0]), 'cover 镂空 0.81r');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv311 全部通过');
process.exit(failures ? 1 : 0);

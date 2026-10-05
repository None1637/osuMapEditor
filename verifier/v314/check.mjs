// 验证器 v314: 修正 v311 的选中环弧半径算术错误 —
//   用户反馈「藍色的框對了 黃色還是太大」: v311 以为弧半径 r-0.5lw 时环带落在 0.81r..0.925r,
//   但 r-0.5lw 是环带中心线, 实际环带 = [r-lw, r] = 0.885r..1.0r, 整体偏外遮不住滑条蓝边。
//   蓝边带中心 = (0.81+0.925)/2 = 0.8675r, lw = 0.115r → 环带 = 0.8675r±0.0575r = 0.81r..0.925r 逐点重合。
// 运行: node verifier/v314/check.mjs
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

section('drawSelectionRing: 环带精确等于蓝边带 0.81r..0.925r');
{
  const ring = src.match(/export function drawSelectionRing[\s\S]{0,2000}?\n\}/);
  assert(!!ring, 'drawSelectionRing 存在');
  assert(!!ring && /const lw = Math\.max\(1\.5, r \* 0\.115\);/.test(ring[0]), '线宽 0.115r (= 蓝边带宽 0.925-0.81), 保底 1.5');
  assert(!!ring && /const rad = r \* 0\.8675;/.test(ring[0]) && /og\.arc\(0, 0, rad, 0, Math\.PI \* 2\)/.test(ring[0]), '弧半径 0.8675r = 蓝边带中心 → 环带 0.81r..0.925r');
  assert(!!ring && !/r - lw \* 0\.5/.test(ring[0]), 'v311 的错误弧半径 r-0.5lw 已移除');
}

section('drawSliderBodyOutline cover: 蓝边带保持 0.81..0.925r (环的覆盖目标)');
{
  const cov = src.match(/if \(cover\) \{[\s\S]{0,500}?source-over';\n  \}/);
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.925;/.test(cov[0]), 'cover 描边 0.925r');
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.81;/.test(cov[0]), 'cover 镂空 0.81r');
}

section('算术自洽: 0.8675 ± 0.115/2 = 0.81 .. 0.925');
{
  const center = 0.8675, half = 0.115 / 2;
  assert(Math.abs(center - half - 0.81) < 1e-12 && Math.abs(center + half - 0.925) < 1e-12, '环带端点与蓝边带端点一致');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv314 全部通过');
process.exit(failures ? 1 : 0);

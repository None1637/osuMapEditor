// 验证器 v310: 选中效果线宽微调 —
//   圆圈橙黄环: 线宽 0.14r → 0.105r (75%), 环中心线对齐圆圈边缘 (弧半径 r-0.5lw, 外缘齐平);
//   stable 滑条描边: 0.79r..0.96r 粗环带 → 0.81r..0.925r 精确覆盖原白边带 (只是让原描边变蓝)
// 运行: node verifier/v310/check.mjs
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

section('drawSelectionRing: 线宽 75% + 中心线对齐圆圈边缘');
{
  const ring = src.match(/export function drawSelectionRing[\s\S]{0,2000}?\n\}/);
  assert(!!ring, 'drawSelectionRing 存在');
  assert(!!ring && /const lw = Math\.max\(1\.5, r \* 0\.115\);/.test(ring[0]), 'v311: 线宽 0.115r (= 滑条选中蓝边带宽), 保底 1.5');
  assert(!!ring && /const rad = r \* 0\.8675;/.test(ring[0]) && /og\.arc\(0, 0, rad, 0, Math\.PI \* 2\)/.test(ring[0]), 'v314: 弧半径 0.8675r (环带恰 0.81..0.925r, 完全覆盖滑条选中蓝边)');
  assert(!!ring && /og\.shadowBlur = lw \* 0\.6;/.test(ring[0]), '外发光保留并随线宽缩小');
}

section('drawSliderBodyOutline cover: 精确覆盖原白边带');
{
  const cov = src.match(/if \(cover\) \{[\s\S]{0,500}?source-over';\n  \}/);
  assert(!!cov, 'cover 分支存在');
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.925;/.test(cov[0]), '描边 0.925r (白边带上缘 0.922r + 微小余量)');
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.81;/.test(cov[0]), '镂空 0.81r (白边带下缘 0.8125r - 微小余量)');
  assert(!!cov && !/0\.96/.test(cov[0]) && !/0\.79/.test(cov[0]), 'v308 的粗环带 (0.79r..0.96r) 已移除');
  assert(!!cov && /og\.shadowBlur = 10;/.test(cov[0]), '外缘蓝辉光保留 (stable 同款)');
}

section('白边带数值未被改动 (paintSliderBody 原样)');
{
  assert(/r \* 2 \* 0\.922/.test(src) && /r \* 2 \* 0\.8125/.test(src), 'paintSliderBody 白边带 0.8125r..0.922r 保持');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv310 全部通过');
process.exit(failures ? 1 : 0);

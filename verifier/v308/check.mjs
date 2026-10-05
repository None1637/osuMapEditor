// 验证器 v308: 选中效果修正 — hover 不显示任何选中样式; stable 选中环/描边覆盖原边框 (而非外加一圈)
// 运行: node verifier/v308/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('EditorCanvas.tsx: hover 无选中样式');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(!/hoverObjRef/.test(src), 'hoverObjRef 移除 (单点黄环/滑条蓝边 hover 效果删除)');
  assert(/v308: hover 不再画任何选中样式圆环\/描边/.test(src), '渲染循环 hover 块移除并留注');
  assert(/hoverSliderRef\.current = hit && hit\.type === 'slider'/.test(src), '滑条控制点 hover 预览保留');
}

section('renderer.ts: 选中环覆盖圆圈白边');
{
  const src = readSrc('src/osu/renderer.ts');
  const ring = src.match(/export function drawSelectionRing[\s\S]{0,2000}?\n\}/); // v340: sprite 化后函数变长
  assert(!!ring && /const lw = Math\.max\(1\.5, r \* 0\.115\);/.test(ring[0]), 'v311: 线宽 0.115r (= 滑条选中蓝边带宽 0.81..0.925r)');
  assert(!!ring && /const rad = r \* 0\.8675;/.test(ring[0]) && /og\.arc\(0, 0, rad, 0, Math\.PI \* 2\)/.test(ring[0]), 'v314: 弧半径 0.8675r (蓝边带中心; 环带恰 0.81..0.925r, v311 的 r-0.5lw 偏外)');
  assert(!!ring && /og\.shadowBlur = lw \* 0\.6;/.test(ring[0]), '轻微外发光 (stable 光晕)');
}

section('renderer.ts: stable 滑条描边 cover 模式 (覆盖白边带)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/cover = false\) \{/.test(src), 'drawSliderBodyOutline cover 参数 (默认 false = lazer 外环)');
  const cov = src.match(/if \(cover\) \{[\s\S]{0,400}?source-over';\n  \}/);
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.925;/.test(cov[0]), 'v310: cover 描边 0.925r (白边带 0.8125..0.922r + 微小余量)');
  assert(!!cov && /og\.lineWidth = r \* 2 \* 0\.81;/.test(cov[0]), 'v310: cover 镂空 0.81r (环带 0.81..0.925r, 只是让原描边变蓝)');
  assert(!!cov && /og\.shadowColor = color; og\.shadowBlur = 10;/.test(cov[0]), 'cover 外缘蓝辉光 (stable 同款)');
  assert(/sliderOutlineSprite\(p\.points, radius, stableSel \? '#4a90e2' : '#4df3ff', stableSel, o\.id/.test(src), // v340: 缓存 sprite
    'stable 选中走 cover 模式, lazer 保持原外环');
  // lazer 分支保持原样 (外加环)
  assert(/og\.lineWidth = r \* 2 \+ 5;/.test(src) && /og\.lineWidth = r \* 2 - 1\.5;/.test(src), 'lazer 外环分支保留');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv308 全部通过');
process.exit(failures ? 1 : 0);

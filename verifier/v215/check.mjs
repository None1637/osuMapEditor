// 验证器 v215: 暂留模式 (关打击动画) 滑条头/尾圈遵循单点同款淡出, 不随滑条身一起消失
// 运行: node verifier/v215/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer/lifecycle 纯函数单测 (tests.ts)');
{
  const out = path.join(root, 'verifier/v215/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v215/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('lifecycle.ts: 滑条暂留窗口');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/o\.type === 'circle' \|\| o\.type === 'slider'/.test(src), 'isVisibleAt 暂留窗口扩到滑条');
}

section('renderer.ts: 头/尾独立残留');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/export function sliderTailLingerAlpha/.test(src), 'sliderTailLingerAlpha 纯函数');
  assert(/sliderNodeLinger/.test(src), 'renderPlayfield 暂留滑条不剔除');
  assert(/drawSlider\(rc, o, radius, color, ci\.index, dt, preempt, sliderNodeLinger\)/.test(src), 'drawSlider 接收 nodeLinger');
  assert(/nodeLinger && dt >= 0/.test(src), '头圈暂留独立 alpha 分支');
  assert(/drawApproach\(g, skin, color, o\.x, o\.y, size, dt, preempt, true\)/.test(src), '头圈暂留缩圈贴边 (同单点 v183)');
  assert(/tailLinger !== null/.test(src), '尾圈暂留分支');
  assert(/g\.globalAlpha = 0\.5 \* tailLinger/.test(src), '尾圈独立 alpha (不随滑条身)');
  assert(/tintedSprite\(skin\.sliderendcircle, '#ffffff'\)/.test(src), '尾圈暂留变白 (同单点 v200)');
}

if (failures) { console.error(`V215 FAILED: ${failures}`); process.exit(1); }
console.log('V215 ALL PASSED');

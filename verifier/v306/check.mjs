// 验证器 v306: F07 复查修复 — 近共线三点圆弧 (头夹在两锚点间) 几何爆炸冻结白屏
// 移植 lazer PathControlPointVisualiser.EnsureValidPathTypes: 3 点圆弧包围盒 >=640x480 回退贝塞尔
// 运行: node verifier/v306/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('sliderPath 纯函数单测 (tests.ts: 病态弧收敛 / 正常弧不受影响)');
{
  const out = path.join(root, 'verifier/v306/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v306/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('sliderPath.ts: 圆弧包围盒回退 (lazer EnsureValidPathTypes)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/function circularArcBBox\(/.test(src), 'circularArcBBox 存在 (lazer CircularArcBoundingBox 移植)');
  assert(/if \(bb\.w >= 640 \|\| bb\.h >= 480\) return bezierPath\(pts\);/.test(src), '包围盒 >=640x480 回退贝塞尔 (lazer 阈值)');
  assert(/v306: lazer PathControlPointVisualiser\.EnsureValidPathTypes 移植/.test(src), 'v306 注释标注来源');
  assert(/if \(subPoints >= 1000\) return bezierPath\(pts\);/.test(src), 'v283 subPoints>=1000 兜底保留 (双保险)');
  // 回退判定在采样之前 (先于 subPoints 计算)
  const bbIdx = src.indexOf('bb.w >= 640');
  const subIdx = src.indexOf('subPoints >= 1000');
  assert(bbIdx > 0 && subIdx > bbIdx, '包围盒判定先于 subPoints 判定');
}

section('renderer.ts: 位图尺寸上限永远优先 (v148 末端延长防御)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/Math\.min\(4, Math\.max\(1, ss, 0\.005\), MAX_DIM \/ w, MAX_DIM \/ h, Math\.sqrt\(MAX_AREA \/ \(w \* h\)\)\)/.test(src), 'q = min(目标分辨率, 尺寸上限) — 上限不被下限顶破');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv306 全部通过');
process.exit(failures ? 1 : 0);

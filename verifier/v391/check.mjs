// 验证器 v391: 游玩区平移加旋转 + 左侧栏布局 (开关独占行, 缩放/旋转下一行)
//   1) store.playfieldRotation (度, 默认 0; 视图辅助不入谱面, 关闭保留值);
//   2) src/osu/pfRotate.ts (新, 纯函数): pfRotFwd/pfRotInv 绕游玩区中心 (256,192);
//   3) playfieldTransform 返回 rot (关闭时 0); 渲染管线 scale 后最内层 rotate;
//      toOsu 撤销旋转 (命中/放置在未旋转 osu 系); __osuToClient/__osuToCanvas 正变换;
//      Alt+滚轮缩放锚定补偿改用 F(p); 静态层缓存键加 b/c, 旋转时放弃紧凑裁剪用整画布;
//      中键平移不变 (pan 在旋转外层);
//   4) UI: 游玩区平移按钮独占一行 (撤销 v224 与缩放同行), 下一行缩放/旋转平分 (grow), x/y 行不变;
//   5) i18n: app.playfield_rot = 旋转, playfield_pan_title 补旋转说明;
//   6) v224/v229 验证器适配。
// 运行: node verifier/v391/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v391/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v391/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V391_TESTS_*)
fs.unlinkSync(out);

section('store: playfieldRotation');
{
  const src = read('src/osu/store.ts');
  assert(/playfieldRotation = 0;/.test(src), '旋转默认 0 (视图辅助)');
}

section('EditorCanvas.tsx: 变换接线');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/import \{ pfRotFwd, pfRotInv \} from '@\/osu\/pfRotate'/.test(src), '引入 pfRotate 纯函数');
  assert(/return \{ \.\.\.base, rot: 0 \};/.test(src), '关闭平移时 rot=0 退回适配视图');
  assert(/rot: store\.playfieldRotation/.test(src), 'playfieldTransform 返回 rot');
  assert(/g\.rotate\(rot \* Math\.PI \/ 180\)/.test(src), '渲染管线最内层 rotate (绕中心)');
  assert(/return rot \? pfRotInv\(q, rot\) : q;/.test(src), 'toOsu 撤销旋转 (命中在未旋转 osu 系)');
  const fwdUses = (src.match(/pfRotFwd\(\{ x, y \}, rot\)/g) ?? []).length;
  assert(fwdUses === 2, `__osuToClient/__osuToCanvas 正变换 (${fwdUses}/2)`);
  assert(/const fp = pfRotFwd\(p, playfieldTransform/.test(src), 'Alt+滚轮缩放锚定补偿用 F(p)');
  assert(/m0\.b\.toFixed\(4\), m0\.c\.toFixed\(4\)/.test(src), '静态层缓存键含 b/c (旋转)');
  assert(/const rotated = m0\.b !== 0 \|\| m0\.c !== 0;/.test(src), '旋转时放弃紧凑裁剪 (整画布)');
}

section('App.tsx: 布局 (开关独占行 / 缩放+旋转平分)');
{
  const src = read('src/App.tsx');
  assert(/data-pan-input="toggle"\s*\n?\s*className=\{`w-full/.test(src), '平移按钮独占一行 (w-full)');
  assert(/<PanNumInput label="Rot" labelKey="app\.playfield_rot" grow value=\{Math\.round\(store\.playfieldRotation \* 10\) \/ 10\} step=\{1\} digits=\{1\}/.test(src), '旋转输入框 (1 位小数)');
  assert(/onCommit=\{v => \{ store\.playfieldRotation = v; store\.emit\(\); \}\}/.test(src), '旋转提交写 store');
  assert(/<PanNumInput label="Zoom" labelKey="app\.playfield_zoom" grow/.test(src), '缩放 grow 与旋转平分一行');
}

section('i18n + 旧验证器适配');
{
  const dict = read('src/i18n/dicts/zh-CN/app.ts');
  assert(/'app\.playfield_rot': '旋转'/.test(dict), 'app.playfield_rot = 旋转');
  assert(/旋转 = 角度/.test(dict), 'playfield_pan_title 补旋转说明');
  assert(/v391 适配/.test(read('verifier/v224/check.mjs')), 'v224 已适配标注');
  assert(/v391 适配/.test(read('verifier/v229/check.mjs')), 'v229 已适配标注');
}

if (failures) { console.error(`V391 FAILED: ${failures}`); process.exit(1); }
console.log('V391 ALL PASSED');

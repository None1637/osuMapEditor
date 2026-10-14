// 验证器 v409: 在选中滑条锚点处分割滑条
// 运行: cd app && node verifier/v409/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v409/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v409/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: splitSliderAtAnchors');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/v409: 在选中锚点处分割滑条/.test(src), 'v409 版本注释');
  assert(/export function splitSliderAtAnchors\(o: HitObject, indices: number\[\]\): HitObject\[\] \| null/.test(src), '函数签名');
  const fn = src.match(/export function splitSliderAtAnchors[\s\S]*?\n\}/)?.[0] ?? '';
  assert(/indices\.filter\(i => i > 0 && i < n - 1\)/.test(fn), '剔除头尾锚点');
  assert(/ctrl\.slice\(bounds\[j\], bounds\[j \+ 1\] \+ 1\)/.test(fn), '缝点双侧各一份');
  assert(/pts\.length === 3 \? 'P' : 'B'/.test(fn), 'P 段恰 3 点保持否则 B');
  assert(/hitSound: first \? \(o\.hitSound \?\? 0\) : 0/.test(fn), 'hitSound 仅首段');
  assert(/newCombo: first && !!o\.newCombo/.test(fn), 'newCombo 仅首段');
  assert(/edgeSounds\[0\]/.test(fn) && /edgeSounds\[edgeSounds\.length - 1\]/.test(fn), 'edge 首段继承头末段继承尾');
}

section('store.ts: splitSelectedSliderNodes');
{
  const src = readSrc('src/osu/store.ts');
  const fn = src.match(/  splitSelectedSliderNodes\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(fn !== '', '方法存在');
  assert(/splitSliderAtAnchors\(orig, \[\.\.\.idxSet\]\)/.test(fn), '逐条滑条分割');
  assert(/this\.pushUndo\(\)/.test(fn), '一次 undo');
  assert(/resnapSliderLength\(bm, p, this\.beatSnap\)/.test(fn), '每段长度重吸附 (遵守 v406 开关)');
  assert(/t = p\.time \+ \(p\.length \?\? 0\) \/ vel/.test(fn), '子滑条时间顺序衔接');
  assert(/this\.selectedNodes\.clear\(\)/.test(fn) && /this\.selected = new Set\(newIds\)/.test(fn), '分割后选中全部子滑条');
  assert(/bm\.hitObjects\.sort\(\(a, b\) => a\.time - b\.time\)/.test(fn), 'hitObjects 重排序');
  assert(/invalidatePath\(orig\.id\)/.test(fn) && /invalidatePath\(p\.id\)/.test(fn), '路径缓存失效');
  assert(/splitSliderAtAnchors/.test(src.match(/from '\.\/sliderPath'/)?.[0] ?? '') || /splitSliderAtAnchors/.test(src), 'store 已导入 splitSliderAtAnchors');
}

section('Inspector.tsx: 入口按钮');
{
  const src = readSrc('src/components/Inspector.tsx');
  const hits = src.match(/data-conv-apply="split-anchors"/g) ?? [];
  assert(hits.length === 2, '单选/多选两个 Convert 区都有按钮');
  assert(/store\.nodeSelectionCount > 0/.test(src), '节点选区存在时才显示');
  assert(/store\.splitSelectedSliderNodes\(\)/.test(src), '点击调 store.splitSelectedSliderNodes');
}

section('词典');
{
  const zh = readSrc('src/i18n/dicts/zh-CN/inspector.ts');
  assert(/'inspector\.split_at_anchors': '在锚点处分割'/.test(zh), 'zh-CN 词条');
}

if (failures) { console.error(`V409 FAILED (${failures})`); process.exit(1); }
console.log('V409 ALL PASSED');

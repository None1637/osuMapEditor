// 验证器 v61: 绿线 SV 全显示 (lazer 无去重) + 红绿线三角旗改竖线 (lazer PointVisualisation)
// 运行: cd app && node verifier/v61/check.mjs; node verifier/v61/cdp-v61.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v61/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v61/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timelinePills.ts: svPoints 全部绿线 (lazer 无去重, 剔除只在 lazer 导出时)');
{
  const src = readSrc('src/osu/timelinePills.ts');
  assert(/export function svPoints/.test(src), 'svPoints 存在');
  assert(!/export function svChangePoints/.test(src), '旧 svChangePoints 已移除');
  assert(!/Math\.abs\(sv - eff\) > 1e-9/.test(src), '无与上一条 SV 比较的去重判断');
  assert(/IsRedundant/.test(src), '注释引用 lazer 导出剔除 IsRedundant');
}

section('Timelines.tsx: 三角旗 -> 竖线 (lazer Red2/Lime1 色)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(!/moveTo\(tx - 5, fy\)/.test(src), '三角形旗标已移除');
  assert(!/svChangePoints/.test(src), '不再引用 svChangePoints');
  assert(/svPoints\(bm\.timingPoints\)/.test(src), 'SV 药丸遍历 svPoints');
  assert(/rgba\(235,71,71,0\.55\)/.test(src) && /rgba\(178,255,102,0\.45\)/.test(src), '竖线用 lazer Red2/Lime1 (半透明)');
  assert(/g\.rect\(tx - 1, 0, 2, r\.height\)/.test(src), '2px 全高竖线 (v245: 红/绿各合批为一条路径一次 fill)');
}

if (failures) { console.error(`\nVERIFIER_V61_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V61_ALL_PASSED');

// 验证器 v93: pattern 缩略图滑条串形修复 — 合成 id 改 thumbBaseId 负 id 段
// 运行: cd app && node verifier/v93/check.mjs; node verifier/v93/cdp-v93.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v93/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v93/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('patternThumb.ts: 合成 id 走负 id 段');
{
  const src = readSrc('src/components/patternThumb.ts');
  assert(/export function thumbBaseId\(patternId: string\)/.test(src), 'thumbBaseId 导出');
  assert(/const base = thumbBaseId\(pattern\.id\)/.test(src), '渲染前取段起点');
  assert(/id: base - i,/.test(src), '合成物件 id = base - i');
  assert(!/id: i \+ 1/.test(src), '旧 i+1 id 已移除');
}

section('根因确认: 缓存按 id 且 key 不含几何 (注释存档)');
{
  const sp = readSrc('src/osu/sliderPath.ts');
  assert(/pathCache = new Map<number, SliderPath>\(\)/.test(sp), 'pathCache 按 id');
  const rd = readSrc('src/osu/renderer.ts');
  assert(/bodyCache = new Map<number,/.test(rd) && /const key = `\$\{r\.toFixed/.test(rd), 'bodyCache 按 id, key 只有半径/颜色');
}

if (failures) { console.error(`\nVERIFIER_V93_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V93_ALL_PASSED');

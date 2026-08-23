// 验证器 v54: 旋转手柄显示尺寸对齐 lazer (Size=15, hover/held ScaleTo(1.5) -> 22.5px)
// 运行: cd app && node verifier/v54/check.mjs; node verifier/v54/cdp-v54.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v54/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v54/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('EditorCanvas.tsx: 旋转手柄显示尺寸 = 15 * 1.5 (lazer hover ScaleTo(1.5))');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const s = 15 \* 1\.5 \* px/.test(src), '显示尺寸 15*1.5=22.5px (hover 才显示, 显示即放大态)');
  assert(!/const s = 15 \* px;/.test(src), '不再用未放大的 15px');
  assert(/ScaleTo\(1\.5\)/.test(src), '注释标注 lazer ScaleTo(1.5) 依据');
}

if (failures) { console.error(`\nVERIFIER_V54_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V54_ALL_TESTS_PASSED');

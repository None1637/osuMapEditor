// 验证器 v397: 右上角前/后位置距离改按 1.0x 间距基准 (不受当前间距控制 DS 影响)
// 运行: cd app && node verifier/v397/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v397/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v397/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('spacing.ts: spacingMultiplier 基准固定 1.0x');
{
  const src = readSrc('src/osu/spacing.ts');
  assert(/return distPx \/ \(100 \* bm\.difficulty\.sliderMultiplier \* sv \* beats\);/.test(src),
    'spacingMultiplier = distPx / (100 * SM * SV * beats), 不含 DS');
  assert(!/beats <= 0 \|\| bm\.editor\.distanceSpacing <= 0/.test(src), 'DS<=0 不再返回 null');
  assert(/return bm\.editor\.distanceSpacing \* 100 \* bm\.difficulty\.sliderMultiplier \* sv;/.test(src),
    'distanceSnapPxPerBeat (放置用) 仍含 DS — 锁定间距放置不变');
  assert(/distanceSnapPxPerBeat\(bm, endTime\) \* beats/.test(src), 'distanceLockDistance 仍用含 DS 基准 (放置自洽)');
}

section('验证器适配标注');
{
  assert(/v397/.test(readSrc('verifier/v45/tests.ts')), 'v45 tests 已适配 (DS=2 仍 0.714x)');
  assert(/v397/.test(readSrc('verifier/v149/tests.ts')), 'v149 tests 已适配 (DS=0 不再 null)');
  assert(/v397/.test(readSrc('verifier/v149/check.mjs')), 'v149 check 已适配 (公式断言)');
}

if (failures) { console.error(`V397 FAILED (${failures})`); process.exit(1); }
console.log('V397 ALL PASSED');

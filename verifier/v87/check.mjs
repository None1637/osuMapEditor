// 验证器 v87: 缩略图 90x90 + pattern 内部绿线记录/插入 (两种对齐模式)
// 运行: cd app && node verifier/v87/check.mjs; node verifier/v87/cdp-v87.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v87/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v87/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('patternLibrary.ts: 内部绿线记录与插入');
{
  const src = readSrc('src/osu/patternLibrary.ts');
  assert(/greenlines\?: \{ beatOffset: number; sv: number \}\[\]/.test(src), 'StoredPattern.greenlines 字段');
  assert(/!t\.uninherited && t\.beatLength < 0 && t\.time >= first\.time && t\.time <= endMs/.test(src), '收藏记录覆盖时间段内绿线');
  assert(/beatOffset: beatTimeAt\(tps, t\.time\) - startBeat, sv: -100 \/ t\.beatLength/.test(src), '绿线按拍偏移 + sv 倍率记录');
  assert(/opts\.greenlineAlign \|\| opts\.scaleAlign/.test(src), '两种对齐模式都插内部绿线');
  assert(/tpsEff/.test(src) && /pxPerBeatAt\(tpsEff, mult, time\)/.test(src), '缩放对齐等效速度含内部绿线');
  assert(/greenlines\.push\(mkGreen\(Math\.round\(startMs\), svNeeded\), mkGreen\(endMs, svAt\(tps, endMs\)\)\)/.test(src), '开头对齐 + 结尾还原保留');
}

section('PatternPanel.tsx: 缩略图 90x90');
{
  const panel = readSrc('src/components/PatternPanel.tsx');
  assert(/width=\{90\} height=\{90\}/.test(panel), '缩略图 90x90');
}

if (failures) { console.error(`\nVERIFIER_V87_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V87_ALL_PASSED');

// 验证器 v201: combo 颜色顺序对齐 lazer — 首个 combo 生效色 = 颜色表下标 1; comboSkip 只影响谱面色;
// spinner 不开新 combo
// 运行: node verifier/v201/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v201/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v201/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V201_TESTS_*)
fs.unlinkSync(out);

section('renderer.ts: computeCombos / 消费方');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/comboWithOffset \+= 1 \+ \(o\.comboSkip \?\? 0\)/.test(src), 'comboSkip 进 WithOffsets');
  assert(/o\.type !== 'spinner' && \(o\.newCombo \|\| lastType === null \|\| lastType === 'spinner'\)/.test(src),
    'spinner 不开新 combo + spinner 后强制 new combo');
  assert(/displaySettings\.skinColors \? ci\.combo : ci\.comboWithOffset/.test(src), '游玩区: 皮肤色用 combo, 谱面色用 WithOffsets');
  assert(/: 1;/.test(src) && /colorIdx = ciVals\.length/.test(src), '放置预览首物件色索引 = 1');
}

section('Timelines.tsx: 上时间轴消费方');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/displaySettings\.skinColors \? ci\.combo : ci\.comboWithOffset/.test(src), '时间轴: 皮肤色用 combo, 谱面色用 WithOffsets');
}

if (failures) { console.error(`V201 FAILED: ${failures}`); process.exit(1); }
console.log('V201 ALL PASSED');

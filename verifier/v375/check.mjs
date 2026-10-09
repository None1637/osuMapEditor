// 验证器 v375: Timing 行 BPM/SV 显示统一小数位 (soulten 反馈) —
//   BPM 统一 3 位小数 (toFixed(3)), SV 统一 2 位小数 (toFixed(2));
//   编辑态 PreciseInput 仍走 fmtTpPrec 全精度 (不受影响)。
// 运行: node verifier/v375/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v375/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v375/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V375_TESTS_*)
fs.unlinkSync(out);

section('TimingPanel.tsx: 行文本统一小数位');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/fmtBpm\(tp\.beatLength\) : fmtSv\(tp\.beatLength\)/.test(src), '行文本走 fmtBpm/fmtSv');
  assert(!/fmtTpPrec\(60000 \/ tp\.beatLength\) : fmtTpPrec\(-100 \/ tp\.beatLength\)/.test(src), '行文本不再用 fmtTpPrec (v374 旧结构移除)');
  assert(/import \{[^}]*fmtTpPrec, fmtBpm, fmtSv[^}]*\} from '@\/osu\/timingEdit'/.test(src), '导入 fmtBpm/fmtSv');
  // 编辑态仍全精度
  assert((src.match(/<PreciseInput autoFocus/g) || []).length === 2, 'BPM/SV 编辑态仍 PreciseInput 全精度 (2 处)');
}

if (failures) { console.error(`V375 FAILED: ${failures}`); process.exit(1); }
console.log('V375 ALL PASSED');

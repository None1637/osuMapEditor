// 验证器 v42: 滑条转连打 — 按数量模式时间吸附节拍网格 (spacingBeats 兼作网格粒度)
// 运行: cd app && node verifier/v42/check.mjs; node verifier/v42/cdp-v42.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v42/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v42/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('stream.ts: count 模式时间网格 (v43: head + i*div, 位置按数量分布)');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/if \(p\.mode === 'count'\) \{[\s\S]{0,300}times\.push\(red\.time \+ Math\.round\(\(s\.time \+ i \* div - red\.time\) \/ div\) \* div - s\.time\)/.test(src),
    'count 模式: 时间 = head + i*div 吸附 red 网格');
  assert(/p\.mode === 'count'\) return times\.map\(\(_, i\) => i \/ \(n - 1\)\)/.test(src), 'count 模式: 位置索引均布 (与时间解耦)');
  assert(!/rel > duration/.test(src), '不再丢弃超尾点 (允许超出滑条尾生成)');
}

section('StreamDialog: 两种模式都显示间距 (拍)');
{
  const dlg = readSrc('src/components/convert/StreamDialog.tsx');
  assert(/params\.mode === 'count' && <span[^>]*>时间对齐网格<\/span>/.test(dlg), 'count 模式显示「时间对齐网格」提示');
  // 间距 Row 不在条件分支内: mode 三元/条件里只有 数量 Row
  assert(/params\.mode === 'count' && \(\s*<Row label="数量">/.test(dlg), '数量 Row 仅 count 模式');
  assert(!/params\.mode === 'spacing'[\s\S]{0,80}间距 \(拍\)/.test(dlg), '间距 Row 不受模式限制');
}

if (failures) { console.error(`\nVERIFIER_V42_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V42_ALL_TESTS_PASSED');

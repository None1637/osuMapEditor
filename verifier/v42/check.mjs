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
  // v346 多语言改造: 标签走 t(convert.stream_*), 中文译文在 zh-CN 词典
  assert(/params\.mode === 'count' && <span[^>]*>\{t\('convert\.stream_snap_hint', 'Time snaps to grid'\)\}<\/span>/.test(dlg), 'count 模式显示「时间对齐网格」提示 (i18n key)');
  // 间距 Row 不在条件分支内: mode 三元/条件里只有 数量 Row
  assert(/params\.mode === 'count' && \(\s*<Row label=\{t\('convert\.stream_count', 'Count'\)\}>/.test(dlg), '数量 Row 仅 count 模式 (i18n key)');
  assert(!/params\.mode === 'spacing'[\s\S]{0,120}convert\.stream_spacing/.test(dlg), '间距 Row 不受模式限制');
  const zhConvert = readSrc('src/i18n/dicts/zh-CN/convert.ts');
  assert(/'convert\.stream_snap_hint':\s*'时间对齐网格'/.test(zhConvert) && /'convert\.stream_count':\s*'数量'/.test(zhConvert), 'zh-CN 词典提示/数量译文');
}

if (failures) { console.error(`\nVERIFIER_V42_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V42_ALL_TESTS_PASSED');

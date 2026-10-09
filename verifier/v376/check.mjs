// 验证器 v376: Timing 时间列 — 平时仅显示 h:mm:ss.mmm; 点击同时出 ms 与时分秒两个编辑框 —
//   parseMsTime 解析 h:mm:ss.mmm (小时/毫秒可省略); formatMsTime 往返一致。
// 运行: node verifier/v376/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v376/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v376/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V376_TESTS_*)
fs.unlinkSync(out);

section('TimingPanel.tsx: 时间列结构');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/dataDisplay="time"\s*\n\s*display=\{<span className="tabular-nums" data-tp-fmt>\{formatMsTime\(tp\.time\)\}<\/span>\}/.test(src),
    '平时仅显示 h:mm:ss.mmm 文本 (不再并列 ms 数字)');
  assert(/data-tp-input="time" title="ms"/.test(src) && /data-tp-input="timeFmt" title="h:mm:ss\.mmm"/.test(src),
    '编辑态同时出 ms 与时分秒两个输入框');
  assert(/parseMsTime\(e\.target\.value\); if \(ms !== null\) updateTp\(i, \{ time: ms \}\)/.test(src),
    '时分秒输入合法即提交 (parseMsTime)');
  assert(/parseMsTime, /.test(src) || /, parseMsTime/.test(src), '导入 parseMsTime');
  assert(/<col className="w-56" \/>/.test(src), '时间列加宽 w-56 (容纳双输入框)');
}

if (failures) { console.error(`V376 FAILED: ${failures}`); process.exit(1); }
console.log('V376 ALL PASSED');

// 验证器 v372: Timing 窗口对齐 stable F6 反馈批 —
//   1) BPM/SV 输入高精度 (最多 13 位有效小数, PreciseInput 聚焦保留原文);
//   2) 绿线不显示拍号, 红线拍号显示为 n/4;
//   3) 红/绿线型用左侧小圆点区分 (不再文字);
//   4) 音量显示为 n%;
//   5) 音效集+序号合并显示 (S / S:C1 / S:C2);
//   6) 行点击 Ctrl/Shift 文件管理器式多选 (红绿线通用) + 红线批量编辑栏。
// 运行: node verifier/v372/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v372/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v372/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V372_TESTS_*)
fs.unlinkSync(out);

section('TimingPanel.tsx: stable F6 样式');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/function PreciseInput\(/.test(src) && /step="any"/.test(src) && /fmtTpPrec\(value\)/.test(src),
    'PreciseInput: step=any + 13 位精度显示 + 聚焦保留原文');
  assert(/data-tp-dot=\{tp\.uninherited \? 'red' : 'green'\}/.test(src) && /rounded-full/.test(src),
    '线型红/绿小圆点 (不再文字)');
  assert(!/<td className=\{td\}>\{tp\.uninherited \? <span className="text-red-400">/.test(src), 'Type 列文字移除');
  assert(/data-tp-input="meter"[\s\S]{0,80}\/4/.test(src), '红线拍号 n/4 显示');
  assert(!/!tp\.uninherited[\s\S]{0,60}data-tp-input="meter"/.test(src.replace(/<td className={td}>\s*\{tp\.uninherited \? \(/, '<td>{(')), '绿行不渲染 meter 输入');
  assert(/data-tp-sample-code>\{sampleSetCode\(tp\.sampleSet, tp\.sampleIndex\)\}/.test(src), '音效集+序号合并显示');
  assert(/t\('timing\.sample', 'Sample'\)/.test(src) && !/t\('timing\.sample_index', 'Index'\)\}<\/th>/.test(src), '表头合并为 Sample 单列');
  // v374 适配: 音量平时纯文本 n%, 点击才出输入框; 断言编辑控件与文本显示均带 %
  assert(/className=\{`w-12 \$\{inp\}`\} data-tp-input="volume" \/>\s*\n\s*<span className="ml-0\.5 text-white\/40">%<\/span>/.test(src)
    && /\{tp\.volume\}%/.test(src), '行音量 n% 显示 (v374: 平时文本, 点击出输入框)');
}

section('多选: 行点击 + 红线批量栏');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/store\.clickTimingLine\(tp\.time, \{ ctrl: e\.ctrlKey \|\| e\.metaKey, shift: e\.shiftKey \}, visibleTimes\)/.test(src),
    '行点击 → clickTimingLine (Ctrl/Shift)');
  assert(/closest\('input,select,button,label'\)/.test(src), '点在输入控件上不触发多选');
  assert(/const isSel = store\.selectedGreenLines\.has\(tp\.time\);/.test(src), '红绿线行均可高亮选中');
  assert(/data-tp-batch-red/.test(src) && /store\.deleteTimingPointsAt\(selReds/.test(src), '红线批量编辑栏 + 删除');
  assert(/store\.updateTimingPointsAt\(selReds\.map/.test(src), '红线批量修改');
}

section('store.ts: 多选与批量 API');
{
  const src = read('src/osu/store.ts');
  assert(/tpSelAnchor: number \| null = null;/.test(src), 'tpSelAnchor Shift 锚点');
  assert(/clickTimingLine\(time: number/.test(src) && /rangeTimes\(visibleTimes, this\.tpSelAnchor, time\)/.test(src), 'clickTimingLine 走 rangeTimes');
  assert(/updateTimingPointsAt\(times: Iterable<number>/.test(src), 'updateTimingPointsAt (红绿通用)');
  assert(/deleteTimingPointsAt\(times: Iterable<number>/.test(src), 'deleteTimingPointsAt (红绿通用)');
}

section('回归: v157 绿线批量栏结构保留');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/data-tp-batch-input="sampleSet"/.test(src) && /data-tp-batch-input="volume"/.test(src), '绿线批量字段保留');
  assert(/store\.updateGreenLinesAt\(selGreens\.map\(g => g\.time\), patch\)/.test(src), '绿线批量修改沿用 updateGreenLinesAt');
  assert(/data-tp-batch-delete/.test(src) && /store\.deleteGreenLinesAt\(selGreens/.test(src), '绿线删除所选按钮保留');
  assert(/data-tp-select="green"/.test(src) && /store\.toggleGreenLineSelected\(tp\.time\)/.test(src), '绿线行首 checkbox 保留');
}

if (failures) { console.error(`V372 FAILED: ${failures}`); process.exit(1); }
console.log('V372 ALL PASSED');

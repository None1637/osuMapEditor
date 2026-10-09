// 验证器 v374: Timing 行 stable F6 风格点击编辑 (soulten 反馈) —
//   1) 行内所有字段平时只显示纯文本 (BPM/SV 对齐一致, S:C1 不再与下拉框重复);
//   2) 单击单元格文本 (不带 Ctrl/Shift) 切换为编辑控件 (EditCell);
//   3) 失焦移出 / Enter / Escape 关闭回文本; 编辑中点击不冒泡 (不触发行多选);
//   4) 编辑控件仍带原 data-tp-input 属性 (时间/BPM/SV/拍号/音效集/序号/音量/kiai/omitBar)。
// 运行: node verifier/v374/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const src = read('src/components/TimingPanel.tsx');

section('EditCell 组件 (点击编辑)');
{
  assert(/function EditCell\(\{ display, edit, className, dataDisplay \}/.test(src), 'EditCell 组件存在');
  assert(/const \[editing, setEditing\] = useState\(false\);/.test(src), '编辑态 useState');
  assert(/data-tp-display=\{dataDisplay\}/.test(src), '平时文本态 data-tp-display');
  assert(/if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\) return; e\.stopPropagation\(\); setEditing\(true\);/.test(src),
    '单击文本进入编辑 (Ctrl/Shift 让给行多选)');
  assert(/data-tp-editing/.test(src) && /e\.stopPropagation\(\)/.test(src), '编辑态点击不冒泡 (不触发行选择)');
  assert(/if \(!e\.currentTarget\.contains\(e\.relatedTarget as Node\)\) close\(\);/.test(src), '失焦移出关闭');
  assert(/e\.key === 'Enter' \|\| e\.key === 'Escape'/.test(src), 'Enter/Escape 关闭');
}

section('各字段: 平时纯文本 + 点击出编辑控件');
{
  // 时间: 文本 ms + 时分秒, 编辑 number
  // v376 适配: 平时仅显示 h:mm:ss.mmm; 编辑态 ms + 时分秒双输入框
  assert(/dataDisplay="time"\s*\n\s*display=\{<span className="tabular-nums" data-tp-fmt>\{formatMsTime\(tp\.time\)\}<\/span>\}/.test(src)
    && /data-tp-input="time"/.test(src) && /data-tp-input="timeFmt"/.test(src),
    '时间: 平时仅时分秒文本 + 点击出 ms/时分秒双输入框 (v376)');
  // BPM/SV: 文本 fmtTpPrec, 编辑 PreciseInput (autoFocus)
  // v375 适配: 文本显示改 fmtBpm/fmtSv (BPM 3 位 / SV 2 位小数), 编辑态仍 fmtTpPrec
  assert(/dataDisplay=\{tp\.uninherited \? 'bpm' : 'sv'\}/.test(src) && /fmtBpm\(tp\.beatLength\) : fmtSv\(tp\.beatLength\)/.test(src)
    && /<PreciseInput autoFocus value=\{60000 \/ tp\.beatLength\}/.test(src) && /<PreciseInput autoFocus value=\{-100 \/ tp\.beatLength\}/.test(src),
    'BPM/SV: 文本 fmtBpm/fmtSv (v375 定小数位) + 点击出 PreciseInput (对齐一致)');
  // 拍号: 文本 n/4
  assert(/dataDisplay="meter"[\s\S]{0,120}\{tp\.meter\}\/4/.test(src) && /data-tp-input="meter"/.test(src), '拍号: 文本 n/4 + 点击出输入框');
  // 音效集: 平时只有合并文本 S:C1 (下拉/序号只在编辑态)
  assert(/dataDisplay="sample"[\s\S]{0,200}data-tp-sample-code/.test(src), 'Sample: 平时只显示合并文本 (不再与控件重复)');
  const sampleCell = src.match(/dataDisplay="sample"[\s\S]*?edit=\{[\s\S]*?\)\} \/>/);
  assert(!!sampleCell && !/min-w-8/.test(src), 'Sample 文本不再并列常驻下拉框 (旧 min-w-8 并列结构移除)');
  // 音量: 文本 n%
  assert(/dataDisplay="volume"[\s\S]{0,150}\{tp\.volume\}%/.test(src) && /data-tp-input="volume"/.test(src), '音量: 文本 n% + 点击出输入框');
  // 效果: 文本 kiai / Omit Bar Line / —
  assert(/dataDisplay="effects"/.test(src) && /filter\(Boolean\)\.join\(', '\) \|\| '—'/.test(src), '效果: 平时文本 (kiai, Omit Bar Line, —)');
}

section('v374-2: 表格固定宽度 (点击编辑不跳宽)');
{
  assert(/table className="border-collapse mx-auto table-fixed"/.test(src) && /<colgroup>/.test(src)
    && (src.match(/<col className="w-\d+" \/>/g) || []).length === 9,
    'table-fixed + colgroup 9 列固定宽度 (窗口宽度不随点击编辑变化)');
  assert(/const td = 'px-2 py-1 text-center whitespace-nowrap overflow-hidden';/.test(src), 'td 溢出裁剪 (不撑列宽)');
}

section('回归: 多选/删除列不变');
{
  assert(/store\.clickTimingLine\(tp\.time, \{ ctrl: e\.ctrlKey \|\| e\.metaKey, shift: e\.shiftKey \}, visibleTimes\)/.test(src),
    '行点击多选保留 (v372)');
  assert(/data-tp-select="green"/.test(src), '绿线行首 checkbox 保留 (v157)');
  assert(/store\.seek\(tp\.time\)/.test(src), '转到时间轴按钮保留');
}

if (failures) { console.error(`V374 FAILED: ${failures}`); process.exit(1); }
console.log('V374 ALL PASSED');

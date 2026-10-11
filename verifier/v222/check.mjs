// 验证器 v222: 滑条转连打 — 指数参数 (v398 重做: 改为真正的「指数底数」expoBase, 默认 1 = 线性)。
// v398 背景 (soulten): 旧 exponent 是幂指数 (p^exp), 不是底数, 「用起來不像」;
//   新权重 w(ph) = 1 + (k-1) * (B^ph - 1)/(B - 1) — B=1 线性, B>1 前慢后快, 0<B<1 前快后慢。
// StreamDialog.tsx: 间距曲线改「自定义连打间距」勾选框, 勾选后出 指数底数/倍率/重复次数+镜像重复 三项;
//   底数输入框 step 0.01, 写入时四舍五入到两位小数, 附带 同线性/前慢后快/前快后慢 提示。
// 运行: node verifier/v222/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('stream.ts: v398 指数底数模型');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(!/StreamCurve/.test(src), 'v398: StreamCurve 联合类型移除');
  assert(/expoBase: number;.*v398/.test(src), 'StreamParams 含 expoBase 字段 (带 v398 注释)');
  assert(/customSpacing: boolean;.*v398/.test(src), 'StreamParams 含 customSpacing 字段');
  assert(/rampPercent: number;.*v398/.test(src), 'StreamParams 含 rampPercent 字段');
  assert(/repeats: number;.*v398/.test(src) && /mirrorRepeat: boolean;.*v398/.test(src), 'StreamParams 含 repeats/mirrorRepeat 字段');
  assert(/DEFAULT_STREAM_PARAMS[^}]*expoBase: 1/.test(src), '默认参数 expoBase: 1 (= 线性, 可恢复预设)');
  assert(/export function streamSpacingWeight\(/.test(src), '导出 streamSpacingWeight');
  assert(/Math\.abs\(B - 1\) < 1e-9 \? ph : \(Math\.pow\(B, ph\) - 1\) \/ \(B - 1\)/.test(src), '底数形状 = (B^ph-1)/(B-1), B=1 线性');
  assert(/p\.mirrorRepeat && c % 2 === 1/.test(src), '镜像重复: 奇数段相位反向');
  assert(/export function migrateStreamParams/.test(src), '遗留参数迁移函数');
}

section('StreamDialog.tsx: 自定义勾选 + 三项参数');
{
  const src = readSrc('src/components/convert/StreamDialog.tsx');
  const dict = readSrc('src/i18n/dicts/zh-CN/convert.ts');
  assert(!/CURVES/.test(src), 'v398: 曲线下拉框移除');
  assert(/data-conv="custom-spacing"/.test(src), '自定义连打间距勾选框');
  assert(/params\.customSpacing && \([\s\S]{0,400}testid="expo-base"/.test(src), '指数底数行仅勾选自定义时渲染');
  assert(/testid="ramp-percent"/.test(src) && /testid="repeats"/.test(src) && /data-conv="mirror-repeat"/.test(src), '倍率/重复次数/镜像重复控件');
  assert(/step=\{0\.01\}/.test(src), '底数步进 0.01');
  assert(/Math\.round\(Math\.max\(0\.01, Math\.min\(100, v\)\) \* 100\) \/ 100/.test(src), '底数写入钳制 0.01~100 并四舍五入到两位小数');
  assert(/Math\.max\(1, Math\.min\(2000, v\)\)/.test(src), '倍率钳制 1~2000');
  assert(/同线性.*前慢后快.*前快后慢/.test(src.replace(/\s+/g, '')) || /stream_expo_linear/.test(src), '附带底数效果提示文本');
  assert(dict.includes("'convert.stream_custom_spacing': '自定义连打间距'"), '词典: 自定义连打间距');
  assert(dict.includes("'convert.stream_expo_base': '指数底数'"), '词典: 指数底数');
  assert(dict.includes("'convert.stream_ramp_percent': '倍率 %'"), '词典: 倍率 %');
  assert(dict.includes("'convert.stream_repeats': '重复次数'") && dict.includes("'convert.stream_mirror': '镜像重复'"), '词典: 重复次数/镜像重复');
  assert(!/'convert\.curve_expo'/.test(dict) && !/'convert\.stream_end_percent'/.test(dict) && !/'convert\.stream_exponent'/.test(dict), '旧词典键移除');
}

if (failures) { console.error(`V222 FAILED: ${failures}`); process.exit(1); }
console.log('V222 ALL PASSED');

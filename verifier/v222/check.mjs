// 验证器 v222: 滑条转连打 — 指数变化曲线 + 指数参数 (两位小数, 仅选中指数变化时显示)。
// stream.ts: StreamCurve 增 'expo', StreamParams 增 exponent (>0, 默认 2);
//   权重 w(p) = 1 + (k-1) * p^exp — exp=1 同线性, >1 前慢后快, 0<exp<1 前快后慢, exp 钳制 >=0.01。
// StreamDialog.tsx: 间距曲线下拉框增「指数变化」; 指数输入框 (step 0.01, 写入时四舍五入到两位小数)
//   仅 params.curve === 'expo' 时渲染; 附带 同线性/前慢后快/前快后慢 提示。
// 运行: node verifier/v222/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('stream.ts: expo 曲线 + exponent 参数');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/\| 'expo' \|/.test(src), "StreamCurve 联合类型含 'expo'");
  assert(/exponent: number;.*v222/.test(src), 'StreamParams 含 exponent 字段 (带 v222 注释)');
  assert(/DEFAULT_STREAM_PARAMS[^}]*exponent: 2/.test(src), '默认参数 exponent: 2');
  assert(/function weight\(curve: StreamCurve, k: number, p: number, exp = 2\)/.test(src), 'weight() 接收 exp 参数 (默认 2)');
  assert(/case 'expo': return 1 \+ d \* Math\.pow\(p, Math\.max\(0\.01, exp\)\)/.test(src), 'expo 权重 = 1 + d * p^exp, exp 钳制 >=0.01');
  // v230: expo 采样点改段末 (j+1)/(n-1) — 段中点采样高指数全程平坦 ("没效果"反馈); 其他曲线保持段中点
  assert(/weight\(p\.curve, k, p\.curve === 'expo' \? \(j \+ 1\) \/ \(n - 1\) : \(j \+ 0\.5\) \/ \(n - 1\), p\.exponent \?\? 2\)/.test(src), 'streamFractions 传入 p.exponent (缺省兜底 2; v230: expo 段末采样)');
}

section('StreamDialog.tsx: 指数参数输入框, 仅指数变化时显示');
{
  const src = readSrc('src/components/convert/StreamDialog.tsx');
  assert(/\['expo', '指数变化'\]/.test(src), '曲线下拉框含「指数变化」选项');
  assert(/params\.curve === 'expo' && \(/.test(src), '指数输入行仅选中指数变化时渲染');
  assert(/data-conv=\{?["']exponent["']\}?|testid="exponent"/.test(src), '输入框 testid=exponent');
  assert(/step=\{0\.01\}/.test(src), '步进 0.01');
  assert(/Math\.round\(Math\.max\(0\.01, Math\.min\(10, v\)\) \* 100\) \/ 100/.test(src), '写入时钳制 0.01~10 并四舍五入到两位小数');
  assert(/同线性.*前慢后快.*前快后慢/.test(src), '附带指数效果提示文本');
}

if (failures) { console.error(`V222 FAILED: ${failures}`); process.exit(1); }
console.log('V222 ALL PASSED');

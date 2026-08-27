// 验证器 v230 行为测试: expo 段末采样 — 末段间距恰 = endPercent%, 高指数变化集中尾部;
//                        linear/bell 保持段中点采样 (回归数值不变)。
import { streamFractions, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-3) { return Math.abs(a - b) < eps; }

const mk = (patch: Partial<StreamParams>): StreamParams => ({ ...DEFAULT_STREAM_PARAMS, ...patch });
// 用户截图场景: 按数量 4 → 3 个间隔
const times = [0, 1, 2, 3], dur = 3;

section('expo 段末采样: 端点语义 + 高指数集中尾部');
{
  // exp=10, endPercent=5 (k=0.05): 段末 p = 1/3, 2/3, 1
  // w = 1 - 0.95*p^10 ≈ 0.99998, 0.98352, 0.05; sum = 2.0335
  const f = streamFractions(mk({ curve: 'expo', endPercent: 5, exponent: 10 }), times, dur);
  assert(near(f[0], 0) && near(f[3], 1), '首尾固定 0/1');
  assert(near(f[1], 0.4918) && near(f[2], 0.9754), `前段近平坦 (实际 ${f.map(v => v.toFixed(3))})`);
  assert(near(f[3] - f[2], 0.05 / 2.0335), `末段间距恰 = endPercent% 权重 (实际占比 ${(f[3] - f[2]).toFixed(4)})`);
  // 前两段等宽 (高指数下变化全部压到尾段)
  assert(near(f[1] - f[0], f[2] - f[1], 0.01), 'exp=10 时前两段几乎等宽 (平坦后陡降)');
}
{
  // 指数单调性: exp=2 同参数 — 下降更平缓 (末段占比 > exp=10)
  const f2 = streamFractions(mk({ curve: 'expo', endPercent: 5, exponent: 2 }), times, dur);
  // w = 1-0.95*(1/9, 4/9, 1) = 0.8944, 0.5778, 0.05; sum = 1.5222
  assert(near(f2[1], 0.5876) && near(f2[2], 0.9671), `exp=2 平缓下降 (实际 ${f2.map(v => v.toFixed(3))})`);
  assert(f2[3] - f2[2] > 0.0246, 'exp=2 末段占比大于 exp=10 (指数越小越平缓)');
  // exp=1: 段末线性剖面 w = 1-0.95*(1/3, 2/3, 1) = 0.6833, 0.3667, 0.05; sum = 1.1
  const f1 = streamFractions(mk({ curve: 'expo', endPercent: 5, exponent: 1 }), times, dur);
  assert(near(f1[1], 0.6212) && near(f1[2], 0.9545), `exp=1 线性剖面 (实际 ${f1.map(v => v.toFixed(3))})`);
}

section('回归: linear/bell 保持段中点采样');
{
  // linear k=0.5, 中点 p = 1/6, 1/2, 5/6: w = 0.9167, 0.75, 0.5833; sum = 2.25
  const fl = streamFractions(mk({ curve: 'linear', endPercent: 50 }), times, dur);
  assert(near(fl[1], 0.4074) && near(fl[2], 0.7407), `linear 中点采样数值不变 (实际 ${fl.map(v => v.toFixed(3))})`);
  // bell k=0.5, 中点 sin(πp) = 0.5, 1, 0.5: w = 0.75, 0.5, 0.75; sum = 2
  const fb = streamFractions(mk({ curve: 'bell', endPercent: 50 }), times, dur);
  assert(near(fb[1], 0.375) && near(fb[2], 0.625), `bell 中点采样数值不变 (实际 ${fb.map(v => v.toFixed(3))})`);
}

if (failures) { console.error(`\nV230_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV230_TESTS_ALL_PASSED');

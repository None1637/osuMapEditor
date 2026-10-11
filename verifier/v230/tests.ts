// 验证器 v230 行为测试: 段末采样端点语义 — 非镜像时末段间距恰 = 倍率%, 高底数变化集中尾部。
// v398 适配: 参数模型改 自定义间距 + 指数底数 (权重 (B^ph-1)/(B-1)) + 倍率% + 重复/镜像;
//   镜像重复改段中点采样 (保对称), 非镜像保持段末采样。
import { streamFractions, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-3) { return Math.abs(a - b) < eps; }

const mk = (patch: Partial<StreamParams>): StreamParams =>
  ({ ...DEFAULT_STREAM_PARAMS, customSpacing: true, expoBase: 1, rampPercent: 5, repeats: 1, mirrorRepeat: false, ...patch });
// 用户截图场景: 按数量 4 → 3 个间隔
const times = [0, 1, 2, 3], dur = 3;

section('指数底数段末采样: 端点语义 + 高底数集中尾部');
{
  // B=10, 倍率 5% (k=0.05): 段末 p = 1/3, 2/3, 1
  // shape = (10^p-1)/9 ≈ 0.12827, 0.40462, 1; w = 1-0.95*shape ≈ 0.87814, 0.61561, 0.05; sum ≈ 1.54375
  const f = streamFractions(mk({ expoBase: 10 }), times, dur);
  assert(near(f[0], 0) && near(f[3], 1), '首尾固定 0/1');
  assert(near(f[1], 0.5688) && near(f[2], 0.9676), `前段下降后段陡降 (实际 ${f.map(v => v.toFixed(3))})`);
  assert(near(f[3] - f[2], 0.05 / 1.54375), `末段间距恰 = 倍率% 权重 (实际占比 ${(f[3] - f[2]).toFixed(4)})`);
}
{
  // 底数单调性: B=2 同参数 — 下降更平缓 (末段占比 > B=10)
  // shape = 2^p-1 ≈ 0.25992, 0.58740, 1; w ≈ 0.75307, 0.44197, 0.05; sum ≈ 1.24504
  const f2 = streamFractions(mk({ expoBase: 2 }), times, dur);
  assert(near(f2[1], 0.6049) && near(f2[2], 0.9599), `B=2 平缓下降 (实际 ${f2.map(v => v.toFixed(3))})`);
  assert(f2[3] - f2[2] > 0.0324, 'B=2 末段占比大于 B=10 (底数越小越平缓)');
  // B=1: 线性剖面 w = 1-0.95*(1/3, 2/3, 1) = 0.6833, 0.3667, 0.05; sum = 1.1
  const f1 = streamFractions(mk({ expoBase: 1 }), times, dur);
  assert(near(f1[1], 0.6212) && near(f1[2], 0.9545), `B=1 线性剖面 (实际 ${f1.map(v => v.toFixed(3))})`);
}

section('镜像重复: 段中点采样保对称 (bell 形)');
{
  // 重复2+镜像, 倍率 50% (k=0.5), 中点 p = 1/6, 1/2, 5/6 → 相位 1/3, 1(镜像), 1/3(镜像)
  // w = 1-0.5*(1/3, 1, 1/3) = 0.8333, 0.5, 0.8333; sum = 2.1667
  const fb = streamFractions(mk({ rampPercent: 50, repeats: 2, mirrorRepeat: true }), times, dur);
  assert(near(fb[1], 0.3846) && near(fb[2], 0.6154), `bell 形对称分布 (实际 ${fb.map(v => v.toFixed(3))})`);
  const gaps = fb.slice(1).map((v, i) => v - fb[i]);
  assert(near(gaps[0], gaps[2]) && gaps[1] < gaps[0], '两端等宽且中段密 (镜像对称)');
}

section('回归: 固定间距 (不勾自定义) 行为不变');
{
  const fe = streamFractions(mk({ customSpacing: false, mode: 'spacing' }), times, dur);
  assert(fe.join(',') === '0,0.3333333333333333,0.6666666666666666,1', '按间距模式: 位置比例 = 时间比例');
  const fc = streamFractions(mk({ customSpacing: false, mode: 'count' }), times, dur);
  assert(fc.join(',') === '0,0.3333333333333333,0.6666666666666666,1', '按数量模式: 索引均布');
}

if (failures) { console.error(`\nV230_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV230_TESTS_ALL_PASSED');

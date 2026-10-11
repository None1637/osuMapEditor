// 验证器 v398 纯函数测试: 转连打间距曲线重做 — 自定义勾选 / 指数底数 / 倍率 1~2000 / 重复次数+镜像
import { streamSpacingWeight, streamFractions, migrateStreamParams, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const mk = (patch: Partial<StreamParams>): StreamParams =>
  ({ ...DEFAULT_STREAM_PARAMS, customSpacing: true, expoBase: 1, rampPercent: 200, repeats: 1, mirrorRepeat: false, ...patch });

section('streamSpacingWeight: 端点语义与底数形状');
{
  const p = mk({ rampPercent: 200 }); // k=2
  assert(near(streamSpacingWeight(p, 0), 1), '首段恒 100%');
  assert(near(streamSpacingWeight(p, 1), 2), '单次重复末段恒 = 倍率 (200%)');
  // B=1 线性: ph=0.5 -> 1.5
  assert(near(streamSpacingWeight(p, 0.5), 1.5), '底数1 = 线性 (中点 150%)');
  // B>1 前慢后快: 中点 shape < 0.5; B<1 前快后慢: 中点 shape > 0.5
  const slowFast = streamSpacingWeight(mk({ expoBase: 4, rampPercent: 200 }), 0.5);
  const fastSlow = streamSpacingWeight(mk({ expoBase: 0.25, rampPercent: 200 }), 0.5);
  assert(slowFast < 1.5 && slowFast > 1, `B=4 前慢后快 (中点 ${slowFast.toFixed(3)} < 150%)`);
  assert(fastSlow > 1.5 && fastSlow < 2, `B=0.25 前快后慢 (中点 ${fastSlow.toFixed(3)} > 150%)`);
  // 底数→1 极限 = 线性
  assert(near(streamSpacingWeight(mk({ expoBase: 1.001, rampPercent: 200 }), 0.5), 1.5, 1e-3), 'B→1 极限 ≈ 线性');
}

section('重复次数与镜像');
{
  // 重复2 不镜像: 相位 p*2 — p=0.25 → ph=0.5 (线性 150%); p=0.75 → 第二段 ph=0.5 (150%)
  const p2 = mk({ repeats: 2, mirrorRepeat: false });
  assert(near(streamSpacingWeight(p2, 0.25), 1.5) && near(streamSpacingWeight(p2, 0.75), 1.5), '重复2: 两段同向渐变');
  assert(near(streamSpacingWeight(p2, 0.5), 1), '重复2: 段交界处回到 100%');
  // 重复2 镜像: p=0.75 → 第二段镜像 ph=0.5 → 150%; p=0.5 → ph=1 → 200%
  const pm = mk({ repeats: 2, mirrorRepeat: true });
  assert(near(streamSpacingWeight(pm, 0.5), 2), '镜像: 中段 = 倍率峰值');
  assert(near(streamSpacingWeight(pm, 0.25), 1.5) && near(streamSpacingWeight(pm, 0.75), 1.5), '镜像: 左右对称');
  assert(near(streamSpacingWeight(pm, 1), 1), '镜像重复2: 行程末尾回到 100%');
}

section('遗留参数迁移 (v36~v222)');
{
  const lin = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'linear', endPercent: 50 } as StreamParams & { curve: string });
  assert(lin.customSpacing && lin.expoBase === 1 && lin.rampPercent === 50, 'linear → 自定义+底数1+倍率50');
  const expo = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'expo', endPercent: 5, exponent: 10 } as StreamParams & { curve: string });
  assert(expo.customSpacing && expo.expoBase === 10 && expo.rampPercent === 5, 'expo → 底数=旧指数值');
  const eq = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'equal' } as StreamParams & { curve: string });
  assert(!eq.customSpacing, 'equal → 固定间距');
  const fresh = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, customSpacing: true, expoBase: 3 });
  assert(fresh.expoBase === 3 && fresh.customSpacing, '新模型参数原样通过');
}

section('streamFractions: 不勾自定义 = 固定间距');
{
  const times = [0, 1, 2, 3];
  const f = streamFractions(mk({ customSpacing: false, mode: 'count' }), times, 3);
  assert(f.join(',') === '0,0.3333333333333333,0.6666666666666666,1', '不勾自定义: 索引均布 (固定间距)');
}

if (failures) { console.error(`V398_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V398_TESTS_ALL_PASSED');

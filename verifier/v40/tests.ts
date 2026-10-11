// 验证器 v40: 转连打节拍间距/数量=1/曲线简化 纯函数测试
import { streamTimes, streamFractions, computeStream, migrateStreamParams, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 合成谱面: 红线 0/500, SliderMultiplier 1 -> vel = 0.2 px/ms, 1 拍 = 500ms
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
} as unknown as Beatmap;

const slider: HitObject = {
  id: 1, type: 'slider', x: 100, y: 100, time: 2000,
  curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
  hitSound: 0, newCombo: true, comboSkip: 0,
}; // 单程 1000ms

section('间距单位 = 拍 (spacingBeats)');
{
  // 0.5 拍 = 250ms: 0,250,500,750,1000 -> 5 点
  const circles = computeStream(bm, [slider], { ...DEFAULT_STREAM_PARAMS, mode: 'spacing', spacingBeats: 0.5 });
  assert(circles.length === 5, `0.5 拍 -> 5 点 (实际 ${circles.length})`);
  assert(circles.map(c => c.time).join(',') === '2000,2250,2500,2750,3000', `时间 (${circles.map(c => c.time).join(',')})`);
  // 2 拍 = 1000ms: 0,1000 -> 2 点
  const c2 = computeStream(bm, [slider], { ...DEFAULT_STREAM_PARAMS, mode: 'spacing', spacingBeats: 2 });
  assert(c2.length === 2 && c2[1].time === 3000, `2 拍 -> 2 点 (实际 ${c2.length})`);
}

section('数量 = 1 -> 仅滑条头一个 note');
{
  const t = streamTimes(1000, { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 1 }, 300);
  assert(t.length === 1 && t[0] === 0, 'streamTimes count=1 -> [0]');
  const circles = computeStream(bm, [slider], { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 1 });
  assert(circles.length === 1 && circles[0].x === 100 && circles[0].y === 100 && circles[0].time === 2000,
    `仅头部 note (${circles[0]?.x},${circles[0]?.y},${circles[0]?.time})`);
  assert(circles[0].newCombo === true, '头部 note 保留 newCombo');
}

section('曲线: 镜像稀疏 (旧 bellInv) 与遗留值迁移 (v41: 比较空间间距, 时间恒等距; v398 参数模型)');
{
  // v398: bell = 重复2+镜像+倍率50; bellInv = 重复2+镜像+倍率150 (中段最疏); 底数均 1 (线性)
  const gapsOf = (patch: Partial<StreamParams>) => {
    const p: StreamParams = { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5, customSpacing: true, expoBase: 1, repeats: 2, mirrorRepeat: true, ...patch };
    const t = streamTimes(1000, p, 300);
    const f = streamFractions(p, t, 1000);
    return f.slice(1).map((v, i) => v - f[i]);
  };
  const inv = gapsOf({ rampPercent: 150 });
  assert(Math.abs(inv[0] - inv[3]) < 1e-9 && inv[1] > inv[0], `bellInv 对称且中段疏 (${inv.map(g => g.toFixed(3)).join(',')})`);
  const bell = gapsOf({ rampPercent: 50 });
  assert(Math.abs(bell[0] - bell[3]) < 1e-9 && bell[1] < bell[0], `bell 对称且中段密 (${bell.map(g => g.toFixed(3)).join(',')})`);
  // bell 与 bellInv 镜像: 中段 bell 密 bellInv 疏, 边缘相反 (间距是权重倒数, 配对均值非严格互补)
  assert(bell[1] < inv[1] && bell[2] < inv[2], '中段: bell 比 bellInv 密');
  assert(bell[0] > inv[0] && bell[3] > inv[3], '边缘: bell 比 bellInv 疏');
  // v398: 遗留持久化值迁移 — accel/linear → 底数1 单次不镜像
  const legacy = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'accel', endPercent: 50 } as StreamParams & { curve: string });
  assert(legacy.customSpacing && legacy.expoBase === 1 && legacy.rampPercent === 50 && legacy.repeats === 1 && !legacy.mirrorRepeat,
    '遗留曲线值 accel → 线性迁移 (底数1/倍率50/单次)');
  const legacyBell = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'bell', endPercent: 50 } as StreamParams & { curve: string });
  assert(legacyBell.repeats === 2 && legacyBell.mirrorRepeat, '遗留 bell → 重复2+镜像');
  const legacyBellInv = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'bellInv', endPercent: 50 } as StreamParams & { curve: string });
  assert(legacyBellInv.repeats === 2 && legacyBellInv.mirrorRepeat && legacyBellInv.rampPercent === 150, '遗留 bellInv → 倍率 200-50=150 重复2+镜像');
  const legacyEqual = migrateStreamParams({ ...DEFAULT_STREAM_PARAMS, curve: 'equal' } as StreamParams & { curve: string });
  assert(!legacyEqual.customSpacing, '遗留 equal → 固定间距 (不勾自定义)');
  // v41: 变距时时间间隔保持等距
  const p: StreamParams = { ...DEFAULT_STREAM_PARAMS, mode: 'count', count: 5, customSpacing: true, expoBase: 1, rampPercent: 50, repeats: 2, mirrorRepeat: true };
  assert(streamTimes(1000, p, 300).join(',') === '0,250,500,750,1000', '变距曲线下时间仍等距');
}

if (failures) { console.error(`\nV40_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV40_TESTS_PASSED');

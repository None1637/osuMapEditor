// v28 单元断言: 节拍 tick 分级与生成 (stable 节拍时间轴)
import { tickLevel, beatTicks, TICK_COLORS } from '../../src/osu/beatTicks';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// ---- tickLevel: 优先级 小节 > 整拍 > 1/2 > 1/3 > 1/4 > 其他 ----
assert(tickLevel(0, 4) === 'measure', '0 拍 = 小节线');
assert(tickLevel(4, 4) === 'measure', '4/4 第 4 拍 = 下个小节线');
assert(tickLevel(3, 4) === 'beat', '4/4 第 3 拍 = 整拍 (非小节)');
assert(tickLevel(3, 3) === 'measure', '3/4 第 3 拍 = 小节线 (meter 联动)');
assert(tickLevel(0.5, 4) === 'half', '1/2 = half');
assert(tickLevel(1.5, 4) === 'half', '1.5 拍小数部分 0.5 = half');
assert(tickLevel(1 / 3, 4) === 'third', '1/3 = third');
assert(tickLevel(2 / 3, 4) === 'third', '2/3 = third');
assert(tickLevel(0.25, 4) === 'quarter', '1/4 = quarter');
assert(tickLevel(0.75, 4) === 'quarter', '3/4 = quarter');
assert(tickLevel(1 / 6, 4) === 'other', '1/6 = other (黄)');
assert(tickLevel(1 / 16, 4) === 'other', '1/16 = other (黄)');
assert(tickLevel(-4, 4) === 'measure', '负偏移 -4 = 小节线');
assert(tickLevel(-0.5, 4) === 'half', '负偏移 -0.5 = half');

// ---- 配色符合用户规格 ----
assert(TICK_COLORS.measure === '#ffffff' && TICK_COLORS.beat === '#ffffff', '小节/整拍 = 白');
assert(TICK_COLORS.half === '#ff5555', '1/2 = 红');
assert(TICK_COLORS.quarter === '#5588ff', '1/4 = 蓝');
assert(TICK_COLORS.other === '#ffcc33', '1/6+ = 黄');

// ---- beatTicks: 单红线, divisor 4 ----
const TP: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];
{
  const ticks = beatTicks(TP, 1000, 3000, 4);
  assert(ticks.length === 16, `[1000,3000) 4 拍 x 1/4 = 16 tick (实际 ${ticks.length})`);
  assert(ticks[0].time === 1000 && ticks[0].level === 'measure', '首 tick = 红线处小节线');
  assert(ticks[1].time === 1125 && ticks[1].level === 'quarter', '1/4 = 蓝');
  assert(ticks[2].time === 1250 && ticks[2].level === 'half', '2/4 = 红');
  assert(ticks[4].time === 1500 && ticks[4].level === 'beat', '整拍 = 白');
  assert(ticks[8].time === 2000 && ticks[8].level === 'beat', '第 2 拍 = 白 (meter 内)');
}
// 窗口起始于中间: 首个 >= t0 的 tick
{
  const ticks = beatTicks(TP, 1130, 1600, 4);
  assert(ticks[0].time === 1250, '窗口中段起始对齐到下一 tick');
  assert(ticks.length === 3, `[1130,1600) 3 tick (实际 ${ticks.length})`);
}
// ---- 跨 BPM 变化: 两段红线各自细分 ----
const TP2: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
  { time: 2000, beatLength: 375, meter: 3, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];
{
  const ticks = beatTicks(TP2, 1000, 2600, 4);
  const seg1 = ticks.filter(t => t.time < 2000), seg2 = ticks.filter(t => t.time >= 2000);
  assert(seg1.length === 8, `段1 [1000,2000) 2 拍 x 4 = 8 tick (实际 ${seg1.length})`);
  assert(seg2[0].time === 2000 && seg2[0].level === 'measure', '段2 从红线处重新开始 (meter=3 小节线)');
  assert(Math.abs(seg2[1].time - 2093.75) < 1e-6, '段2 step = 375/4 = 93.75');
  assert(seg2.length === 7, `段2 [2000,2600) 7 tick (实际 ${seg2.length})`);
}
// ---- divisor 12: 含全部级别 (白/红/紫/蓝/黄) ----
{
  const ticks = beatTicks(TP, 1000, 2000, 12); // 一拍窗口内不含整拍 tick, 取两拍
  const lv = new Set(ticks.map(t => t.level));
  assert(lv.has('beat') && lv.has('half') && lv.has('third') && lv.has('quarter') && lv.has('other'),
    `divisor 12 覆盖全部级别 (实际 ${[...lv].join(',')})`);
}
// ---- 空 timing 兜底 ----
assert(beatTicks([], 0, 1000, 4).length === 8, '空 timing 用默认 500ms 红线');

if (failures) { console.error(`V28_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('v28 纯函数断言全部通过');

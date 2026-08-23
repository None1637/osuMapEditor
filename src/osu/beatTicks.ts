// 节拍 tick 分级与配色 (对齐 osu!stable 编辑器节拍时间轴)
// 小节线 = 长白线; 1/1 = 短白线; 1/2 = 红; 1/3 = 紫; 1/4 = 蓝; 1/6 及更高 = 黄
import type { TimingPoint } from './parser';

export type TickLevel = 'measure' | 'beat' | 'half' | 'third' | 'quarter' | 'other';

export const TICK_COLORS: Record<TickLevel, string> = {
  measure: '#ffffff',
  beat: '#ffffff',
  half: '#ff5555',
  third: '#bb66ff',
  quarter: '#5588ff',
  other: '#ffcc33',
};

const near = (frac: number, target: number) => Math.abs(frac - target) < 1e-4;

/**
 * 一个 tick 的分级: offsetBeats = 距红线的拍数 (可为小数), meter = 每小节拍数
 * 优先级: 小节线 > 整拍 > 1/2 > 1/3 > 1/4 > 其他 (1/6, 1/8, 1/12, 1/16...)
 */
export function tickLevel(offsetBeats: number, meter: number): TickLevel {
  const frac = ((offsetBeats % 1) + 1) % 1;
  if (frac < 1e-4 || frac > 1 - 1e-4) {
    const beatIndex = Math.round(offsetBeats);
    return ((beatIndex % meter) + meter) % meter === 0 ? 'measure' : 'beat';
  }
  if (near(frac, 1 / 2)) return 'half';
  if (near(frac, 1 / 3) || near(frac, 2 / 3)) return 'third';
  if (near(frac, 1 / 4) || near(frac, 3 / 4)) return 'quarter';
  return 'other';
}

export interface BeatTick {
  /** 时刻 (ms) */
  time: number;
  level: TickLevel;
}

/**
 * 生成 [t0, t1] 窗口内的节拍 tick: 按每段红线各自的 beatLength/meter 细分
 * (跨 BPM 变化时各段独立计算, 与 stable 一致)
 */
export function beatTicks(points: TimingPoint[], t0: number, t1: number, divisor: number): BeatTick[] {
  const reds = points.filter(p => p.uninherited);
  if (!reds.length) reds.push({ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
  const out: BeatTick[] = [];
  for (let i = 0; i < reds.length; i++) {
    const red = reds[i];
    const segEnd = i + 1 < reds.length ? reds[i + 1].time : Infinity;
    const from = Math.max(t0, red.time), to = Math.min(t1, segEnd);
    if (from >= to) continue;
    const step = red.beatLength / divisor;
    // 浮点误差保护: 从首个 >= from 的 tick 开始, 索引取整避免累计误差
    const k0 = Math.ceil((from - red.time) / step - 1e-6);
    for (let k = k0; ; k++) {
      const time = red.time + k * step;
      if (time >= to - 1e-6) break;
      out.push({ time, level: tickLevel(k / divisor, red.meter) });
    }
  }
  return out;
}

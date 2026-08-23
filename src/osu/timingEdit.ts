// Timing 编辑辅助 (v62): 插入默认值 = 克隆当前时间生效的同类点
//   lazer ControlPointList.addNew (ControlPointList.cs:161-184): 当前时间插入, 克隆选中/生效组全部点;
//   Section.CreatePoint (TimingSection.cs:79-89 / EffectSection.cs:87-96): 克隆该时间生效点属性。
// .osu effects 位: bit0 = kiai, bit3 = omit first bar line (lazer TimingControlPoint.OmitFirstBarLine)
import type { TimingPoint } from './parser';

export const EFFECT_KIAI = 1;
export const EFFECT_OMIT_BARLINE = 8;

/** 当前时间生效的同类点 (红/绿) — 生效 = 同类中 time <= t 的最后一条 */
export function effectivePointAt(points: TimingPoint[], time: number, uninherited: boolean): TimingPoint | null {
  let best: TimingPoint | null = null;
  for (const p of points) {
    if (p.uninherited !== uninherited || p.time > time) continue;
    if (!best || p.time > best.time) best = p;
  }
  return best;
}

/**
 * 插入默认值: 克隆当前时间生效的同类点全部字段 (lazer addNew 克隆语义),
 * 无同类点时用格式常规默认 (红 500ms=120BPM / 绿 -100=1.00x, set1 idx0 vol80 fx0)。
 */
export function defaultNewPoint(points: TimingPoint[], time: number, uninherited: boolean): TimingPoint {
  const eff = effectivePointAt(points, time, uninherited);
  if (eff) return { ...eff, time };
  return {
    time, beatLength: uninherited ? 500 : -100, meter: 4,
    sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
  };
}

/** effects 位置位/清位 */
export function setEffectBit(effects: number, bit: number, on: boolean): number {
  return on ? effects | bit : effects & ~bit;
}

/** v70: ms -> "h:mm:ss.mmm" 时分秒显示 (timing 面板时间输入框旁; 负值钳 0) */
export function formatMsTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor(t / 60000) % 60;
  const s = Math.floor(t / 1000) % 60;
  const mmm = t % 1000;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
}

/** v70: 当前时间点生效的绿线 (红线出现后 SV 复位, 与 timingAt 同语义; 无则 null) */
export function activeGreenAt(points: TimingPoint[], time: number): TimingPoint | null {
  let green: TimingPoint | null = null;
  for (const p of points) {
    if (p.time > time) break;
    if (p.uninherited) green = null;
    else green = p;
  }
  return green;
}

/** v71: timing 页签初始滚动目标行 — 生效绿线优先, 否则最近一条 time <= t 的点, 否则首行 (空表返回 -1) */
export function scrollTargetIndex(points: TimingPoint[], time: number): number {
  if (!points.length) return -1;
  const active = activeGreenAt(points, time);
  if (active) return points.indexOf(active);
  let idx = 0;
  for (let i = 0; i < points.length; i++) if (points[i].time <= time) idx = i;
  return idx;
}

/** v156: 当前时间最新生效点 (不限类型; points 按 time 有序; 无则 null) — Timing 菜单「重置/删除当前区间」用 */
export function activePointAt(points: TimingPoint[], time: number): TimingPoint | null {
  let best: TimingPoint | null = null;
  for (const p of points) { if (p.time > time + 1) break; best = p; }
  return best;
}

/** v156: 重新对齐 — time 吸附到 red 线的节拍网格 (snap = 节拍细分, 4 = 1/4 拍) */
export function snapTimeToRedBeat(red: TimingPoint, time: number, snap: number): number {
  const div = red.beatLength / snap;
  return red.time + Math.round((time - red.time) / div) * div;
}

/** v156: 节拍器拍点表 — 每条红线段 [red.time, 下一红线) 逐拍生成; down = 每小节首拍 (按 meter) */
export function metronomeBeats(points: TimingPoint[], songLength: number): { t: number; down: boolean }[] {
  const reds = points.filter(p => p.uninherited);
  const out: { t: number; down: boolean }[] = [];
  for (let i = 0; i < reds.length; i++) {
    const red = reds[i];
    const end = reds[i + 1]?.time ?? songLength;
    const meter = Math.max(1, red.meter);
    for (let k = 0; ; k++) {
      const t = red.time + k * red.beatLength;
      if (t >= end - 1e-6 || out.length > 100000) break;
      out.push({ t, down: k % meter === 0 });
    }
  }
  return out;
}

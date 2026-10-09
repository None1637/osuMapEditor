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

/** v376: 解析 h:mm:ss.mmm (小时与毫秒可省略, 接受 mm:ss.mmm) -> ms; 非法返回 null */
export function parseMsTime(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\s*$/.exec(s);
  if (!m) return null;
  const h = m[1] ? +m[1] : 0, mm = +m[2], ss = +m[3];
  if (mm >= 60 || ss >= 60) return null;
  const ms = m[4] ? +(m[4].padEnd(3, '0')) : 0;
  return h * 3600000 + mm * 60000 + ss * 1000 + ms;
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

/** v372: 音效集+序号合并显示 (stable F6 样式): Soft+0 → S, Soft+1 → S:C1, Soft+2 → S:C2; Normal → N, Drum → D */
export function sampleSetCode(sampleSet: number, sampleIndex: number): string {
  const L = sampleSet === 2 ? 'S' : sampleSet === 3 ? 'D' : 'N';
  return sampleIndex > 0 ? `${L}:C${sampleIndex}` : L;
}

/** v372: Shift 范围选择 — 锚点到目标在可见行序内的全部 time (文件管理器语义; 锚点不可见返回 null) */
export function rangeTimes(visibleTimes: number[], anchor: number, target: number): number[] | null {
  const a = visibleTimes.indexOf(anchor), b = visibleTimes.indexOf(target);
  if (a < 0 || b < 0) return null;
  return visibleTimes.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** v372: BPM/SV 高精度显示 — 13 位有效数字 (stable 输入精度), toPrecision 去尾零防浮点噪声 */
export function fmtTpPrec(v: number): string {
  if (!isFinite(v)) return '0';
  return String(+v.toPrecision(13));
}

/** v375: Timing 行文本显示 — BPM 统一 3 位小数, SV 统一 2 位小数 (编辑态仍走 fmtTpPrec 全精度) */
export function fmtBpm(beatLength: number): string {
  const v = 60000 / beatLength;
  return isFinite(v) ? v.toFixed(3) : '0.000';
}
export function fmtSv(beatLength: number): string {
  const v = -100 / beatLength;
  return isFinite(v) ? v.toFixed(2) : '0.00';
}

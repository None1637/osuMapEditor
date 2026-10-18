// v407: 时间轴 Alt+拖滑条尾 — 增/改绿线 SV 调滑条持续时间 (长度/折返数不变)
// 时长公式 (sliderVelocityAt, parser.ts): duration = length * red.beatLength / (100 * sliderMultiplier * sv) * slides
import { svPointAt, type TimingPoint } from './parser';

/** SV 合法范围 (与 stable 编辑器同口径); 反解结果超出即钳到边界, 等效时长随之钳住 */
export const SV_MIN = 0.1;
export const SV_MAX = 10;

/** 由目标持续时间 (ms) 反解所需 SV 倍率; 非法入参返回 null (调用方跳过本帧) */
export function svForDuration(
  lengthPx: number, slides: number, redBeatLength: number, sliderMultiplier: number, targetDurMs: number,
): number | null {
  const sv = svForDurationRaw(lengthPx, slides, redBeatLength, sliderMultiplier, targetDurMs);
  return sv === null ? null : Math.min(SV_MAX, Math.max(SV_MIN, sv));
}

/** v455: 不钳制的反解版本 — 配合 svRedlineBoost 红线扩程 (超界 SV 用 BPM×2^n 红线等效) */
export function svForDurationRaw(
  lengthPx: number, slides: number, redBeatLength: number, sliderMultiplier: number, targetDurMs: number,
): number | null {
  if (targetDurMs <= 0 || redBeatLength <= 0 || sliderMultiplier <= 0 || lengthPx <= 0 || slides < 1) return null;
  return (lengthPx * slides * redBeatLength) / (100 * sliderMultiplier * targetDurMs);
}

/** v455: 超界 SV 的红线扩程 (editorPrefs.svRedlineBoost 开时由 Alt+拖尾调用) —
 *  svReq 超出 [SV_MIN, SV_MAX] 时, 返回应插红线的 BPM 倍率 redScale (新 red.beatLength = 原值 / redScale,
 *  sv>10 → redScale=2^n 即 BPM×2^n; sv<0.1 → redScale=2^-n 即 BPM÷2^n) 与绿线应设 sv (svReq/redScale),
 *  n 取最小整数使 sv 落回 [SV_MIN, SV_MAX]; 在范围内返回 null (不需要红线)。
 *  等效验证: duration = L·(B0/redScale) / (100·sm·(svReq/redScale)) ·slides = L·B0/(100·sm·svReq)·slides */
export function svRedlineBoost(svReq: number): { redScale: number; sv: number } | null {
  if (svReq >= SV_MIN && svReq <= SV_MAX) return null;
  const n = Math.ceil(Math.log2(svReq > SV_MAX ? svReq / SV_MAX : SV_MIN / svReq));
  const redScale = svReq > SV_MAX ? 2 ** n : 2 ** -n;
  return { redScale, sv: svReq / redScale };
}

/** SV 倍率 → 绿线 beatLength (负值百分比: sv = -100/beatLength) */
export function beatLengthForSv(sv: number): number {
  return -100 / sv;
}

/** 某时刻生效的 SV 倍率 (无绿线/红线重置 = 1; stable 语义, v227) */
export function svAt(points: TimingPoint[], time: number): number {
  const g = svPointAt(points, time);
  return g && g.beatLength < 0 ? -100 / g.beatLength : 1;
}

/** 恰在某时间的绿线 (无则 null) */
export function greenLineAt(points: TimingPoint[], time: number): TimingPoint | null {
  return points.find(p => !p.uninherited && p.time === time) ?? null;
}

/** v454: Alt+拖尾 SV 恢复绿线的插入时刻决策 — 返回后续滑条 (起始时间 > afterTime 的第一条滑条) 的头时刻;
 *  无后续滑条, 或 (afterTime, 后续滑条头] 内已有红/绿线 (都是硬 SV 边界, 红线也重置 SV 见 svPointAt) 时返回 null (不插)。
 *  调用方须先摘除上一帧的恢复线再查 (恢复线本身也在 points 里, 否则会误判为遮挡)。 */
export function svRestoreTargetAt(
  points: TimingPoint[], hitObjects: { type: string; time: number }[], afterTime: number,
): number | null {
  let nextHead = Infinity;
  for (const h of hitObjects) if (h.type === 'slider' && h.time > afterTime && h.time < nextHead) nextHead = h.time;
  if (nextHead === Infinity) return null;
  return points.some(p => p.time > afterTime && p.time <= nextHead) ? null : nextHead;
}

/** v455: 还原红线 (BPM) 的插入时刻决策 — 与 svRestoreTargetAt 同目标 (后续滑条头), 但遮挡只看红线
 *  (BPM 只被红线重置/改变, 绿线挡不住 BPM 泄漏)。无后续滑条或区间内有红线时返回 null。 */
export function bpmRestoreTargetAt(
  points: TimingPoint[], hitObjects: { type: string; time: number }[], afterTime: number,
): number | null {
  let nextHead = Infinity;
  for (const h of hitObjects) if (h.type === 'slider' && h.time > afterTime && h.time < nextHead) nextHead = h.time;
  if (nextHead === Infinity) return null;
  return points.some(p => p.uninherited && p.time > afterTime && p.time <= nextHead) ? null : nextHead;
}

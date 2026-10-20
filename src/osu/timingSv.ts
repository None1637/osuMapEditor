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
 *  调用方须先摘除上一帧的恢复线再查 (恢复线本身也在 points 里, 否则会误判为遮挡)。
 *  v466: 还原红线不再用本决策 (BPM 在 T0 即还原, 见 Timelines.applySvTailDrag) — bpmRestoreTargetAt 已删。 */
export function svRestoreTargetAt(
  points: TimingPoint[], hitObjects: { type: string; time: number }[], afterTime: number,
): number | null {
  let nextHead = Infinity;
  for (const h of hitObjects) if (h.type === 'slider' && h.time > afterTime && h.time < nextHead) nextHead = h.time;
  if (nextHead === Infinity) return null;
  return points.some(p => p.time > afterTime && p.time <= nextHead) ? null : nextHead;
}

// ---- v480: song setup 改基础滑条速度 (sliderMultiplier) 后的绿线 SV 补偿 ----
// 滑条速度 = sliderMultiplier × SV; 倍率 m0 → m1 后全体 SV × f (f = m0/m1) 即保持速度不变。
// stable 语义红线把 SV 重置为 1.0 (svPointAt, parser.ts v227), 故「无绿线覆盖」= 每条红线后
// 到其下一条绿线之前的区间 — 补偿时在红线时刻补插 SV=f 的绿线 (同刻已有绿线则已覆盖, 不插)。
// 超出 0.1~10 的钳到边界并计入 outOfRange (弹窗额外提醒); 不插红线突破上限 (用户明确要求)。
export interface SvCompensationPlan {
  /** SV 缩放系数 (= 旧倍率 / 新倍率) */
  f: number;
  /** 现有绿线: points 下标 + 新 SV (已钳) + 是否越界被钳 */
  greens: { idx: number; newSv: number; clamped: boolean }[];
  /** 待插绿线: 时刻 + SV (已钳) + 是否越界被钳 */
  inserts: { time: number; sv: number; clamped: boolean }[];
  /** 补偿后 SV 超出 0.1~10 的处数 (绿线 + 插入合计) */
  outOfRange: number;
}

const clampSv = (sv: number) => Math.min(SV_MAX, Math.max(SV_MIN, sv));
const svClamped = (sv: number) => sv < SV_MIN - 1e-9 || sv > SV_MAX + 1e-9;

/** 补偿方案 (纯函数, 不改 points): 现有绿线 SV ×f + 无覆盖区间补绿线 */
export function planSvCompensation(points: TimingPoint[], f: number): SvCompensationPlan {
  const greens: SvCompensationPlan['greens'] = [];
  const inserts: SvCompensationPlan['inserts'] = [];
  let outOfRange = 0;
  points.forEach((p, idx) => {
    if (p.uninherited || p.beatLength >= 0) return;
    const raw = (-100 / p.beatLength) * f;
    const cl = svClamped(raw);
    if (cl) outOfRange++;
    greens.push({ idx, newSv: clampSv(raw), clamped: cl });
  });
  // 每条红线 = SV 重置点; 同刻无绿线 → [红线, 下一条绿线) 区间 SV=1.0 无覆盖, 补 SV=f 绿线
  const greenTimes = new Set(points.filter(p => !p.uninherited).map(p => Math.round(p.time)));
  const redTimes = [...new Set(points.filter(p => p.uninherited).map(p => Math.round(p.time)))];
  if (!redTimes.length && points.length) redTimes.push(Math.round(points[0].time)); // 无红线兜底: 开头段
  for (const tr of redTimes) {
    if (greenTimes.has(tr)) continue;
    const cl = svClamped(f);
    if (cl) outOfRange++;
    inserts.push({ time: tr, sv: clampSv(f), clamped: cl });
  }
  return { f, greens, inserts, outOfRange };
}

/** 应用补偿方案 — 返回新数组 (不改传入 points); 插入的绿线拷贝同刻红线的音效字段并排在红线之后
 *  (svPointAt 顺序扫描: 同刻红线先把 SV 重置为 1, 绿线在其后才生效) */
export function applySvCompensation(points: TimingPoint[], plan: SvCompensationPlan): TimingPoint[] {
  const out = points.slice();
  for (const g of plan.greens) out[g.idx] = { ...out[g.idx], beatLength: beatLengthForSv(g.newSv) };
  for (const ins of plan.inserts) {
    const redIdx = out.findIndex(p => p.uninherited && Math.round(p.time) === ins.time);
    const src = redIdx >= 0 ? out[redIdx] : null;
    const np: TimingPoint = {
      time: ins.time, beatLength: beatLengthForSv(ins.sv),
      meter: src?.meter ?? 4, sampleSet: src?.sampleSet ?? 1, sampleIndex: src?.sampleIndex ?? 0,
      volume: src?.volume ?? 100, uninherited: false, effects: 0,
    };
    out.splice(redIdx >= 0 ? redIdx + 1 : 0, 0, np);
  }
  return out;
}

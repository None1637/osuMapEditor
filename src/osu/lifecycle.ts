// 物件生命周期: 结束时间与透明度计算 (纯函数, 可单测)
// 对齐 osu! 行为: 物件结束后 HIT_FADE ms 内淡出, 而不是长挂在游玩区
import type { Beatmap, HitObject, TimingPoint } from './parser';
import { arToPreempt, arToFadeIn, sliderVelocityAt } from './parser';
import { displaySettings } from './displaySettings'; // v132: 显示设置 (滑条渐出 / note 点击特效)

/** 命中/结束后淡出时长 (ms) */
export const HIT_FADE = 240;
/** v147: 关「打击动画」时单点命中后的残留淡化时长 (ms) — osu!stable 编辑器同款: 不放大, 原大小 800ms 渐隐 */
export const HIT_LINGER = 800;

// ---------- v197: 滑条时长 memo ----------
// 痛点: 播放中每帧每个滑条都要问 duration (isVisibleAt/alphaAt/时间轴 objEnd), 而 sliderVelocityAt
// 是 timing 全表双线性扫 (如 4299 物件 × 1447 时间点, 实测占 18% CPU)。memo 键 = 物件引用
// (校验 time/length/slides), 按 timing 内容指纹失效; 指纹每帧最多算一次 (beginLifecycleFrame
// 由 store.tickClock 在每帧渲染前调用 — 任何 timing/物件修改都会触发重绘, 重绘即新帧, 不会读到陈旧值)。
let lifecycleFrame = 0;
/** 每帧渲染循环入口调用 (store.tickClock), 推进 memo 的帧号 */
export function beginLifecycleFrame() { lifecycleFrame++; }

interface TimingMemo { frame: number; fp: number; durs: WeakMap<object, { time: number; len: number; slides: number; dur: number }> }
const timingMemos = new WeakMap<TimingPoint[], TimingMemo>();

function timingFingerprint(points: TimingPoint[], mult: number): number {
  let h = (points.length * 31 + ((mult * 4096) | 0)) | 0;
  for (const p of points) h = (h * 31 + (p.time | 0) + (((p.beatLength * 64) | 0) << 3)) | 0;
  return h;
}

/** 滑条持续时长 (ms), 带帧级 memo; timing 内容/滑条 time/length/slides 变化自动失效 */
export function sliderDurationMemo(points: TimingPoint[], sliderMultiplier: number, o: { time: number; length?: number; slides?: number }): number {
  let m = timingMemos.get(points);
  if (!m || m.frame !== lifecycleFrame) {
    const fp = timingFingerprint(points, sliderMultiplier);
    if (!m || m.fp !== fp) m = { frame: lifecycleFrame, fp, durs: new WeakMap() };
    else m.frame = lifecycleFrame;
    timingMemos.set(points, m);
  }
  const len = o.length ?? 0, slides = o.slides ?? 1;
  const c = m.durs.get(o);
  if (c && c.time === o.time && c.len === len && c.slides === slides) return c.dur;
  const vel = sliderVelocityAt(points, o.time, sliderMultiplier);
  const dur = vel > 0 ? (len / vel) * slides : 0;
  m.durs.set(o, { time: o.time, len, slides, dur });
  return dur;
}

/** v195: 缩圈反弹幅度 (相对 2r 盒子) — 关「打击动画」暂留模式下, 缩圈缩到圈边后向外反弹一点再停住 */
export const APPROACH_BOUNCE = 0.1;

/**
 * v195: 命中后缩圈反弹系数 (纯函数, 可单测)。dt = time - objTime (命中后 ≥0)。
 * 反弹速度 = 缩圈速度 (缩圈 preempt ms 内从 4x 收到 1x, 即每 ms 收 3/preempt 个盒子),
 * 故反弹持续 APPROACH_BOUNCE * preempt / 3 ms, 之后固定在 1 + APPROACH_BOUNCE。
 */
export function approachBounceScale(dt: number, preempt: number): number {
  const dur = (APPROACH_BOUNCE * preempt) / 3;
  const k = dur > 0 ? Math.min(1, dt / dur) : 1;
  return 1 + APPROACH_BOUNCE * Math.max(0, k);
}

/** 物件持续时长 (ms): circle=0, slider=len/vel*slides (v197: 帧级 memo), spinner=endTime-time */
export function hitObjectDuration(bm: Beatmap, o: HitObject): number {
  if (o.type === 'slider') return sliderDurationMemo(bm.timingPoints, bm.difficulty.sliderMultiplier, o);
  if (o.type === 'spinner') return Math.max(0, (o.endTime ?? o.time) - o.time);
  return 0;
}

export function hitObjectEndTime(bm: Beatmap, o: HitObject): number {
  return o.time + hitObjectDuration(bm, o);
}

/**
 * 物件在 time 时刻的透明度:
 *  - preempt 之前 0, fadeIn 区间线性淡入;
 *  - time ~ endTime 全程 1;
 *  - 结束后 HIT_FADE ms 线性淡出到 0 (修复滑条延迟数秒才消失的问题).
 */
export function alphaAt(bm: Beatmap, o: HitObject, time: number): number {
  const preempt = arToPreempt(bm.difficulty.ar);
  const fadeIn = arToFadeIn(bm.difficulty.ar);
  const dt = time - o.time;
  if (dt < -preempt) return 0;
  if (dt < 0) return Math.min(1, (dt + preempt) / fadeIn);
  const end = hitObjectEndTime(bm, o);
  if (time <= end) return 1;
  // v132: 显示设置 — 关「滑条渐出」时滑条结束立即消失; 关「note 点击特效」时单点命中立即消失 (无暂留放大淡出)
  if (!displaySettings.sliderFadeOut && o.type === 'slider') return 0;
  if (!displaySettings.hitExplosion && o.type === 'circle') return 0;
  // v147: 关「打击动画」时单点命中后原大小残留 800ms 线性渐隐 (不放大; stable 编辑器同款)
  if (!displaySettings.hitAnimation && o.type === 'circle') return Math.max(0, 1 - (time - end) / HIT_LINGER);
  return Math.max(0, 1 - (time - end) / HIT_FADE);
}

/** 物件是否处于需要渲染的时间窗口 */
export function isVisibleAt(bm: Beatmap, o: HitObject, time: number): boolean {
  const preempt = arToPreempt(bm.difficulty.ar);
  // v147: 关「打击动画」时单点残留窗口延长到 800ms (否则 240ms 后就被剔除, 看不到残留)
  // v215: 滑条同 — 暂留模式下滑条头/尾圈有独立残留期 (同单点 800ms), 不随滑条身 240ms 淡出被剔除
  const linger = (o.type === 'circle' || o.type === 'slider') && displaySettings.hitExplosion && !displaySettings.hitAnimation ? HIT_LINGER : HIT_FADE;
  return time >= o.time - preempt && time <= hitObjectEndTime(bm, o) + linger;
}

/**
 * 折返箭头 (第 s 个 span 的末端, s=1..slides-1) 在 time 时刻的透明度 (0~1)
 * 对齐 lazer (SliderEndCircle.ApplyDefaultsToSelf + DrawableOsuHitObject.ApplyRepeatFadeIn
 * + DrawableSliderRepeat.SuppressHitAnimations):
 *  - s=1 (RepeatIndex=0): 随滑条淡入, 从 sliderStart-preempt 起 150ms 渐显;
 *  - s>=2 (RepeatIndex>=1): TimePreempt=2*SpanDuration -> 在球经过前一个同侧端点时
 *    (sliderStart+(s-2)*span) 出现, min(span,150)ms 渐显;
 *  - 球到达该端点 (sliderStart+s*span) 后立即隐藏 (编辑器 Arrow.Alpha=0).
 */
export function sliderRepeatAlpha(time: number, sliderStart: number, span: number, preempt: number, s: number): number {
  if (time >= sliderStart + s * span) return 0;
  const appear = s === 1 ? sliderStart - preempt : sliderStart + (s - 2) * span;
  const ramp = s === 1 ? 150 : Math.min(span, 150);
  return Math.max(0, Math.min(1, (time - appear) / ramp));
}

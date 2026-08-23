// Follow points (相邻物件间的连接点): 对齐 lazer
//   osu.Game.Rulesets.Osu/Objects/Drawables/Connections/FollowPointRenderer.cs   (连接对建立/断开条件)
//   osu.Game.Rulesets.Osu/Objects/Drawables/Connections/FollowPointConnection.cs (间距/时刻/动画)
//   osu.Game.Rulesets.Osu/Objects/Drawables/Connections/FollowPointLifetimeEntry.cs (StackedEndPosition)
// 规则:
//  - 连接对 = 时间相邻的两个物件; 后一个是 newCombo 或任一端是转盘则无连接;
//  - 起点 = 前件的堆叠后结束位置 (滑条按折返奇偶取头/尾), 终点 = 后件的堆叠后头部位置;
//  - 点距 SPACING=32, 首点在 1.5*SPACING=48 处, 末点不超过 distance-SPACING;
//  - fadeOutTime = 前件结束时刻 + fraction * 间隔时长; fadeInTime = fadeOutTime - preempt,
//    preempt = 800 * min(1, TimePreempt / 450) (AR<=10 时恒为 800);
//  - 动画 (时长 = 后件 TimeFadeIn): 淡入 0->1, 位置从 fraction-0.1 滑到 fraction, 缩放 1.5->1,
//    fadeOutTime 后同duration淡出。
import type { Beatmap, HitObject } from './parser';
import { arToPreempt, arToFadeIn } from './parser';
import { hitObjectEndTime } from './lifecycle';
import { getSliderPath } from './sliderPath';

export const FP_SPACING = 32;  // FollowPointConnection.SPACING
export const FP_PREEMPT = 800; // FollowPointConnection.PREEMPT
const PREEMPT_MIN = 450;       // OsuHitObject.PREEMPT_MIN

// lazer OsuLegacySkinTransformer: followpoint maxSize = (OBJECT_RADIUS*2, OBJECT_RADIUS)
export const FP_MAX_W = 128;
export const FP_MAX_H = 64;

/** lazer LegacySkinExtensions.WithMaximumSize 语义: 贴图显示尺寸超 maxSize 时**居中裁剪**
 *  (texture.Crop, 逐轴独立取 min, 非等比缩放!); 未超限则原样。
 *  返回源图裁剪矩形 (像素) 与显示尺寸 (osu px, 未乘 end.Scale / 动画缩放)。
 *  等比缩放会把 128x128 帧缩成 64x64, 箭头变窄 -> 视觉上 follow point 间距偏宽 (v48 修复) */
export function followPointCrop(imgW: number, imgH: number, scaleAdjust: number): { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number } {
  const dispW = imgW / scaleAdjust, dispH = imgH / scaleAdjust;
  if (dispW <= FP_MAX_W && dispH <= FP_MAX_H)
    return { sx: 0, sy: 0, sw: imgW, sh: imgH, dw: dispW, dh: dispH };
  const sw = Math.min(imgW, FP_MAX_W * scaleAdjust);
  const sh = Math.min(imgH, FP_MAX_H * scaleAdjust);
  return { sx: imgW / 2 - sw / 2, sy: imgH / 2 - sh / 2, sw, sh, dw: sw / scaleAdjust, dh: sh / scaleAdjust };
}

export interface Pt { x: number; y: number }
type Offsets = Map<number, { dx: number; dy: number }> | null | undefined;

/** 堆叠后结束位置 (lazer StackedEndPosition): 滑条按折返奇偶取路径头/尾, 转盘取中心 */
export function stackedEndPosition(bm: Beatmap, o: HitObject, offsets?: Offsets): Pt {
  let p: Pt;
  if (o.type === 'slider') {
    const path = getSliderPath(bm, o);
    p = path.positionAt((o.slides ?? 1) % 2 === 0 ? 0 : (o.length ?? path.totalLength));
  } else if (o.type === 'spinner') {
    p = { x: 256, y: 192 };
  } else {
    p = { x: o.x, y: o.y };
  }
  const off = offsets?.get(o.id);
  return { x: p.x + (off?.dx ?? 0), y: p.y + (off?.dy ?? 0) };
}

/** 堆叠后头部位置 (lazer StackedPosition) */
export function stackedStartPosition(o: HitObject, offsets?: Offsets): Pt {
  const p = o.type === 'spinner' ? { x: 256, y: 192 } : { x: o.x, y: o.y };
  const off = offsets?.get(o.id);
  return { x: p.x + (off?.dx ?? 0), y: p.y + (off?.dy ?? 0) };
}

/** 相邻连接对 (FollowPointLifetimeEntry.refreshLifetimes: end.NewCombo 或任一端 Spinner -> 无连接) */
export function followPointPairs(bm: Beatmap): { start: HitObject; end: HitObject }[] {
  const out: { start: HitObject; end: HitObject }[] = [];
  const objs = bm.hitObjects;
  for (let i = 0; i < objs.length - 1; i++) {
    const start = objs[i], end = objs[i + 1];
    if (end.newCombo || start.type === 'spinner' || end.type === 'spinner') continue;
    out.push({ start, end });
  }
  return out;
}

/** 单个点的淡入/淡出时刻 (FollowPointConnection.GetFadeTimes) */
export function followPointFadeTimes(startEndTime: number, endStartTime: number, fraction: number, startPreempt: number): { fadeInTime: number; fadeOutTime: number } {
  const duration = endStartTime - startEndTime;
  const preempt = FP_PREEMPT * Math.min(1, startPreempt / PREEMPT_MIN);
  const fadeOutTime = startEndTime + fraction * duration;
  return { fadeInTime: fadeOutTime - preempt, fadeOutTime };
}

// easeOutQuart (lazer Easing.Out 位移/缩放动画)
const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 4);

export interface FollowPointDot {
  x: number; y: number; // 当前时刻位置 (含 fraction-0.1 -> fraction 滑入动画)
  rot: number;          // 指向后一件的角度 (rad)
  alpha: number;        // 0..1
  scale: number;        // 1.5 -> 1 (Easing.Out)
  animStart: number;    // 动画时间基准 = fadeInTime (lazer IAnimationTimeReference.AnimationStartTime)
}

/** 序列帧序号 (lazer SkinnableTextureAnimation: PlaybackPosition = time - AnimationStartTime, 循环播放) */
export function followPointFrameIndex(frameCount: number, frameMs: number, time: number, animStart: number): number {
  const i = Math.floor((time - animStart) / frameMs);
  return ((i % frameCount) + frameCount) % frameCount;
}

/** 当前时刻一对物件间需要绘制的全部 follow point */
export function followPointsBetween(bm: Beatmap, start: HitObject, end: HitObject, time: number, offsets?: Offsets): FollowPointDot[] {
  const sp = stackedEndPosition(bm, start, offsets);
  const ep = stackedStartPosition(end, offsets);
  const dx = ep.x - sp.x, dy = ep.y - sp.y;
  const distance = Math.floor(Math.hypot(dx, dy));
  const rot = Math.atan2(dy, dx);
  const startTime = hitObjectEndTime(bm, start);
  const fadeInDur = arToFadeIn(bm.difficulty.ar); // end.TimeFadeIn
  const preempt = arToPreempt(bm.difficulty.ar);
  const dots: FollowPointDot[] = [];
  for (let d = Math.floor(FP_SPACING * 1.5); d < distance - FP_SPACING; d += FP_SPACING) {
    const fraction = d / distance;
    const { fadeInTime, fadeOutTime } = followPointFadeTimes(startTime, end.time, fraction, preempt);
    if (time < fadeInTime || time > fadeOutTime + fadeInDur) continue;
    const aIn = Math.min(1, Math.max(0, (time - fadeInTime) / fadeInDur));   // FadeIn(fadeInDur)
    const aOut = time <= fadeOutTime ? 1 : 1 - Math.min(1, (time - fadeOutTime) / fadeInDur); // Delay(...).FadeOut(fadeInDur)
    const t = easeOut(aIn);
    const fracNow = fraction - 0.1 + 0.1 * t; // MoveTo(fraction, fadeInDur, Easing.Out), 起点 fraction-0.1
    dots.push({
      x: sp.x + fracNow * dx,
      y: sp.y + fracNow * dy,
      rot,
      alpha: Math.min(aIn, aOut),
      scale: 1.5 - 0.5 * t, // ScaleTo(1, fadeInDur, Easing.Out), 起点 1.5
      animStart: fadeInTime,
    });
  }
  return dots;
}

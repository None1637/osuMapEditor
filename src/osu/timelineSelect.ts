// 上方时间轴框选/边缘滚动/绿线命中 (纯函数, 可单测)
// lazer 语义对齐:
//  - TimelineDragBox.cs: 框选锚定"时间"而非屏幕 x — 滚动时锚边钉在时间上, 选中跨滚动累积
//  - TimelineBlueprintContainer.handleScrollViaDrag: 边缘容差 40px,
//    速度 = sign * min(10, overshootPx^2), 5 秒线性 ramp (time_ramp_multiplier=5000) 达满速
import type { TimingPoint } from './parser';

export const EDGE_TOLERANCE_PX = 40;
export const EDGE_MAX_VELOCITY = 10;
export const EDGE_RAMP_MS = 5000;

/**
 * 边缘滚动基础速度 (内容 px/ms 系数, lazer handleScrollViaDrag 的 amount 项, 不含 ramp):
 * 指针在距左右边缘 40px 容差内 => 0; 超出部分平方曲线 capped 10 (overshoot ≥√10≈3.2px 即满速)。
 * 调用方: 速度非 0 时累计 dragMs, dMs = velocity * edgeScrollRamp(dragMs) * dtMs * (win / width)。
 */
export function edgeScrollVelocity(pointerX: number, width: number): number {
  let amount = 0;
  if (pointerX > width - EDGE_TOLERANCE_PX) amount = pointerX - (width - EDGE_TOLERANCE_PX);
  else if (pointerX < EDGE_TOLERANCE_PX) amount = pointerX - EDGE_TOLERANCE_PX;
  if (amount === 0) return 0;
  return Math.sign(amount) * Math.min(EDGE_MAX_VELOCITY, Math.pow(Math.min(Math.abs(amount), EDGE_TOLERANCE_PX), 2));
}

/** 边缘滚动 ramp (lazer time_ramp_multiplier=5000: 按住 5 秒线性到满速; 速度归 0 时调用方清零 dragMs) */
export function edgeScrollRamp(dragMs: number): number {
  return Math.min(1, dragMs / EDGE_RAMP_MS);
}

/** 框选命中物件 id: 物件时长区间 [time, end] 与 [msA, msB] 相交 (v45 语义; 时间锚定后跨滚动累积) */
export function marqueeObjectIds<O extends { id: number; time: number }>(
  objects: O[], endOf: (o: O) => number, msA: number, msB: number,
): number[] {
  return objects.filter(o => endOf(o) >= msA && o.time <= msB).map(o => o.id);
}

/** 框选命中绿线时刻: 绿线 (非红线) 时刻落在 [msA, msB] (含端点) */
export function marqueeGreenTimes(points: TimingPoint[], msA: number, msB: number): number[] {
  return points.filter(tp => !tp.uninherited && tp.time >= msA && tp.time <= msB).map(tp => tp.time);
}

/** 绿线 SV 药丸纵带 (与 Timelines.tsx 绘制一致: py=76.5, 高 13) */
export const GREEN_PILL_TOP = 76.5;
export const PILL_HEIGHT = 13;

/** 矩形纵跨 [ya, yb] 是否与纵带 [top, top+h] 相交 */
export function bandHit(ya: number, yb: number, top: number, h = PILL_HEIGHT): boolean {
  return Math.min(ya, yb) <= top + h && Math.max(ya, yb) >= top;
}

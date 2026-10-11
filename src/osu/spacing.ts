// 选中物件的坐标与前后间距信息 (右上角面板用, 纯函数可单测)
// v397: 间距倍率的 1x 基准固定 = 1.0x 锁定间距 (100 * SliderMultiplier * SV * 间隔拍数, 不含当前 DS 设置) —
//   面板显示的 前/后位置距离不再随间距控制 (DistanceSpacing) 变化 (soulten 反馈);
//   放置用的锁定间距 (distanceLockDistance) 仍含 DS, 互不影响。
// v149: 与当前 SV 挂钩 (lazer EditorBeatmap.DurationToDistance: 参考时刻 = 前件结束时刻)
import type { Beatmap, HitObject } from './parser';
import { timingAt, svPointAt } from './parser';
import { hitObjectEndTime } from './lifecycle';
import { stackedEndPosition, stackedStartPosition } from './followPoints';
import { getSliderPath } from './sliderPath';

/** v149: 锁定间距 1x 的每拍像素 = DS * 100 * SliderMultiplier * SV(refTime) (lazer DurationToDistance 同源; 放置用, 含 DS) */
function distanceSnapPxPerBeat(bm: Beatmap, refTime: number): number {
  const green = svPointAt(bm.timingPoints, refTime);
  const sv = green && green.beatLength < 0 ? -100 / green.beatLength : 1;
  return bm.editor.distanceSpacing * 100 * bm.difficulty.sliderMultiplier * sv;
}

/** 像素距离 -> 间距倍率; v397: 基准固定 1.0x (= 100 * SM * SV * 间隔拍数, 不含 DS 设置);
 *  间隔拍数 <= 0 (重叠/同时) 时无意义, 返回 null */
export function spacingMultiplier(bm: Beatmap, fromEndTime: number, toTime: number, distPx: number): number | null {
  const { red } = timingAt(bm.timingPoints, toTime);
  const beats = (toTime - fromEndTime) / red.beatLength;
  if (beats <= 0) return null;
  const green = svPointAt(bm.timingPoints, fromEndTime); // v149: SV 参考时刻 = 前件结束时刻
  const sv = green && green.beatLength < 0 ? -100 / green.beatLength : 1;
  return distPx / (100 * bm.difficulty.sliderMultiplier * sv * beats);
}

export interface SelectionSpacingInfo {
  x: number; y: number;      // 选中第一个物件 (按时间) 的坐标
  prev: number | null;       // 前一件结束位置 -> 首件头部 的间距倍率 (无前件/同刻为 null)
  prevPx: number | null;     // 同上, 原始 osu 像素距离 (v55)
  next: number | null;       // 末件结束位置 -> 后一件头部 的间距倍率
  nextPx: number | null;     // 同上, 原始 osu 像素距离 (v55)
}

/** 当前选区的坐标/前后间距 (前/后物件取时间相邻的非选中物件) */
export function selectionSpacingInfo(bm: Beatmap, selected: Set<number>): SelectionSpacingInfo | null {
  if (!selected.size) return null;
  const objs = bm.hitObjects; // 已按时间排序
  const selIdx: number[] = [];
  for (let i = 0; i < objs.length; i++) if (selected.has(objs[i].id)) selIdx.push(i);
  if (!selIdx.length) return null;
  const first = objs[selIdx[0]], last = objs[selIdx[selIdx.length - 1]];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  let prev: number | null = null, prevPx: number | null = null;
  for (let i = selIdx[0] - 1; i >= 0; i--) {
    if (selected.has(objs[i].id)) continue;
    const p = objs[i];
    const d = dist(stackedEndPosition(bm, p), stackedStartPosition(first));
    prev = spacingMultiplier(bm, hitObjectEndTime(bm, p), first.time, d);
    prevPx = Math.round(d);
    break;
  }
  let next: number | null = null, nextPx: number | null = null;
  for (let i = selIdx[selIdx.length - 1] + 1; i < objs.length; i++) {
    if (selected.has(objs[i].id)) continue;
    const n: HitObject = objs[i];
    const d = dist(stackedEndPosition(bm, last), stackedStartPosition(n));
    next = spacingMultiplier(bm, hitObjectEndTime(bm, last), n.time, d);
    nextPx = Math.round(d);
    break;
  }
  return { x: Math.round(first.x), y: Math.round(first.y), prev, prevPx, next, nextPx };
}

// ---- v145: 锁定间距共享纯函数 (EditorCanvas 放置/拖动/指示线 + SelectionInfoPanel 放置预览同源) ----

export interface DistanceLockRef { endX: number; endY: number; endTime: number }

/** 锁定间距参考件: 从后往前找第一个 结束时刻 <= time+1 且不在 exclude 中的物件;
 *  结束位置滑条按折返奇偶取路径头/尾 (未堆叠坐标, 与 EditorCanvas 原放置逻辑一致) */
export function distanceLockRef(bm: Beatmap, time: number, exclude?: ReadonlySet<number>): DistanceLockRef | null {
  for (let i = bm.hitObjects.length - 1; i >= 0; i--) {
    const o = bm.hitObjects[i];
    if (exclude?.has(o.id)) continue;
    const endTime = hitObjectEndTime(bm, o);
    if (endTime > time + 1) continue;
    if (o.type === 'slider') {
      const path = getSliderPath(bm, o);
      const pos = path.positionAt((o.slides ?? 1) % 2 === 0 ? 0 : (o.length ?? path.totalLength));
      return { endX: pos.x, endY: pos.y, endTime };
    }
    return { endX: o.x, endY: o.y, endTime };
  }
  return null;
}

/** 锁定间距期望距离 (px): DS * 100 * SliderMultiplier * SV * 间隔拍数;
 *  v211: 拍数下限 0.25 → 0 (对齐 lazer CircularDistanceSnapGrid.GetSnappedPosition fixedTime 分支:
 *  DurationToDistance(gap) 无下限 — 间隔 <0.25 拍按比例缩小, 间隔 0 = 叠在前件末端);
 *  v149: 参考时刻 = 前件结束时刻 (lazer EditorBeatmap.DurationToDistance: TimingPoint/DifficultyPoint 均取 referenceTime) */
export function distanceLockDistance(bm: Beatmap, endTime: number, time: number): number {
  const { red } = timingAt(bm.timingPoints, endTime);
  const beats = Math.max(0, (time - endTime) / red.beatLength);
  return distanceSnapPxPerBeat(bm, endTime) * beats;
}

/** 放置预览间距信息 (间距面板用): 在 time 放置于 p 时, 与锁定间距参考件结束位置的间距倍率/像素距离 */
export function previewSpacingInfo(bm: Beatmap, p: { x: number; y: number }, time: number): { x: number; y: number; prev: number | null; prevPx: number | null } {
  const ref = distanceLockRef(bm, time);
  if (!ref) return { x: Math.round(p.x), y: Math.round(p.y), prev: null, prevPx: null };
  const d = Math.hypot(p.x - ref.endX, p.y - ref.endY);
  return { x: Math.round(p.x), y: Math.round(p.y), prev: spacingMultiplier(bm, ref.endTime, time, d), prevPx: Math.round(d) };
}

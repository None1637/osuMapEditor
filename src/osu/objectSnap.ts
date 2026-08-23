// 放置/拖动物件吸附到附近物件 (v55): 对齐 lazer
//   osu.Game.Rulesets.Osu/Edit/OsuHitObjectComposer.cs:242 TrySnapToNearbyObjects / :297 snapToVisibleBlueprints
//   osu.Game.Rulesets/Edit/SelectionBlueprint.cs:141 ScreenSpaceSnapPoints (中心 + 附加节点)
// 规则:
//  - 阈值 = OsuHitObject.OBJECT_RADIUS(64) * 0.10 = 6.4 osu px (严格小于);
//  - 目标点 = 当前可见 (lazer alive blueprints) 且未选中物件的: 位置 (未堆叠, lazer 去 StackOffset) + 滑条尾端;
//  - 优先级: 物件吸附 > 距离吸附 (锁定间距), lazer 无开关始终启用, 无视觉指示 (预览直接跳到目标)。
import type { Beatmap, HitObject } from './parser';
import { getSliderPath } from './sliderPath';

/** lazer OsuHitObject.OBJECT_RADIUS * 0.10f (osu 游玩区 px) */
export const OBJECT_SNAP_RADIUS = 6.4;

export interface Pt { x: number; y: number }

/** 滑条尾端位置 (未堆叠; 偶数折返尾在头, 与 EditorCanvas.snapPlacement 的 prevEnd 同公式) */
export function sliderTailPoint(bm: Beatmap, o: HitObject): Pt {
  const path = getSliderPath(bm, o);
  return path.positionAt((o.slides ?? 1) % 2 === 0 ? 0 : (o.length ?? path.totalLength));
}

/** 物件吸附目标点集合 (lazer ScreenSpaceSnapPoints): 每个物件的位置 + 滑条尾端 */
export function objectSnapPoints(bm: Beatmap, objs: HitObject[]): Pt[] {
  const out: Pt[] = [];
  for (const o of objs) {
    out.push({ x: o.x, y: o.y });
    if (o.type === 'slider') out.push(sliderTailPoint(bm, o));
  }
  return out;
}

/** 最近目标点距离 < 6.4 则吸附 (严格小于, lazer Distance < snapRadius); 命中返回目标点, 否则 null */
export function snapToNearby(p: Pt, targets: Pt[]): Pt | null {
  let best: Pt | null = null, bestD = OBJECT_SNAP_RADIUS;
  for (const t of targets) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * 拖拽吸附 (lazer OsuBlueprintContainer.checkSnappingBlueprintToNearbyObjects):
 * 被拖物件各吸附点 + 当前位移 得到候选位置, 取全体 (拖动点, 目标) 对中距离最近且 < 6.4 的一对,
 * 返回使该对重合的修正后位移; 无命中返回 null。
 */
export function snapDragDelta(dragPts: Pt[], targets: Pt[], dx: number, dy: number): { dx: number; dy: number } | null {
  let best: { dx: number; dy: number } | null = null, bestD = OBJECT_SNAP_RADIUS;
  for (const p of dragPts) {
    const cx = p.x + dx, cy = p.y + dy;
    for (const t of targets) {
      const d = Math.hypot(t.x - cx, t.y - cy);
      if (d < bestD) { bestD = d; best = { dx: t.x - p.x, dy: t.y - p.y }; }
    }
  }
  return best;
}

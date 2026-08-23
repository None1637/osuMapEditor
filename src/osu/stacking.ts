// 物件堆叠 (stacking): 移植 lazer OsuBeatmapProcessor.applyStacking (BeatmapVersion>=6 新算法, 对应 stable v14 谱面)
// 依据: osu/osu.Game.Rulesets.Osu/Beatmaps/OsuBeatmapProcessor.cs
//  - STACK_DISTANCE = 3 (osu px): 时间窗内位置接近的物件构成堆叠
//  - stackThreshold = (int)preempt * stackLeniency (ms); HitCircle 分支时间比较用 (int) 截断对齐 stable
//  - StackHeight 为 int, 可为负 (滑条末端下方的负堆叠特例); 反向扫描中时间越早的物件 StackHeight 越大
//  - 显示偏移 StackOffset = StackHeight * scale * -6.4 同施于 x/y (scale = r/64) => 每轴 = StackHeight * r * -0.1
import type { Beatmap, HitObject, Vec2 } from './parser';
import { arToPreempt, csToRadius, sliderVelocityAt } from './parser';
import { getSliderPath } from './sliderPath';

export const STACK_DISTANCE = 3;

/** 物件结束时间: circle=time, slider=time+duration (length/velocity*slides), spinner=endTime */
function endTimeOf(bm: Beatmap, o: HitObject): number {
  if (o.type === 'slider') {
    const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
    return o.time + ((o.length ?? 0) / vel) * (o.slides ?? 1);
  }
  if (o.type === 'spinner') return o.endTime ?? o.time;
  return o.time;
}

/** 物件末端位置: slider = 曲线几何末端 (不考虑折返), 其他 = 自身位置 */
function endPositionOf(bm: Beatmap, o: HitObject): Vec2 {
  if (o.type === 'slider') {
    const p = getSliderPath(bm, o);
    return p.positionAt(o.length ?? p.totalLength);
  }
  return { x: o.x, y: o.y };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 计算全谱 StackHeight: 返回 Map<物件 id, StackHeight> (0 不进 Map)
 */
export function computeStackHeights(bm: Beatmap): Map<number, number> {
  const objs = bm.hitObjects;
  const count = objs.length;
  const heights = new Array<number>(count).fill(0);
  if (!count) return new Map();

  // lazer calculateStackThreshold: (int)TimePreempt * StackLeniency (顶层物件 preempt 恒为整数)
  const stackThreshold = Math.floor(arToPreempt(bm.difficulty.ar)) * bm.general.stackLeniency;
  const endTimes = objs.map(o => endTimeOf(bm, o));
  const positions = objs.map(o => ({ x: o.x, y: o.y }));
  const endPositions = objs.map(o => endPositionOf(bm, o));

  applyStacking(objs, heights, endTimes, positions, endPositions, stackThreshold, 0, count - 1);

  const out = new Map<number, number>();
  for (let i = 0; i < count; i++) if (heights[i] !== 0) out.set(objs[i].id, heights[i]);
  return out;
}

/** lazer applyStacking 逐行移植 (startIndex/endIndex 为更新范围; 全谱调用时扩展扫描不触发) */
function applyStacking(
  objs: HitObject[], heights: number[], endTimes: number[], positions: Vec2[], endPositions: Vec2[],
  stackThreshold: number, startIndex: number, endIndex: number,
) {
  let extendedEndIndex = endIndex;

  if (endIndex < objs.length - 1) {
    // 扩展扫描: 正向把堆叠链延伸到范围外, 链上物件 StackHeight 重置为 0
    for (let i = endIndex; i >= startIndex; i--) {
      let stackBaseIndex = i;

      for (let n = stackBaseIndex + 1; n < objs.length; n++) {
        if (objs[stackBaseIndex].type === 'spinner') break;
        if (objs[n].type === 'spinner') continue;

        if (objs[n].time - endTimes[stackBaseIndex] > stackThreshold) break;

        if (dist(positions[stackBaseIndex], positions[n]) < STACK_DISTANCE
          || (objs[stackBaseIndex].type === 'slider' && dist(endPositions[stackBaseIndex], positions[n]) < STACK_DISTANCE)) {
          stackBaseIndex = n;
          heights[n] = 0; // 更新范围外的物件尚未重置
        }
      }

      if (stackBaseIndex > extendedEndIndex) {
        extendedEndIndex = stackBaseIndex;
        if (extendedEndIndex === objs.length - 1) break;
      }
    }
  }

  // 反向主循环: 计算每个物件的 StackHeight
  let extendedStartIndex = startIndex;

  for (let i = extendedEndIndex; i > startIndex; i--) {
    let n = i;
    // 已有 stack 值的物件跳过 (交缠堆叠场景: 见 lazer 注释的 1/2/3/4 例)
    if (heights[i] !== 0 || objs[i].type === 'spinner') continue;

    let objectI = i;

    if (objs[objectI].type === 'circle') {
      // HitCircle 分支: 向上找同位置前物件, 逐个 StackHeight+1 (时间早的堆得高、往左上让)
      while (--n >= 0) {
        if (objs[n].type === 'spinner') continue;

        // (int) 截断对齐 stable (lazer 注释: 对齐 osu-stable-reference HitObjectManager.cs#L1725)
        if (Math.trunc(objs[objectI].time) - Math.trunc(endTimes[n]) > stackThreshold) break;

        if (n < extendedStartIndex) {
          heights[n] = 0;
          extendedStartIndex = n;
        }

        // 负堆叠特例: 堆叠样式中最末滑条下方的 hitcircle 往下/右移 (StackHeight 为负)
        if (objs[n].type === 'slider' && dist(endPositions[n], positions[objectI]) < STACK_DISTANCE) {
          const offset = heights[objectI] - heights[n] + 1;
          for (let j = n + 1; j <= i; j++) {
            if (dist(endPositions[n], positions[j]) < STACK_DISTANCE) heights[j] -= offset;
          }
          // 碰到滑条: 以其为新 base 重新计算 (滑条本身 StackHeight 仍为 0, 由外层 i 循环处理)
          break;
        }

        if (dist(positions[n], positions[objectI]) < STACK_DISTANCE) {
          heights[n] = heights[objectI] + 1;
          objectI = n;
        }
      }
    } else if (objs[objectI].type === 'slider') {
      // Slider 分支: 从该滑条起 ALWAYS 正向堆叠 (前物件 EndPosition 距本滑条头 <3 则 +1)
      while (--n >= startIndex) {
        if (objs[n].type === 'spinner') continue;

        if (objs[objectI].time - objs[n].time > stackThreshold) break;

        if (dist(endPositions[n], positions[objectI]) < STACK_DISTANCE) {
          heights[n] = heights[objectI] + 1;
          objectI = n;
        }
      }
    }
  }
}

/**
 * StackHeight -> 显示偏移 (osu px): 每轴 = StackHeight * r * -0.1
 * (lazer OsuHitObject.StackOffset = StackHeight * scale * -6.4, scale = r/64)
 */
export function computeStackOffsets(bm: Beatmap): Map<number, { dx: number; dy: number }> {
  const heights = computeStackHeights(bm);
  const r = csToRadius(bm.difficulty.cs);
  const out = new Map<number, { dx: number; dy: number }>();
  for (const [id, h] of heights) {
    const d = h * r * -0.1;
    out.set(id, { dx: d, dy: d });
  }
  return out;
}

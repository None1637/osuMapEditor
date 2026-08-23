// v154: 重叠物件命中挑选 — 点击处同时命中多个物件时, 优先选中离当前时间最近者
import type { HitObject } from './parser';

/**
 * 从命中列表中挑选应选中的物件: |o.time - currentTime| 最小者;
 * 时间差相同取数组靠后者 (= 绘制顺序更上层, 与旧"倒序首个命中"在同刻堆叠时的行为一致)。
 * hits 为空返回 null。
 */
export function pickTimeNearestHit<T extends Pick<HitObject, 'time'>>(hits: T[], currentTime: number): T | null {
  let best: T | null = null;
  let bestDt = Infinity;
  for (const h of hits) {
    const dt = Math.abs(h.time - currentTime);
    if (dt <= bestDt) { best = h; bestDt = dt; } // <=: 同差值后者优先 (上层物件)
  }
  return best;
}

// v416–v419: 测试游玩 HUD 纯函数助手 (无 React/DOM 依赖, verifier tests.ts 直测)
//  - v416: 光标拖尾轨迹 (记录/修剪/透明度)
//  - v417: 背景图 cover 适配矩形
//  - v418: 歌曲进度 (首物件→末物件结束, 钳 [0,1])
//  - v419: 跳过按钮显示条件与 seek 目标

/** v416: 拖尾轨迹点 (osu 坐标 + 采样时刻 ms) */
export interface TrailPoint { x: number; y: number; t: number }

/** v416: 拖尾保留时长 (ms) — 最近 ~120ms 的轨迹参与渲染 */
export const TRAIL_MS = 120;

/**
 * v416: 记录光标位置并修剪过期点 (原地修改 trail)。
 * 按住击打键时逐帧采样 (拖尾更密, stable 行为); 未按住 8ms 节流省点。
 */
export function updateTrail(trail: TrailPoint[], x: number, y: number, time: number, held: boolean) {
  const last = trail[trail.length - 1];
  if (!last || held || time - last.t >= 8) trail.push({ x, y, t: time });
  while (trail.length && time - trail[0].t > TRAIL_MS) trail.shift();
}

/** v416: 拖尾精灵透明度 — 沿轨迹逐渐淡出; 按住时更不透明 (stable 行为) */
export function trailAlpha(t: number, time: number, held: boolean): number {
  const k = Math.max(0, Math.min(1, (time - t) / TRAIL_MS));
  return (1 - k) * (held ? 0.8 : 0.45);
}

/** v416: 拖尾精灵缩放 — 沿轨迹逐渐缩小 (末端 30%) */
export function trailScale(t: number, time: number): number {
  const k = Math.max(0, Math.min(1, (time - t) / TRAIL_MS));
  return 1 - k * 0.7;
}

/** v417: cover 适配 — 图片按比例铺满 boxW×boxH 并居中, 返回绘制矩形 (osu 坐标) */
export function coverRect(imgW: number, imgH: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** v418: 歌曲进度 (currentTime 相对 首物件→末物件结束), 钳 [0,1]; 无效区间返回 0 */
export function playProgress(time: number, firstTime: number, lastEnd: number): number {
  if (lastEnd <= firstTime) return 0;
  return Math.max(0, Math.min(1, (time - firstTime) / (lastEnd - firstTime)));
}

/** v419: 跳过按钮显示条件 — 当前时间在首个物件前且距离 >3000ms */
export function canSkip(time: number, firstTime: number): boolean {
  return time < firstTime - 3000;
}

/** v419: 跳过目标 — 首物件前 2000ms */
export function skipTarget(firstTime: number): number {
  return firstTime - 2000;
}

/** v420: hit lighting 泛光时长 (ms) — lazer/stable 命中后 ~240ms 放大淡出 */
export const HIT_LIGHTING_MS = 240;

/** v420: 泛光状态 — age 为距命中 ms; null = 不绘制; 放大淡出 (scale 1→1.8, alpha 1→0) */
export function hitLightingState(age: number): { alpha: number; scale: number } | null {
  if (age < 0 || age > HIT_LIGHTING_MS) return null;
  const k = age / HIT_LIGHTING_MS;
  return { alpha: 1 - k, scale: 1 + 0.8 * k };
}

/** v421: combo 弹跳时长 (ms) — lazer ComboCounter pop 效果 (瞬时 ~1.6x, 缓动回 1.0) */
export const COMBO_POP_MS = 180;

/** v421: combo 弹跳缩放 — age 为距 combo 增加 ms; ease-out 平方回 1.0 */
export function comboPopScale(age: number): number {
  if (age < 0 || age > COMBO_POP_MS) return 1;
  const k = age / COMBO_POP_MS;
  return 1 + 0.6 * (1 - k) * (1 - k);
}

/**
 * v422: 被动 HP drain 速率 (血量/ms) = hpDrainRate × 0.018 / s — 需求给定参考量纲。
 * 取舍注明: lazer DrainingHealthProcessor 实为按谱面二元搜索自适应速率
 * (目标最低血 HP0≈99% / HP5≈90% / HP10≈40%, 永不因 drain 单独掉空判负),
 * 此处按指定量纲实现 (HP5 ≈ 0.09/s), 比 lazer 激进但简单, 测试游玩不判负, 可接受。
 */
export function hpDrainPerMs(hp: number): number {
  return hp * 0.018 / 1000;
}

/** v423: break 休息段 (ms) */
export interface BreakSpan { start: number; end: number }

/** v423: 解析 [Events] 原文行的 break 段 (2,start,end / Break,start,end; 非法/倒置丢弃) */
export function parseBreaks(events?: string[]): BreakSpan[] {
  const out: BreakSpan[] = [];
  for (const l of events ?? []) {
    const m = l.match(/^\s*(?:2|Break)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i);
    if (!m) continue;
    const start = +m[1], end = +m[2];
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** v423: time 所在 break 段 (无 → null) */
export function breakAt(breaks: BreakSpan[], time: number): BreakSpan | null {
  for (const b of breaks) if (time >= b.start && time <= b.end) return b;
  return null;
}

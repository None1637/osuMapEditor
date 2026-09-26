// v64: 多边形生成 — 移植 lazer PolygonGenerationPopover.tryCreatePolygon
// (osu.Game.Rulesets.Osu/Edit/PolygonGenerationPopover.cs:140-215)
// 圆心固定游玩区中心 (256,192), 全部生成 HitCircle, 顶点 3-32 / 圈数 1-10 / 起始角 0-180° / DS 0.1-6
import type { Beatmap, HitObject, TimingPoint } from '../parser';
import { genId, timingAt, snapAcrossRedLine } from '../parser';

export interface PolygonParams {
  vertices: number;     // 顶点数 3-32
  repeats: number;      // 圈数 1-10
  offsetAngle: number;  // 起始角 0-180 (度)
  distanceSnap: number; // 间距倍率 0.1-6 (= 锁定间距的 1x 同单位)
  newCombo: boolean;    // 首个物件 newCombo (lazer 绑定选区 NC 状态)
}
export const DEFAULT_POLYGON_PARAMS: PolygonParams = { vertices: 3, repeats: 1, offsetAngle: 0, distanceSnap: 1, newCombo: false };
export const POLYGON_LIMITS = {
  vertices: [3, 32] as const,
  repeats: [1, 10] as const,
  offsetAngle: [0, 180] as const,
  distanceSnap: [0.1, 6] as const,
};

/** 吸附到最近节拍网格 (lazer IBeatSnapProvider.SnapTime: 当前红线 beatLength/divisor 网格, 四舍五入) */
export function snapBeatTime(points: TimingPoint[], divisor: number, time: number): number {
  const { red } = timingAt(points, time);
  const step = red.beatLength / divisor;
  if (!(step > 0)) return Math.max(0, time);
  const snapped = Math.max(0, red.time + Math.round((time - red.time) / step) * step);
  return snapAcrossRedLine(points, time, snapped); // v285: lazer 跨红线就近规则
}

/**
 * 最近一条 endTime <= time 的滑条在自身时间的 SV 倍率 (lazer: lastWithSliderVelocity.SliderVelocityMultiplier; 无滑条则 1)。
 * lazer 用 GetPrecisionAdjustedBeatLength 的 bpmMultiplier clamp(1/sv, 0.1, 100) => 等效 sv clamp 到 [0.01, 10]。
 */
function lastSliderSv(bm: Beatmap, time: number): number {
  let last: HitObject | null = null;
  for (const o of bm.hitObjects) {
    if (o.type !== 'slider') continue;
    const end = o.endTime ?? o.time;
    if (end > time + 1e-6) continue;
    if (!last || (last.endTime ?? last.time) < end) last = o;
  }
  if (!last) return 1;
  const { green } = timingAt(bm.timingPoints, last.time);
  const sv = green && green.beatLength < 0 ? -100 / green.beatLength : 1;
  return Math.min(10, Math.max(0.01, sv));
}

export interface PolygonResult { objects: HitObject[]; outOfBounds: boolean; startTime: number; }

/**
 * 生成多边形单点串 (纯函数; 不碰谱面数据 — 预览/应用由调用方决定)。
 * 弦长 = DS × velocity × timeSpacing; velocity = 100×SM×sv/beatLength (lazer BASE_SCORING_DISTANCE×SliderMultiplier/精度调整 beatLength);
 * 半径 R = 弦长 / (2·sin(π/顶点数)); 角 θᵢ = 起始角 + (i+1)·2π/顶点数; 时间从吸附点按 timeSpacing 逐点吸附推进。
 * 任一顶点出游玩区 [0,512]×[0,384] => outOfBounds (lazer: 禁用创建按钮并清空预览)。
 */
export function computePolygon(bm: Beatmap, currentTime: number, divisor: number, p: PolygonParams): PolygonResult {
  let t = snapBeatTime(bm.timingPoints, divisor, currentTime);
  const { red } = timingAt(bm.timingPoints, t);
  const timeSpacing = red.beatLength / divisor;
  const sm = bm.difficulty?.sliderMultiplier ?? 1.4;
  const velocity = (100 * sm * lastSliderSv(bm, t)) / red.beatLength; // px/ms
  const chord = p.distanceSnap * velocity * timeSpacing;
  const radius = chord / (2 * Math.sin(Math.PI / p.vertices));
  const total = Math.round(p.vertices) * Math.round(p.repeats);
  const objects: HitObject[] = [];
  for (let i = 0; i < total; i++) {
    const angle = (p.offsetAngle * Math.PI) / 180 + (i + 1) * ((2 * Math.PI) / p.vertices);
    const x = 256 + radius * Math.cos(angle);
    const y = 192 + radius * Math.sin(angle);
    if (x < 0 || y < 0 || x > 512 || y > 384) return { objects: [], outOfBounds: true, startTime: t };
    objects.push({
      id: genId(), type: 'circle', x: Math.round(x), y: Math.round(y), time: Math.round(t),
      newCombo: i === 0 && p.newCombo, comboSkip: 0, hitSound: 0,
    });
    t = snapBeatTime(bm.timingPoints, divisor, t + timeSpacing);
  }
  return { objects, outOfBounds: false, startTime: Math.round(snapBeatTime(bm.timingPoints, divisor, currentTime)) };
}

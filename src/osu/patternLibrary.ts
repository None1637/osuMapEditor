// v86: Pattern 库 — 收藏选中物件为可复用 pattern, 拖到游玩区落盘
// 语义 (参考 osu_mapping_tools PatternGallery + 用户确认规格):
//  - 时序按节拍数记录 (beatTimeAt/msAtBeat 跨变 BPM 逐物件展开, 对齐 mapping tools ScaleToNewTiming)
//  - 位置存相对首物件偏移; 放置时首物件跟随鼠标 (吸附由调用方处理)
//  - 只存 hitObjects (位置/时间/曲线/hitsound/newCombo), 不存红绿线本体; SV 只记"收藏时等效 SV" (px/beat)
//  - 放置对齐二选一 (互斥): 插绿线对齐 SV (开头插/结尾还原) | 几何缩放滑条保占拍数; 都不勾 = 原样复制
import { genId, timingAt, svPointAt, type Beatmap, type HitObject, type TimingPoint } from './parser';

export interface PatternObject {
  type: 'circle' | 'slider' | 'spinner';
  beatOffset: number;             // 距 pattern 起点的节拍数
  dx: number; dy: number;         // 相对首物件位置
  hitSound: number; newCombo: boolean; comboSkip: number;
  hitSampleRaw?: string; edgeSoundsRaw?: string; edgeSetsRaw?: string;
  // slider
  curveType?: string;
  curvePoints?: { x: number; y: number }[]; // 相对滑条头
  slides?: number;
  beatsLen?: number;              // 占拍数 (收藏时按当时 timing 换算, 跨变 BPM 保真)
  pixelLength?: number;
  svPxPerBeat?: number;           // 该滑条头部时间处等效 SV
  // spinner
  beatsDuration?: number;         // 占拍数
}

export interface StoredPattern {
  id: string;
  name: string;
  group: string;                  // 分类, 默认 DEFAULT_GROUP
  createdAt: number;
  svPxPerBeat: number;            // 首物件时间处等效 SV (px/beat) — 插绿线对齐用
  /** pattern 覆盖时间段内的绿线 (SV 变化): beatOffset 拍 + sv 倍率 (无则空/缺省) */
  greenlines?: { beatOffset: number; sv: number }[];
  objects: PatternObject[];
}

export const DEFAULT_GROUP = '未分类';

// ---- 节拍 <-> ms 换算 (多红线分段; 锚点: 第一条红线处 beat=0, 两函数互为逆) ----

const redLines = (points: TimingPoint[]): TimingPoint[] =>
  points.filter(p => p.uninherited).sort((a, b) => a.time - b.time);

/** ms -> 拍 (相对第一条红线; 变 BPM 分段积分, mapping tools Timing.GetBeatLength 同款) */
export function beatTimeAt(points: TimingPoint[], ms: number): number {
  const reds = redLines(points);
  if (!reds.length) return ms / 500;
  let beat = 0;
  for (let i = 0; i < reds.length; i++) {
    const t0 = reds[i].time, t1 = i + 1 < reds.length ? reds[i + 1].time : Infinity;
    if (ms < t0) return beat + (ms - t0) / reds[i].beatLength; // 首红线前 (负拍)
    if (ms <= t1) return beat + (ms - t0) / reds[i].beatLength;
    beat += (t1 - t0) / reds[i].beatLength;
  }
  return beat;
}

/** 拍 -> ms (beatTimeAt 的逆; 锚点相同) */
export function msAtBeat(points: TimingPoint[], beat: number): number {
  const reds = redLines(points);
  if (!reds.length) return beat * 500;
  let b = beat;
  for (let i = 0; i < reds.length; i++) {
    const t0 = reds[i].time, t1 = i + 1 < reds.length ? reds[i + 1].time : Infinity;
    const span = (t1 - t0) / reds[i].beatLength;
    if (b <= span || t1 === Infinity) return t0 + b * reds[i].beatLength;
    b -= span;
  }
  return reds[reds.length - 1].time;
}

/** 等效滑条速度 px/beat = 100 * sliderMultiplier * 绿线sv */
export function pxPerBeatAt(points: TimingPoint[], sliderMultiplier: number, time: number): number {
  const green = svPointAt(points, time); // v227: SV 被红线重置 (stable 语义)
  const sv = green && green.beatLength < 0 ? -100 / green.beatLength : 1;
  return 100 * sliderMultiplier * sv;
}

/** 时间处生效的绿线 sv 倍率 (无绿线 = 1) */
export function svAt(points: TimingPoint[], time: number): number {
  const green = svPointAt(points, time); // v227: SV 被红线重置 (stable 语义)
  return green && green.beatLength < 0 ? -100 / green.beatLength : 1;
}

// ---- 收藏: 选中物件 -> pattern ----

export function makePattern(id: string, name: string, bm: Beatmap, objects: HitObject[], group: string = DEFAULT_GROUP): StoredPattern {
  const sorted = [...objects].sort((a, b) => a.time - b.time || a.id - b.id);
  const first = sorted[0];
  const tps = bm.timingPoints, mult = bm.difficulty.sliderMultiplier;
  const startBeat = beatTimeAt(tps, first.time);
  const objects0: PatternObject[] = sorted.map(o => {
    const base: PatternObject = {
      type: o.type,
      beatOffset: beatTimeAt(tps, o.time) - startBeat,
      dx: o.x - first.x, dy: o.y - first.y,
      hitSound: o.hitSound ?? 0, newCombo: o.newCombo ?? false, comboSkip: o.comboSkip ?? 0,
      hitSampleRaw: o.hitSampleRaw, edgeSoundsRaw: o.edgeSoundsRaw, edgeSetsRaw: o.edgeSetsRaw,
    };
    if (o.type === 'slider') {
      base.curveType = o.curveType;
      base.curvePoints = (o.curvePoints ?? []).map(p => ({ x: p.x - o.x, y: p.y - o.y }));
      base.slides = o.slides ?? 1;
      base.pixelLength = o.length ?? 0;
      base.svPxPerBeat = pxPerBeatAt(tps, mult, o.time);
      const endMs = Math.round(o.time + (o.length ?? 0) / (base.svPxPerBeat / (timingAt(tps, o.time).red.beatLength)) * (o.slides ?? 1));
      base.beatsLen = beatTimeAt(tps, endMs) - beatTimeAt(tps, o.time);
    } else if (o.type === 'spinner') {
      base.beatsDuration = beatTimeAt(tps, o.endTime ?? o.time) - beatTimeAt(tps, o.time);
    }
    return base;
  });
  // pattern 覆盖时间段内的绿线一并记录 (v87: 否则含绿线滑条的 pattern 放置后 SV/长度错误)
  const p0: StoredPattern = {
    id, name, group, createdAt: Date.now(),
    svPxPerBeat: pxPerBeatAt(tps, mult, first.time),
    objects: objects0,
  };
  const endMs = Math.round(msAtBeat(tps, startBeat + patternBeats(p0)));
  p0.greenlines = tps
    .filter(t => !t.uninherited && t.beatLength < 0 && t.time >= first.time && t.time <= endMs)
    .map(t => ({ beatOffset: beatTimeAt(tps, t.time) - startBeat, sv: -100 / t.beatLength }));
  return p0;
}

// ---- 放置: pattern -> 实际物件 (+ 可选绿线) ----

export interface InstantiateOptions {
  greenlineAlign: boolean; // 插绿线对齐 SV (开头插, 结尾还原)
  scaleAlign: boolean;     // 几何缩放滑条保占拍数
}

export interface InstantiateResult {
  objects: HitObject[];
  greenlines: TimingPoint[]; // greenlineAlign 时两条 (开头对齐 + 结尾还原), 否则空
}

const clampSv = (sv: number) => Math.min(10, Math.max(0.1, sv));

/** pattern 最后一拍 (物件 beatOffset + 时长 的最大值) */
export function patternBeats(p: StoredPattern): number {
  let max = 0;
  for (const o of p.objects) {
    const end = o.beatOffset + (o.type === 'slider' ? (o.beatsLen ?? 0) : o.type === 'spinner' ? (o.beatsDuration ?? 0) : 0);
    if (end > max) max = end;
  }
  return max;
}

export function instantiatePattern(
  p: StoredPattern, bm: Beatmap, pos: { x: number; y: number }, startMs: number, opts: InstantiateOptions,
): InstantiateResult {
  const tps = bm.timingPoints, mult = bm.difficulty.sliderMultiplier;
  const startBeat = beatTimeAt(tps, startMs);
  const mkGreen = (time: number, sv: number): TimingPoint => {
    const { red } = timingAt(tps, time);
    return { time, beatLength: -100 / clampSv(sv), meter: red.meter, sampleSet: red.sampleSet, sampleIndex: red.sampleIndex, volume: red.volume, uninherited: false, effects: 0 };
  };
  // v87: 两种对齐模式都插入 pattern 内部绿线 (sv 为相对倍率, 原样保留);
  // 缩放对齐的等效速度需把内部绿线算进去, 否则含绿线滑条缩放错误
  const withAlign = opts.greenlineAlign || opts.scaleAlign;
  const innerGreens: TimingPoint[] = withAlign
    ? (p.greenlines ?? []).map(g => mkGreen(Math.round(msAtBeat(tps, startBeat + g.beatOffset)), g.sv))
    : [];
  const tpsEff = opts.scaleAlign && innerGreens.length
    ? [...tps, ...innerGreens].sort((a, b) => a.time - b.time)
    : tps;
  const objects: HitObject[] = p.objects.map(po => {
    const time = Math.round(msAtBeat(tps, startBeat + po.beatOffset));
    const o: HitObject = {
      id: genId(), type: po.type,
      x: Math.round(pos.x + po.dx), y: Math.round(pos.y + po.dy),
      time, hitSound: po.hitSound, newCombo: po.newCombo, comboSkip: po.comboSkip,
      hitSampleRaw: po.hitSampleRaw, edgeSoundsRaw: po.edgeSoundsRaw, edgeSetsRaw: po.edgeSetsRaw,
    };
    if (po.type === 'slider') {
      o.curveType = po.curveType;
      o.slides = po.slides ?? 1;
      let scale = 1;
      if (opts.scaleAlign && po.pixelLength && po.beatsLen) {
        // 目标: 占拍数不变 => 新像素长度 = 占拍数 * 落点时间处 px/beat (含 pattern 内部绿线)
        scale = (po.beatsLen * pxPerBeatAt(tpsEff, mult, time)) / po.pixelLength;
      }
      o.curvePoints = (po.curvePoints ?? []).map(pt => ({
        x: Math.round(o.x + pt.x * scale), y: Math.round(o.y + pt.y * scale),
      }));
      o.length = Math.round((po.pixelLength ?? 0) * scale * 100) / 100;
    } else if (po.type === 'spinner') {
      o.endTime = Math.round(msAtBeat(tps, startBeat + po.beatOffset + (po.beatsDuration ?? 0)));
    }
    return o;
  });
  const greenlines: TimingPoint[] = [...innerGreens];
  if (opts.greenlineAlign) {
    // 开头: sv 改成收藏时等效值 (排序后压过同时间的内部绿线); 结尾: 还原为该处原本生效的 sv (无绿线则 sv=1)
    const svNeeded = clampSv(p.svPxPerBeat / (100 * mult));
    const endMs = Math.round(msAtBeat(tps, startBeat + patternBeats(p)));
    greenlines.push(mkGreen(Math.round(startMs), svNeeded), mkGreen(endMs, svAt(tps, endMs)));
  }
  return { objects, greenlines };
}

// ---- 持久化 (localStorage, 全局跨谱面) ----

const LS_PATTERNS = 'osu-editor:patterns';
const LS_GROUPS = 'osu-editor:pattern-groups';

export function loadPatterns(): StoredPattern[] {
  try {
    const raw = localStorage.getItem(LS_PATTERNS);
    if (raw) return JSON.parse(raw) as StoredPattern[];
  } catch { /* 损坏回退空 */ }
  return [];
}
export function savePatterns(list: StoredPattern[]) {
  try { localStorage.setItem(LS_PATTERNS, JSON.stringify(list)); } catch { /* 配额满忽略 */ }
}
export function loadPatternGroups(): string[] {
  try {
    const raw = localStorage.getItem(LS_GROUPS);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* 损坏回退空 */ }
  return [];
}
export function savePatternGroups(list: string[]) {
  try { localStorage.setItem(LS_GROUPS, JSON.stringify(list)); } catch { /* 配额满忽略 */ }
}

export function newPatternId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// hitsound 采样解析与文件名解析 (纯函数, 可单测)
// 采样文件命名: {set}-{sound}{index?}.wav|mp3|ogg, 如 soft-hitnormal.wav / drum-hitfinish2.wav
// set: normal(1) / soft(2) / drum(3); 无对应文件时保持静音 (不再使用合成占位音)

export type HitSoundId = 'hitnormal' | 'hitwhistle' | 'hitclap' | 'hitfinish';

export const HIT_SOUND_IDS: HitSoundId[] = ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap'];

/** 匹配谱面目录里的 hitsound 采样文件 (捕获: set, sound, index) */
export const SAMPLE_FILE_RE = /^(normal|soft|drum)-(hitnormal|hitwhistle|hitfinish|hitclap|slidertick|sliderslide)(\d*)\.(wav|mp3|ogg)$/i;

/** hitSound 位标志 -> 需要播放的音效 id 列表 (bit0 是 hitnormal 本身) */
export function soundsForHitSound(hitSound: number): HitSoundId[] {
  const out: HitSoundId[] = ['hitnormal'];
  if (hitSound & 2) out.push('hitwhistle');
  if (hitSound & 4) out.push('hitfinish');
  if (hitSound & 8) out.push('hitclap');
  return out;
}

export interface HitSample {
  /** 0 = 继承 timing point */
  normalSet: number;
  additionSet: number;
  /** 自定义采样序号, 0/1 = 无后缀 */
  customIndex: number;
  /** 0 = 默认音量 */
  volume: number;
}

/** 解析物件末尾 hitSample 段 "normalSet:additionSet:customIndex:volume:filename" */
export function parseHitSample(raw: string | undefined): HitSample {
  const d: HitSample = { normalSet: 0, additionSet: 0, customIndex: 0, volume: 0 };
  if (!raw) return d;
  const p = raw.split(':');
  d.normalSet = parseInt(p[0] ?? '0') || 0;
  d.additionSet = parseInt(p[1] ?? '0') || 0;
  d.customIndex = parseInt(p[2] ?? '0') || 0;
  d.volume = parseInt(p[3] ?? '0') || 0;
  return d;
}

/** 取 hitSampleRaw 第 5 段 filename (无则 undefined) */
export function hitSampleFilename(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const f = raw.split(':')[4];
  return f ? f : undefined;
}

/** 生成 hitSample 段 "normalSet:additionSet:customIndex:volume:filename"; 全默认且无 filename 时返回 undefined (序列化省略该字段) */
export function buildHitSampleRaw(hs: HitSample, filename?: string): string | undefined {
  if (!filename && !hs.normalSet && !hs.additionSet && !hs.customIndex && !hs.volume) return undefined;
  return `${hs.normalSet}:${hs.additionSet}:${hs.customIndex}:${hs.volume}:${filename ?? ''}`;
}

/** sampleSet 数字 <-> 文件名前缀 */
export function setName(n: number): 'normal' | 'soft' | 'drum' {
  return n === 3 ? 'drum' : n === 2 ? 'soft' : 'normal';
}

/** [General] SampleSet 字符串 -> 数字 */
export function setNumFromGeneral(s: string): number {
  const v = s.toLowerCase();
  return v === 'drum' ? 3 : v === 'soft' ? 2 : 1;
}

/**
 * 采样文件 stem 候选列表 (按优先级):
 * 带自定义序号 -> 无序号; 找不到对应 buffer 时由调用方继续 fallback (默认采样 -> 静音)
 */
export function stemCandidates(soundId: string, setNum: number, customIndex: number): string[] {
  const base = `${setName(setNum)}-${soundId}`;
  return customIndex > 1 ? [`${base}${customIndex}`, base] : [base];
}

/** osu! 经典默认 hitsound (随 app 分发于 public/samples/, 谱面无自定义采样时回退使用) */
export const DEFAULT_SAMPLE_STEMS: string[] =
  ['normal', 'soft', 'drum'].flatMap(s => HIT_SOUND_IDS.map(x => `${s}-${x}`));

/** 默认滑条采样 (slidertick 节拍点 / sliderslide 循环) */
export const DEFAULT_SLIDER_STEMS: string[] =
  ['normal', 'soft', 'drum'].flatMap(s => ['slidertick', 'sliderslide'].map(x => `${s}-${x}`));

// ---------- 滑条音效规划 (头/边缘 repeat 音 / slidertick / sliderslide) ----------
// 参照 lazer: SliderEventGenerator(距离制 tick) + ConvertHitObjectParser(节点采样继承)
// 音量规则 (lazer SampleControlPoint.ApplyTo): hitSample.volume > 0 ? hitSample.volume : timing point volume
// 注意 stable/lazer 对滑条 hitSample 只取 bank (banksOnly), 节点音量一律取节点时刻的 timing point volume
import { sliderVelocityAt, timingAt, type Beatmap, type HitObject, type TimingPoint } from '../parser';

/** lazer DrawableHitObject.MINIMUM_SAMPLE_VOLUME: 采样音量下限 5% */
export const MIN_SAMPLE_VOLUME = 5;

export function clampVolume(v: number): number {
  return Math.min(100, Math.max(MIN_SAMPLE_VOLUME, Math.round(v)));
}

/** 某时刻生效的 sample control point volume (绿线优先, 否则红线) */
export function sampleVolumeAt(points: TimingPoint[], timeMs: number): number {
  const tp = timingAt(points, timeMs);
  return (tp.green ?? tp.red).volume;
}

/** 非滑条物件音量: hitSample.volume 覆盖, 0 时用 timing point volume */
export function objectVolume(points: TimingPoint[], timeMs: number, hitSampleVolume: number): number {
  return clampVolume(hitSampleVolume > 0 ? hitSampleVolume : sampleVolumeAt(points, timeMs));
}

export interface PlannedSound {
  timeMs: number;
  soundId: string;
  fallbacks: string[];
  /** 0-100, 已解析 (含 5% 下限); 播放时 gain = volume/100 */
  volume: number;
}

export interface SliderSoundPlan {
  /** 头节点音效 (edgeSounds[0] 可覆盖物件 hitSound) */
  head: PlannedSound[];
  /** 每个 span 终点 (repeat/尾端) 的边缘音效, k=1..slides */
  edges: PlannedSound[];
  /** 滑条身体上的节拍点 (slidertick, 距离制) */
  ticks: PlannedSound[];
  /** sliderslide 循环区间 */
  slide: { startMs: number; endMs: number; soundId: string; fallbacks: string[]; volume: number } | null;
}

/** 解析滑条全程音效: 时间点 + 采样 stem + 音量 (set 继承/序号回退/距离制 tick) */
export function planSliderSounds(bm: Beatmap, o: HitObject): SliderSoundPlan {
  const empty: SliderSoundPlan = { head: [], edges: [], ticks: [], slide: null };
  if (o.type !== 'slider') return empty;
  const slides = o.slides ?? 1;
  const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier); // px/ms
  if (vel <= 0 || !(o.length! > 0)) return empty;
  const span = (o.length ?? 0) / vel; // 单 span 时长 ms (legacy: 全程用起点处速度)

  const defSet = setNumFromGeneral(bm.general.sampleSet);
  const hs = parseHitSample(o.hitSampleRaw);
  const tp = timingAt(bm.timingPoints, o.time);
  const tpSet = (tp.green ?? tp.red).sampleSet || defSet;
  const objNormal = hs.normalSet || tpSet;
  const objAddition = hs.additionSet || objNormal;

  // 每端点 hitSound 位标志 ("0|2|0") 与 set 组 ("0:0|1:0|0:0"); 缺省继承物件
  const edgeSounds = o.edgeSoundsRaw?.split('|').map(s => parseInt(s) || 0);
  const edgeSets = o.edgeSetsRaw?.split('|').map(seg => {
    const [n, a] = seg.split(':');
    return { n: parseInt(n ?? '0') || 0, a: parseInt(a ?? '0') || 0 };
  });

  // 节点音效: stable/lazer 对滑条 hitSample 只取 bank, 音量取节点时刻 timing point volume
  const nodeSounds = (k: number, timeMs: number): PlannedSound[] => {
    const bits = edgeSounds?.[k] ?? (o.hitSound ?? 0);
    const sets = edgeSets?.[k];
    const normal = sets?.n || objNormal;
    const addition = sets?.a || objAddition;
    const volume = clampVolume(sampleVolumeAt(bm.timingPoints, timeMs));
    const out: PlannedSound[] = [];
    for (const sid of soundsForHitSound(bits)) {
      const set = sid === 'hitnormal' ? normal : addition;
      const cands = stemCandidates(sid, set, hs.customIndex);
      out.push({ timeMs, soundId: cands[0], fallbacks: cands.slice(1), volume });
    }
    return out;
  };

  const head = nodeSounds(0, o.time);
  const edges: PlannedSound[] = [];
  for (let k = 1; k <= slides; k++) edges.push(...nodeSounds(k, o.time + k * span));

  // slidertick: 距离制几何与渲染共用 sliderTickPoints
  const startVolume = clampVolume(sampleVolumeAt(bm.timingPoints, o.time));
  const tickCands = stemCandidates('slidertick', objNormal, 0);
  const ticks: PlannedSound[] = sliderTickPoints(bm, o).map(t => ({
    timeMs: t.timeMs, soundId: tickCands[0], fallbacks: tickCands.slice(1), volume: startVolume,
  }));

  const slide: SliderSoundPlan['slide'] = slides * span > 0
    ? {
      startMs: o.time, endMs: o.time + slides * span,
      soundId: stemCandidates('sliderslide', objNormal, 0)[0], fallbacks: [],
      volume: startVolume,
    }
    : null;

  return { head, edges, ticks, slide };
}

// ---------- 滑条 tick 几何 (音效与渲染共用) ----------
export interface SliderTickPoint {
  /** 沿路径的进度 0..1 (正方向, 与 span 方向无关) */
  progress: number;
  /** 实际发生时刻 (含 span 方向) */
  timeMs: number;
  /** v204: 所属 span 序号 (渲染端 tick 出现时机按 lazer SliderTick 公式需要) */
  spanIndex: number;
}

/**
 * lazer SliderEventGenerator 距离制 tick 排布:
 * scoringDistance = velocity × beatLength; tickDistance = scoringDistance / tickRate;
 * 距端点 velocity×10ms 等效距离内不排; 反向 span 时刻镜像
 */
export function sliderTickPoints(bm: Beatmap, o: HitObject): SliderTickPoint[] {
  if (o.type !== 'slider') return [];
  const slides = o.slides ?? 1;
  const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
  const pathLen = o.length ?? 0;
  if (vel <= 0 || !(pathLen > 0)) return [];
  const span = pathLen / vel;
  const tp = timingAt(bm.timingPoints, o.time);
  const tickRate = Math.max(0.001, bm.difficulty.sliderTickRate);
  let tickDistance = (vel * tp.red.beatLength) / tickRate;
  tickDistance = Math.min(Math.max(tickDistance, 0), pathLen);
  if (tickDistance <= 0) return [];
  const minDistanceFromEnd = vel * 10;
  const out: SliderTickPoint[] = [];
  for (let s = 0; s < slides; s++) {
    const spanStart = o.time + s * span;
    const reversed = s % 2 === 1;
    for (let d = tickDistance; d <= pathLen; d += tickDistance) {
      if (d >= pathLen - minDistanceFromEnd) break;
      const progress = d / pathLen;
      out.push({ progress, timeMs: spanStart + (reversed ? 1 - progress : progress) * span, spanIndex: s });
    }
  }
  return out;
}

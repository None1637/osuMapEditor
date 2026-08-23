// 上方时间轴药丸标签 (v53): 对齐 lazer 编辑器时间轴
//   osu.Game/Screens/Edit/Compose/Components/Timeline/TimelineTimingChangeDisplay.cs (红线 BPM 文本)
//   osu.Game/Screens/Edit/Compose/Components/Timeline/DifficultyPointPiece.cs       (绿药丸 SV 倍率)
//   osu.Game/Screens/Edit/Compose/Components/Timeline/SamplePointPiece.cs           (粉药丸 采样集+音量)
//   osu.Game/Screens/Edit/Compose/Components/Timeline/HitObjectPointPiece.cs        (药丸通用外观)
// 颜色 = lazer OsuColour: Red2/Lime1/Pink1/Pink2/B5
import type { Beatmap, HitObject, TimingPoint } from './parser';
import { parseHitSample, objectVolume, setNumFromGeneral } from './clock/hitSounds';
import { timingAt } from './parser';

// ---- lazer OsuColour 常量 ----
export const PILL_RED = '#eb4747';   // Red2 (TimingControlPoint.GetRepresentingColour)
export const PILL_LIME = '#b2ff66';  // Lime1 (DifficultyPointPiece)
export const PILL_PINK = '#ff66ab';  // Pink1 (SamplePointPiece 普通物件)
export const PILL_PINK_ALT = '#eb4791'; // Pink2 (slider, AlternativeColor)
export const PILL_TEXT = '#222a28';  // B5 (HitObjectPointPiece 文字色)

/** 红线文本 (lazer TimingPointPiece: $"{60000 / beatLength:n1} BPM") */
export function bpmPillText(beatLength: number): string {
  return `${(60000 / beatLength).toFixed(1)} BPM`;
}

/** 绿线 SV 倍率 (legacy: beatLength < 0, sv = -100 / beatLength); 文本 lazer $"{multiplier:n2}x" */
export function svOfPoint(tp: TimingPoint): number | null {
  if (tp.uninherited || tp.beatLength >= 0) return null;
  return -100 / tp.beatLength;
}
export function svPillText(sv: number): string {
  return `${sv.toFixed(2)}x`;
}

/**
 * 全部绿线的 SV 药丸 (v61: 对齐 lazer — TimelineHitObjectBlueprint.cs:130 每个 IHasSliderVelocity
 * 物件都挂绿色 SV 胶囊, 无"与上一条不同才显示"判断; 等值剔除只发生在 lazer 导出 .osu 时
 * LegacyBeatmapEncoder.cs:325 IsRedundant — 我们直接编辑 .osu 行, 不做导出剔除)。
 * SV 重申、纯音量/采样集变化的绿线同样出药丸。
 */
export function svPoints(points: TimingPoint[]): { time: number; sv: number }[] {
  const out: { time: number; sv: number }[] = [];
  for (const tp of [...points].sort((a, b) => a.time - b.time)) {
    const sv = svOfPoint(tp);
    if (sv !== null) out.push({ time: tp.time, sv });
  }
  return out;
}

/** sampleSet 数字 -> 药丸 bank 字母 (lazer abbreviateBank: normal=N soft=S drum=D) */
export function bankLetter(setNum: number): string {
  return setNum === 3 ? 'D' : setNum === 2 ? 'S' : 'N';
}

export interface SamplePill {
  text: string;
  /** slider (lazer IHasRepeats) -> Pink2 */
  alt: boolean;
}

/**
 * 粉药丸文本 (lazer SamplePointPiece: $"{abbreviateBank(bank)}{suffix} {volume}"):
 *  - bank = hitSample.normalSet 继承链 (物件 -> timing point -> [General] SampleSet) 的首个 hitnormal bank;
 *  - suffix = 自定义采样序号 >1 时 ":n" (lazer: 所有 sample 同非空 Suffix 才显示; 我们模型单一序号);
 *  - volume = hitSample.volume 覆盖, 否则 timing point volume (lazer samples.Max(Volume))。
 */
export function samplePill(bm: Beatmap, o: HitObject): SamplePill {
  const hs = parseHitSample(o.hitSampleRaw);
  const tp = timingAt(bm.timingPoints, o.time);
  const tpSet = (tp.green ?? tp.red).sampleSet || setNumFromGeneral(bm.general.sampleSet);
  const bank = hs.normalSet || tpSet;
  const suffix = hs.customIndex > 1 ? `:${hs.customIndex}` : '';
  const vol = objectVolume(bm.timingPoints, o.time, hs.volume);
  return { text: `${bankLetter(bank)}${suffix} ${vol}`, alt: o.type === 'slider' };
}

/** 药丸横向排布: 与上一个完整药丸重叠时收缩为小圆点 (lazer SamplePointContracted: 缩得太小只画点) */
export function pillLayout(items: { x: number; w: number }[], gap = 2): ('full' | 'dot')[] {
  let lastRight = -Infinity;
  return items.map(it => {
    if (it.x - it.w / 2 > lastRight + gap) {
      lastRight = it.x + it.w / 2;
      return 'full' as const;
    }
    return 'dot' as const;
  });
}

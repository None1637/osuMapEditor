// F1: 滑条转连打 (slider -> stream)
// 参考 lazer SliderSelectionBlueprint.convertToStream (SliderSelectionBlueprint.cs:566):
//   单点沿路径按折返方向采样 (奇数 span 反向), 全部复制头部采样, 首圆保留 NewCombo
// 在 lazer 等距基础上扩展: 数量/间距两种模式 (间距单位 = 拍) + 变距曲线 (线性/先加后减/先减后加)
// v41 语义修正: 时间间隔始终等距 (lazer 语义), 变距曲线只改变单点沿路径的【空间】分布密度
// v43 按数量语义: 位置先按数量沿路径分布 (等距=索引均布, 与 v41 一致), 时间 = head + i*div
//   (吸附 red 网格, div = spacingBeats 拍), 允许超出滑条尾继续生成 — 时间超尾不再堆在路径尾
import type { Beatmap, HitObject } from '../parser';
import { genId, sliderVelocityAt, timingAt } from '../parser';
import { getSliderPath } from '../sliderPath';

// v398: 间距曲线重做 (soulten 反馈「指数不是底数, 用起来不像」) — 不勾「自定义连打间距」= 固定间距;
//   勾选后三项: 指数底数 (1=线性, 可恢复预设) / 倍率% (1~2000, 正反调节精度相同) / 重复次数 + 镜像重复
export interface StreamParams {
  mode: 'count' | 'spacing';  // 按数量 or 按时间间距
  count: number;              // 单点数 (>=1; =1 时仅滑条头一个 note)
  spacingBeats: number;       // 基准时间间距, 单位拍 (>0, spacing 模式; v41 起由节拍下拉框给出)
  customSpacing: boolean;     // v398: 自定义连打间距 (false = 固定间距)
  expoBase: number;           // v398: 指数底数 (>0, 两位小数; 1 = 线性; >1 前慢后快; <1 前快后慢)
  rampPercent: number;        // v398: 倍率 % — 单点空间间距从 100% 渐变到该值 (1~2000; 100 = 不变)
  repeats: number;            // v398: 重复次数 (1~16) — 渐变模式沿行程重复
  mirrorRepeat: boolean;      // v398: 镜像重复 (奇数次重复反向渐变, 如 100→k→100)
}

export const DEFAULT_STREAM_PARAMS: StreamParams = {
  mode: 'spacing', count: 8, spacingBeats: 0.5,
  customSpacing: false, expoBase: 1, rampPercent: 200, repeats: 1, mirrorRepeat: false,
};

/** v398: 遗留持久化参数 (v36~v222 的 curve/endPercent/exponent) 迁移到新模型;
 *  bell = repeats 2 + 镜像 (100→k→100); bellInv 中段最疏 = 倍率 200-endPercent 的镜像两段 */
export function migrateStreamParams(raw: StreamParams & { curve?: string; endPercent?: number; exponent?: number }): StreamParams {
  if (raw.curve === undefined) return raw; // 已是新模型 (遗留数据必带 curve 字段)
  const p = { ...DEFAULT_STREAM_PARAMS, ...raw };
  const end = typeof raw.endPercent === 'number' ? raw.endPercent : 50;
  switch (raw.curve) {
    case 'linear': case 'accel': case 'decel':
      return { ...p, customSpacing: true, expoBase: 1, rampPercent: end, repeats: 1, mirrorRepeat: false };
    case 'expo':
      return { ...p, customSpacing: true, expoBase: Math.max(0.01, raw.exponent ?? 2), rampPercent: end, repeats: 1, mirrorRepeat: false };
    case 'bell':
      return { ...p, customSpacing: true, expoBase: 1, rampPercent: end, repeats: 2, mirrorRepeat: true };
    case 'bellInv':
      return { ...p, customSpacing: true, expoBase: 1, rampPercent: Math.max(1, 200 - end), repeats: 2, mirrorRepeat: true };
    default: // 'equal' / 未知
      return { ...p, customSpacing: false };
  }
}

/** v398: 自定义间距权重 — segP∈[0,1] 行程比例 (段末采样) -> 该段间距倍率。
 *  相位: 行程按重复次数分段, 镜像重复时奇数段相位反向;
 *  形状: 底数 B — B=1 线性; 否则 (B^ph-1)/(B-1) (B>1 前慢后快, 0<B<1 前快后慢; B→1 极限即线性);
 *  端点语义: 首段恒 100%, 单次重复时末段恒 = rampPercent% */
export function streamSpacingWeight(p: StreamParams, segP: number): number {
  const k = Math.max(0.01, p.rampPercent / 100);
  const reps = Math.max(1, Math.round(p.repeats));
  const q = Math.min(1, Math.max(0, segP)) * reps;
  let c = Math.floor(q);
  let ph = q - c;
  if (c >= reps) { c = reps - 1; ph = 1; } // segP=1 边界: 末段末端相位 1
  if (p.mirrorRepeat && c % 2 === 1) ph = 1 - ph;
  const B = Math.max(0.01, p.expoBase);
  const shape = Math.abs(B - 1) < 1e-9 ? ph : (Math.pow(B, ph) - 1) / (B - 1);
  return Math.max(0, 1 + (k - 1) * shape);
}

/** 单条滑条的单点相对时间列 — v41: 时间间隔始终等距 (lazer convertToStream 语义);
 *  变距曲线只影响空间分布 (见 streamFractions), 不影响时间。
 *  spacingMs = spacingBeats * 滑条起点处 beatLength (由调用方按各滑条 timing 解析) */
export function streamTimes(duration: number, p: StreamParams, spacingMs: number): number[] {
  if (duration <= 0) return [0];
  if (p.mode === 'count') {
    const n = Math.max(1, Math.round(p.count));
    if (n === 1) return [0]; // v40: 数量=1 -> 仅滑条头
    const d = duration / (n - 1);
    return Array.from({ length: n }, (_, i) => i * d);
  }
  const s = Math.max(1, spacingMs);
  const times: number[] = [];
  let t = 0, guard = 0;
  while (t <= duration + 1e-6 && guard++ < 10000) { times.push(t); t += s; }
  return times;
}

/** 单点沿滑条行程的位置比例列 [0..1] (与 times 等长):
 *  固定间距: 按数量模式 = 索引均布 (v43: 位置与 v41 一致, 与时间解耦, 超尾时间不再堆在尾部);
 *        按间距模式 = 时间比例 (与 lazer 一致, 末点不一定到路径尾);
 *  自定义间距 (v398): 相邻间距按 streamSpacingWeight 权重分配 (段末采样, v230 端点语义沿用),
 *    归一化覆盖整条行程 (末点恒在路径尾) */
export function streamFractions(p: StreamParams, times: number[], duration: number): number[] {
  const n = times.length;
  if (n < 2) return times.map(() => 0);
  if (!p.customSpacing) {
    if (p.mode === 'count') return times.map((_, i) => i / (n - 1)); // v43
    return times.map(t => (duration > 0 ? t / duration : 0));
  }
  // v398: 采样点 — 非镜像 = 段末 ((j+1)/(n-1), v230 端点语义: 单次重复时末段间距恰 = 倍率%);
  //   镜像重复 = 段中点 ((j+0.5)/(n-1)) — 段末采样会把末段相位采到 0/1 端点, 破坏镜像对称 (bell 形两端不等)
  const w = Array.from({ length: n - 1 }, (_, j) => streamSpacingWeight(p, (j + (p.mirrorRepeat ? 0.5 : 1)) / (n - 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 1e-9) return times.map(() => 0); // 全零权重: 全部堆在头部
  const f = [0];
  let acc = 0;
  for (let j = 0; j < n - 1; j++) { acc += w[j] / sum; f.push(acc); }
  return f;
}

/** 选中滑条 -> 连打单点 (纯函数; hitsound 完全按 lazer: 全部复制头部采样, 首圆保留 newCombo) */
export function computeStream(bm: Beatmap, sliders: HitObject[], p: StreamParams): HitObject[] {
  const out: HitObject[] = [];
  for (const s of sliders) {
    const vel = sliderVelocityAt(bm.timingPoints, s.time, bm.difficulty.sliderMultiplier);
    const slides = s.slides ?? 1;
    const len = s.length ?? 0;
    if (vel <= 0 || len <= 0) continue;
    const duration = len / vel * slides;
    const { red } = timingAt(bm.timingPoints, s.time);
    const spacingMs = p.spacingBeats * red.beatLength; // v40: 间距单位 = 拍
    const path = getSliderPath(bm, s);
    // v43: 按数量模式 — 位置先按数量沿路径分布 (与 v41 一致), 时间再按间距网格从头部逐个排
    //   (head + i*div, 吸附 red 网格; 允许超出滑条尾继续生成, 位置不堆在尾部)
    let times: number[];
    if (p.mode === 'count') {
      const n = Math.max(1, Math.round(p.count));
      if (n === 1) times = [0]; // v40: 数量=1 -> 仅滑条头
      else {
        const div = Math.max(1, spacingMs);
        times = [0];
        for (let i = 1; i < n; i++) {
          times.push(red.time + Math.round((s.time + i * div - red.time) / div) * div - s.time);
        }
      }
    } else {
      times = streamTimes(duration, p, spacingMs);
    }
    const fracs = streamFractions(p, times, duration); // v41: 时间等距, 变距曲线只改空间分布
    for (let i = 0; i < times.length; i++) {
      // lazer: positionWithRepeats 落在奇数 span 时路径反向
      const withRepeats = fracs[i] * slides;
      let pos = withRepeats - Math.floor(withRepeats);
      if (withRepeats % 2 >= 1) pos = 1 - pos;
      const pt = path.positionAt(pos * len);
      out.push({
        id: genId(), type: 'circle', x: Math.round(pt.x), y: Math.round(pt.y),
        time: Math.round(s.time + times[i]),
        newCombo: i === 0 && !!s.newCombo, comboSkip: 0,
        hitSound: s.hitSound ?? 0, hitSampleRaw: s.hitSampleRaw,
      });
    }
  }
  return out;
}

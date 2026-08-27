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

// v40: 间距单位改节拍; 曲线简化为 线性/先加后减/先减后加 ('accel'/'decel' 为 v36 遗留值, 加载时映射到 linear)
// v222: 新增指数变化曲线 ('expo') + 指数参数 exponent
export type StreamCurve = 'equal' | 'linear' | 'bell' | 'bellInv' | 'expo' | 'accel' | 'decel';

export interface StreamParams {
  mode: 'count' | 'spacing';  // 按数量 or 按时间间距
  count: number;              // 单点数 (>=1; =1 时仅滑条头一个 note)
  spacingBeats: number;       // 基准时间间距, 单位拍 (>0, spacing 模式; v41 起由节拍下拉框给出)
  curve: StreamCurve;         // 空间间距变化曲线 (equal = 等距)
  endPercent: number;         // 变距: 空间间距从 100% 渐变到 endPercent% (0~400; 如 50 = 尾部间距减半 = 变密)
  exponent: number;           // v222: 指数曲线弯曲度 (>0, 两位小数; 仅 curve='expo' 时用; 1 = 同线性)
}

export const DEFAULT_STREAM_PARAMS: StreamParams = { mode: 'spacing', count: 8, spacingBeats: 0.5, curve: 'equal', endPercent: 50, exponent: 2 };

/** 间距权重: p in [0,1] -> 间距倍率 (从 1 渐变到 k = endPercent/100) */
function weight(curve: StreamCurve, k: number, p: number, exp = 2): number {
  const d = k - 1;
  switch (curve) {
    case 'equal': return 1;
    case 'linear':
    case 'accel':              // 遗留值按线性处理
    case 'decel': return 1 + d * p;                          // 线性变化
    case 'bell': return 1 + d * Math.sin(Math.PI * p);       // 先加后减: 间距 100%->k->100% (中段最密)
    case 'bellInv': return 1 - d * Math.sin(Math.PI * p);    // 先减后加: 间距 100%->(2-k)->100% (中段最疏)
    case 'expo': return 1 + d * Math.pow(p, Math.max(0.01, exp)); // v222: 指数变化; exp>1 前慢后快, 0<exp<1 前快后慢
  }
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
 *  等距: 按数量模式 = 索引均布 (v43: 位置与 v41 一致, 与时间解耦, 超尾时间不再堆在尾部);
 *        按间距模式 = 时间比例 (与 lazer 一致, 末点不一定到路径尾);
 *  变距: 相邻间距按权重分配, 归一化覆盖整条行程 (末点恒在路径尾; 权重钳制 >=0, endPercent 支持 0) */
export function streamFractions(p: StreamParams, times: number[], duration: number): number[] {
  const n = times.length;
  if (n < 2) return times.map(() => 0);
  if (p.curve === 'equal') {
    if (p.mode === 'count') return times.map((_, i) => i / (n - 1)); // v43
    return times.map(t => (duration > 0 ? t / duration : 0));
  }
  const k = Math.max(0, p.endPercent / 100); // v41: 允许 0% (末段间距=0, 单点堆叠在路径尾)
  // v230: expo 曲线改段末采样 ((j+1)/(n-1)) — 段中点采样 p 恒 <1, 高指数时 w≈1 全程平坦
  // (末段也只采到 p=5/6, (5/6)^10≈0.16 远不到 k), 指数越大越"没效果";
  // 段末采样使末段间距恰 = endPercent% (端点语义), 指数越大变化越集中在尾部, 符合直觉。
  const w = Array.from({ length: n - 1 }, (_, j) => Math.max(0, weight(p.curve, k, p.curve === 'expo' ? (j + 1) / (n - 1) : (j + 0.5) / (n - 1), p.exponent ?? 2)));
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

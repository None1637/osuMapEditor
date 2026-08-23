// F2: 滑条等时间拆分 (slider -> n 段等长小滑条)
// 语义 (用户需求规格):
//   - 折返视为无折返: 按单程处理 (时长 = length/vel, 路径 = 单条路径), 拆分结果每段 slides=1
//   - 等时间拆分: n 段路径长度相等; 距离间隙 distGap 后每段路径长 ℓ = (L - (n-1)*distGap)/n (校验 ℓ>0)
//   - 每段时长 = ℓ/vel (vel 用 sliderVelocityAt 在段起点时间的值); 时间间隙 timeGap: 第 i 段起点 = 上一段终点 + timeGap
//   - 形状最小变化: 统一走贝塞尔 (bezierPath.ts), 按弧长在 ℓ 边界处 de Casteljau 剖分,
//     每段输出 curveType 'B' 的滑条, 段内跨原分段的接缝用重复点 (红锚点) 保持分段语义
//   - hitsound: 头部采样 (hitSound/hitSampleRaw) 给第一段; edgeSounds/edgeSets 按时间落到对应段
//     (折返视为无折返时, 端点 i 的时间 = s.time + i*单程时长; 落在哪段时间范围就给哪段的对应端)
//   - newCombo: 仅第一段保留原值
// hitsound 落段规则参考 lazer SliderSelectionBlueprint.splitControlPoints (:500) 的节点采样处理思路
import type { Beatmap, HitObject } from '../parser';
import { genId, sliderVelocityAt } from '../parser';
import { extractRange, measureSegments, segmentsToPoints, sliderToBezierSegments } from './bezierPath';

export interface SplitParams {
  count: number;   // 拆分数 n (2~64)
  timeGap: number; // 时间间隙 ms (默认 0 = 段与段首尾时间相接)
  distGap: number; // 距离间隙 osu px (默认 0 = 路径上无间隔)
}

export const DEFAULT_SPLIT_PARAMS: SplitParams = { count: 2, timeGap: 0, distGap: 0 };

export interface SplitResult {
  objects: HitObject[];
  /** 非法参数提示 (此时 objects 为空, 不生成预览) */
  error?: string;
}

const roundPt = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** 单条滑条 -> n 段等长小滑条 (纯函数) */
export function computeSplit(bm: Beatmap, s: HitObject, p: SplitParams): SplitResult {
  if (s.type !== 'slider') return { objects: [], error: '仅支持拆分滑条' };
  const n = Math.round(p.count);
  if (!(n >= 2 && n <= 64)) return { objects: [], error: '拆分数需在 2~64 之间' };
  const timeGap = Math.max(0, p.timeGap || 0);
  const distGap = Math.max(0, p.distGap || 0);
  const L = s.length ?? 0;
  const sm = bm.difficulty.sliderMultiplier;
  const vel0 = sliderVelocityAt(bm.timingPoints, s.time, sm);
  if (L <= 0 || vel0 <= 0) return { objects: [], error: '滑条长度或速度无效' };
  const segLen = (L - (n - 1) * distGap) / n;
  if (segLen <= 0) return { objects: [], error: `距离间隙过大: 每段长度 ${segLen.toFixed(1)} <= 0` };

  // 统一转贝塞尔 + 弧长测量
  const segs = sliderToBezierSegments(s);
  if (!segs.length) return { objects: [], error: '控制点不足' };
  const m = measureSegments(segs);

  // 各段时间 (顺序累积: 段时长 = 段长 / 段起点时刻速度; 段间加 timeGap; 默认全 0 时严格等时间首尾相接)
  const starts: number[] = [], durs: number[] = [];
  let t = s.time;
  for (let j = 0; j < n; j++) {
    starts.push(t);
    const dur = segLen / sliderVelocityAt(bm.timingPoints, t, sm);
    durs.push(dur);
    t += dur + timeGap;
  }

  // edgeSounds/edgeSets 按时间落段: 端点 i 时间 = s.time + i*单程时长 (折返视为无折返)
  const edgeSounds = s.edgeSoundsRaw !== undefined ? s.edgeSoundsRaw.split('|') : null;
  const edgeSets = s.edgeSetsRaw !== undefined ? s.edgeSetsRaw.split('|') : null;
  const headS = new Array<string>(n).fill('0'), tailS = new Array<string>(n).fill('0');
  const headE = new Array<string>(n).fill('0:0'), tailE = new Array<string>(n).fill('0:0');
  const edgeN = Math.max(edgeSounds?.length ?? 0, edgeSets?.length ?? 0);
  const singleDur = L / vel0; // 单程时长 (折返视为无折返)
  for (let i = 0; i < edgeN; i++) {
    const T = s.time + i * singleDur;
    // 头部优先: 与某段起点重合 -> 该段头部; 否则落在某段 (起点, 终点] -> 该段尾部
    let seg = -1, isHead = false;
    for (let j = 0; j < n; j++) if (Math.abs(T - starts[j]) <= 1) { seg = j; isHead = true; break; }
    if (seg < 0) for (let j = 0; j < n; j++) if (T > starts[j] && T <= starts[j] + durs[j] + 1) { seg = j; break; }
    if (seg < 0) continue; // 落在间隙/范围外: 丢弃
    if (edgeSounds) (isHead ? headS : tailS)[seg] = edgeSounds[i] ?? '0';
    if (edgeSets) (isHead ? headE : tailE)[seg] = edgeSets[i] ?? '0:0';
  }

  // 按弧长剖分并生成各段滑条
  const objects: HitObject[] = [];
  for (let j = 0; j < n; j++) {
    const d0 = j * (segLen + distGap), d1 = d0 + segLen;
    const piece = extractRange(m, d0, d1);
    if (!piece.length) return { objects: [], error: '路径几何长度不足, 无法剖分' };
    const pts = segmentsToPoints(piece);
    const obj: HitObject = {
      id: genId(), type: 'slider',
      x: Math.round(pts[0].x), y: Math.round(pts[0].y),
      time: Math.round(starts[j]),
      curveType: 'B', curvePoints: pts.slice(1).map(roundPt),
      slides: 1, length: Math.round(segLen),
      hitSound: j === 0 ? (s.hitSound ?? 0) : 0, // 头部采样只给第一段
      newCombo: j === 0 && !!s.newCombo,         // newCombo 仅第一段保留
      comboSkip: j === 0 ? (s.comboSkip ?? 0) : 0,
    };
    if (j === 0 && s.hitSampleRaw !== undefined) obj.hitSampleRaw = s.hitSampleRaw;
    if (edgeSounds) obj.edgeSoundsRaw = headS[j] + '|' + tailS[j];
    if (edgeSets) obj.edgeSetsRaw = headE[j] + '|' + tailE[j];
    objects.push(obj);
  }
  return { objects };
}

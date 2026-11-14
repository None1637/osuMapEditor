// v540: BPM 研究性假设 — 主 BPM 倍程归一 + 不依赖 DP 跟拍的局部周期变速证据。
// 初期只承诺“恒速单 BPM / 是否变速”，evidence 窗口不是可直接写入谱面的精确红线。
import { acfCandidates, detectBpm, extractConstantTempo, trackScore, type BpmDetectResult } from './bpmDetect';
import { verifyVariableEvidence } from './bpmVariableVerifier';
import type { AudioBufferLike } from './waveformData';

export interface LocalTempoPoint {
  timeMs: number;
  bpm: number;
  support: number;
  globalSupport: number;
  supportRatio: number;
  onsetCount: number;
  globalGridCoverage: number;
  /** v543: 主 BPM 的 1/3、1/6 网格覆盖；旧单测构造点可缺省。 */
  tripletGridCoverage?: number;
  tripletGridHalfCoverage?: number;
  tripletGridDoubleCoverage?: number;
  /** v543: 局部候选自身的整拍覆盖，区分真实新周期与三连音子集。 */
  localGridCoverage?: number;
}

export interface VariableTempoEvidence {
  startMs: number;
  endMs: number;
  bpm: number;
  points: number;
  maxSupport: number;
  localGridCoverage?: number;
  /** v544: 三连音候选不直接删除，交给独立周期复核；旧单测仍可启用直接过滤。 */
  tripletLike?: boolean;
  independentMainScore?: number | null;
  independentMainBpm?: number;
  independentLocalScore?: number | null;
}

export interface BpmResearchResult {
  bpm: number;
  offsetMs: number;
  variable: boolean;
  evidence: VariableTempoEvidence[];
  local: LocalTempoPoint[];
  base: BpmDetectResult;
}

/** v540: 输出层只选一个节拍层级；默认 60~240，范围是显式先验而非“真值恢复”。 */
export function normalizePrimaryBpm(bpm: number, minBpm = 60, maxBpm = 240): number {
  let out = bpm;
  while (out > maxBpm) out /= 2;
  while (out < minBpm) out *= 2;
  return Math.round(out * 1000) / 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
}

/** 只比较倍程折叠产生的相位；未折叠时仅复核半拍 offbeat，避免把 syncopation 当强拍。 */
export function selectPrimaryOffset(rawBpm: number, rawOffset: number, bpm: number, buf: AudioBufferLike): number {
  const period = 60000 / bpm;
  const foldedFactor = Math.round(rawBpm / bpm);
  const phaseCount = foldedFactor > 1 && Math.abs(rawBpm / bpm - foldedFactor) <= 0.02 ? foldedFactor : 2;
  const durationMs = buf.length / buf.sampleRate * 1000;
  const radius = Math.max(1, Math.round(0.012 * buf.sampleRate));
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch));
  const peakAt = (timeMs: number): number => {
    const center = Math.round(timeMs / 1000 * buf.sampleRate);
    let peak = 0;
    for (const pcm of channels) {
      for (let i = Math.max(0, center - radius); i <= Math.min(buf.length - 1, center + radius); i++) peak = Math.max(peak, Math.abs(pcm[i]));
    }
    return peak;
  };
  let bestOffset = rawOffset, bestScore = -Infinity;
  for (let j = 0; j < phaseCount; j++) {
    const candidate = rawOffset + j * period / phaseCount;
    let score = 0, count = 0;
    for (let time = candidate; time < durationMs; time += period) { score += Math.log1p(20 * peakAt(time)); count++; }
    if (count && score / count > bestScore) { bestScore = score / count; bestOffset = candidate; }
  }
  return Math.round(bestOffset);
}

/** 原始 onset 峰在最佳相位下能否由主 BPM 网格解释；相位自由可避免 offset 误差干扰。 */
function mainGridCoverage(win: Float32Array, hopMs: number, globalBpm: number, subdivisions = [8, 6]): { count: number; coverage: number } {
  let maxValue = 0;
  for (const value of win) maxValue = Math.max(maxValue, value);
  const threshold = Math.max(0.04, maxValue * 0.12);
  const peaks: number[] = [];
  for (let i = 1; i + 1 < win.length; i++) {
    if (win[i] >= threshold && win[i] > win[i - 1] && win[i] >= win[i + 1]) peaks.push(i * hopMs);
  }
  if (peaks.length < 4) return { count: peaks.length, coverage: 0 };
  const period = 60000 / globalBpm;
  const tolerance = Math.min(15, period / 24);
  let best = 0;
  for (const subdivision of subdivisions) {
    const grid = period / subdivision;
    for (let step = 0; step < 24; step++) {
      const phase = grid * step / 24;
      let matched = 0;
      for (const peak of peaks) {
        const distance = ((peak - phase) % grid + grid) % grid;
        if (Math.min(distance, grid - distance) <= tolerance) matched++;
      }
      best = Math.max(best, matched / peaks.length);
    }
  }
  return { count: peaks.length, coverage: best };
}

/** 逐秒提取局部候选；全局周期对照取半速/原速/倍速的最大支撑，避免仅因换倍程就报变速。 */
export function localTempoSeries(result: BpmDetectResult, globalBpm: number, minBpm = 60, maxBpm = 240): LocalTempoPoint[] {
  const analysis = result.analysis;
  if (!analysis || !(globalBpm > 0)) return [];
  const { env, hopMs } = analysis;
  const winF = Math.round(4000 / hopMs);
  const stepF = Math.max(1, Math.round(1000 / hopMs));
  const minLag = Math.max(2, Math.round(60000 / 440 / hopMs));
  const maxLag = Math.ceil(60000 / 60 / hopMs) + 1;
  const points: LocalTempoPoint[] = [];
  for (let w0 = 0; w0 + winF <= env.length; w0 += stepF) {
    const win = env.subarray(w0, w0 + winF);
    const candidates = acfCandidates(win, minLag, Math.min(maxLag, (win.length >> 1) - 2));
    const folded: { bpm: number; support: number }[] = [];
    for (const candidate of candidates) {
      const bpm = normalizePrimaryBpm(60000 / candidate.lag / hopMs, minBpm, maxBpm);
      const duplicate = folded.find(c => Math.abs(Math.log(c.bpm / bpm)) < 0.02);
      if (duplicate) duplicate.support = Math.max(duplicate.support, candidate.adj);
      else folded.push({ bpm, support: candidate.adj });
    }
    folded.sort((a, b) => b.support - a.support);
    const best = folded[0];
    if (!best) continue;
    let globalSupport = 0;
    for (const scale of [0.5, 1, 2]) {
      const bpm = globalBpm * scale;
      if (bpm < 40 || bpm > 500) continue;
      globalSupport = Math.max(globalSupport, trackScore(win, 60000 / bpm / hopMs));
    }
    const grid = mainGridCoverage(win, hopMs, globalBpm);
    const tripletGrid = mainGridCoverage(win, hopMs, globalBpm, [3, 6]);
    const tripletHalf = mainGridCoverage(win, hopMs, globalBpm / 2, [3, 6]);
    const tripletDouble = mainGridCoverage(win, hopMs, globalBpm * 2, [3, 6]);
    const localGrid = mainGridCoverage(win, hopMs, best.bpm, [1]);
    points.push({
      timeMs: (w0 + winF / 2) * hopMs,
      bpm: best.bpm,
      support: best.support,
      globalSupport,
      supportRatio: best.support / Math.max(1e-6, globalSupport),
      onsetCount: grid.count,
      globalGridCoverage: grid.coverage,
      tripletGridCoverage: tripletGrid.coverage,
      tripletGridHalfCoverage: tripletHalf.coverage,
      tripletGridDoubleCoverage: tripletDouble.coverage,
      localGridCoverage: localGrid.coverage,
    });
  }
  return points;
}

/** v543: 所有者规则 — 主 BPM 的 1/3、1/6 三连音网格不算变速；真实新周期须能解释自身整拍。 */
export function isTripletRhythm(point: LocalTempoPoint, globalBpm: number): boolean {
  if ((point.localGridCoverage ?? 0) >= 0.75) return false;
  // v543: 只用半倍/原倍基准；再纳入双倍会把真实 4/3 阶跃误当 2/3 三连音（128→173 回归）。
  const bases = [globalBpm / 2, globalBpm];
  const gridCoverage = Math.max(point.tripletGridHalfCoverage ?? 0, point.tripletGridCoverage ?? 0, point.tripletGridDoubleCoverage ?? 0);
  return gridCoverage >= 0.55 && bases.some(base => [1 / 3, 2 / 3, 3 / 2, 3]
    .some(target => Math.abs(point.bpm / base / target - 1) <= 0.03));
}

/** 单窗偏离不算变速：至少 3 个相邻秒窗，且相邻局部 BPM 连续变化。v544 可仅用于诊断地关闭三连音过滤。 */
export function variableTempoEvidence(local: LocalTempoPoint[], globalBpm: number, suppressTriplets = true): VariableTempoEvidence[] {
  const flagged = local.map(p => Math.abs(Math.log(p.bpm / globalBpm)) >= Math.log(1.08)
    && p.support >= 0.045 && p.supportRatio >= 1.15 && p.onsetCount >= 6);
  const evidence: VariableTempoEvidence[] = [];
  for (let i = 0; i < local.length;) {
    if (!flagged[i]) { i++; continue; }
    const start = i;
    while (i + 1 < local.length && flagged[i + 1] && local[i + 1].timeMs - local[i].timeMs <= 1500
      && Math.abs(Math.log(local[i + 1].bpm / local[i].bpm)) <= Math.log(1.1)) i++;
    if (i - start + 1 >= 3) {
      const points = local.slice(start, i + 1);
      // v543/v544: 先按整段多数窗标三连音；生产路径保留候选，由独立倍程周期复核裁决。
      const tripletVotes = points.filter(point => isTripletRhythm(point, globalBpm)).length;
      if (!suppressTriplets || tripletVotes * 2 < points.length) evidence.push({
        startMs: Math.round(points[0].timeMs - 2000),
        endMs: Math.round(points[points.length - 1].timeMs + 2000),
        bpm: Math.round(median(points.map(p => p.bpm)) * 1000) / 1000,
        points: points.length,
        maxSupport: Math.max(...points.map(p => p.support)),
        localGridCoverage: median(points.map(p => p.localGridCoverage ?? 1)),
        tripletLike: tripletVotes * 2 >= points.length,
      });
    }
    i++;
  }
  return evidence;
}

/** 研究入口：保留旧管线的周期精度，新增独立倍程选择和局部变速判断。 */
export function detectBpmHypothesis(buf: AudioBufferLike): BpmResearchResult | null {
  const base = detectBpm(buf);
  const constant = extractConstantTempo(base);
  if (!constant) return null;
  const bpm = normalizePrimaryBpm(constant.bpm);
  const offsetMs = selectPrimaryOffset(constant.bpm, constant.offsetMs, bpm, buf);
  const local = localTempoSeries(base, bpm);
  // v544: 第二组验收否决三连音救回，生产入口维持 v543 保守过滤；诊断器仍可传 false 取原始候选。
  const candidates = variableTempoEvidence(local, bpm);
  const evidence = verifyVariableEvidence(buf, candidates, bpm);
  return { bpm, offsetMs, variable: evidence.length > 0, evidence, local, base };
}

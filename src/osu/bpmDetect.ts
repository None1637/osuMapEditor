// v498: 自动 BPM 检测 (恒速优先) — 纯函数 DSP 管线, node 可单测 (AudioBufferLike 先例见 waveformData.ts)
// 管线: 混单声道+降采样 11025Hz → STFT(win 512, hop 64 ≈ 5.8ms) log 幅度谱通量 onset 包络
//   (局部均值归一) → 双尺度窗 (4s+1.6s) comb-ACF 候选 + 贪心跟踪网格分 (强度一致性 cv 罚
//   +未解释峰罚) → Viterbi 跨窗 tempo 曲线 (adj² 发射 + 全局先验弱拉力 + 每窗注入先验候选)
//   → DP 节拍跟踪 (逐帧周期, Ellis 2007 改) → 抛物线亚帧精修 → 中值滤波游程分段
//   +相邻段合并 LSQ 出红线列; tempo 范围 60~440 (曲线贴底时第二遍 45~440)。
// 恒速提炼 extractConstantTempo: 碎段 onset 落主网格 1/8/1/6 细分即合并 (用户规则),
//   输出单 BPM+offset 供 BpmDetectDialog 显示/编辑。
// 不引依赖 (fft.ts 复用); essentia.js (AGPL 许可, 与 MIT 冲突) / web-audio-beat-detector
//   (仅单 BPM) 均排除。
import { fft, hannWindow } from './fft';
import type { AudioBufferLike } from './waveformData';

export interface BpmSegment {
  /** 段首红线时刻 (ms, 取整) */
  time: number;
  bpm: number;
  meter: number;
  /** 段内节拍数 */
  beats: number;
  /** 0~1, 段内间隔变异系数反比; 低置信段 UI 标黄 */
  confidence: number;
}

export interface BpmDetectResult {
  /** 全部检出节拍时刻 (ms, 亚帧精修后), 预览窗画刻度用 */
  beats: number[];
  segments: BpmSegment[];
  /** v499: 分析中间产物 (onset 包络) — 变速证据复核用; 随结果结构化克隆 */
  analysis?: { env: Float32Array; hopMs: number };
}

export interface BpmDetectOptions {
  minBpm?: number;       // 默认 60
  maxBpm?: number;       // 默认 440 (osu 双倍速常见)
  meter?: number;        // 默认 4
  /** BPM 量化: 0=不取整, 0.1 / 1 = 取整到该步进 (默认 0.1) */
  quantize?: number;
  /** 分段容差 (相邻拍间隔偏离游程中位数的比例, 默认 0.02) */
  segmentTol?: number;
  /** DP tempo 惩罚宽度 (越大越不愿变速, 默认 100) */
  tightness?: number;
  onProgress?: (p: number, stage: string) => void;
}

const ANALYSIS_SR = 11025;
const WIN = 512, HOP = 64; // hop ≈ 5.8ms @11025

/** 混单声道 + 线性插值降采样到 11025Hz */
export function mixDownResample(buf: AudioBufferLike, targetSr = ANALYSIS_SR): Float32Array {
  const sr = buf.sampleRate;
  const n = buf.length;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  if (sr === targetSr) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
    return out;
  }
  const ratio = sr / targetSr;
  const m = Math.floor(n / ratio);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    const a = j < n ? j : n - 1, b = j + 1 < n ? j + 1 : n - 1;
    out[i] = ((ch0[a] + ch1[a]) * (1 - f) + (ch0[b] + ch1[b]) * f) * 0.5;
  }
  return out;
}

/**
 * 频谱通量 onset 包络: log 幅度谱逐帧差分半波整流求和, 局部均值 (~1s) 归一化。
 * 返回 env 与 hopMs; env[f] 对应音频时刻 ≈ f·hop + 3win/4 (高重叠汉宁窗通量峰
 * 落在 click 位于窗左 1/4 处, 见 refineBeats)。
 */
export function onsetEnvelope(samples: Float32Array, sr: number, win = WIN, hop = HOP): { env: Float32Array; hopMs: number } {
  const frames = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  const hann = hannWindow(win);
  const re = new Float32Array(win), im = new Float32Array(win);
  const bins = win >> 1;
  let prev: Float32Array | null = null; // 首帧以自身幅值初始化 — prev=0 会在 t=0 制造假 onset
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) { re[i] = samples[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    // v498: log 压缩幅值 × 低频加权 (bin 权重 1/(1+b/24)) — 真实音频上 log 压缩
    //   平衡各频段/响度差异, 稳态段 tempo 曲线大幅变稳 (实测 220BPM 长段稳定锁定);
    //   线性幅值在真实音频上被低频持续能量淹没。octave 歧义改由 trackScore 的
    //   cv(强度一致性)+未解释峰罚裁决, 不依赖 onset 幅度线性度
    const mag = new Float32Array(bins);
    for (let b = 0; b < bins; b++) mag[b] = Math.log1p(100 * Math.hypot(re[b], im[b]) / (1 + b / 24));
    if (prev === null) { prev = mag; continue; } // 首帧无差分
    let flux = 0;
    for (let b = 0; b < bins; b++) {
      const d = mag[b] - prev[b];
      if (d > 0) flux += d;
    }
    prev = mag;
    env[f] = flux;
  }
  // 局部均值归一化 (窗 ~1s), 钳 ≥0, 峰值归一
  const w = Math.max(1, Math.round(1000 / ((hop / sr) * 1000)));
  const norm = new Float32Array(frames);
  let run = 0;
  const q: number[] = [];
  let maxV = 0;
  for (let i = 0; i < frames; i++) {
    q.push(env[i]); run += env[i];
    if (q.length > w) run -= q.shift()!;
    const v = Math.max(0, env[i] - (run / q.length) * 0.7);
    norm[i] = v;
    if (v > maxV) maxV = v;
  }
  if (maxV > 0) for (let i = 0; i < frames; i++) norm[i] /= maxV;
  return { env: norm, hopMs: (hop / sr) * 1000 };
}

/**
 * 分数 lag 自相关 (env 线性插值取值) — 整数 lag acf 在非整帧周期下随距离漂移退相关
 * (实测 160BPM=64.6 帧: 整数峰 64/65 漂移 0.6 帧/拍, 长程求和后反被 96.9 (1.5×,
 * 分数误差仅 0.1) 超过 → 检出 106.7BPM; 分数 lag 插值对齐后真周期恢复最强峰)。
 */
function acfFrac(seg: Float32Array, lag: number): number {
  const n = seg.length;
  const l0 = Math.floor(lag), f = lag - l0;
  let s = 0, cnt = 0;
  for (let i = 0; i + l0 + 1 < n; i++) {
    s += seg[i] * (seg[i + l0] * (1 - f) + seg[i + l0 + 1] * f);
    cnt++;
  }
  return cnt ? s / cnt : 0;
}

/**
 * 贪心跟踪网格分: 以周期 P 从首强 onset 起逐拍跳 [0.85P, 1.15P] 窗内最大 env,
 * 分 = 每拍平均 env × (1 − 未解释峰能比)。
 * 歧义裁决核心 — 强弱交替 onset 列中: 按 T 跟踪拍点恒落强 onset 且所有强峰都在格上;
 * 按 2T 虽每拍均值更高 (隔拍恒强) 但一半强 onset 不在格上 (未解释罚 ~×0.5);
 * 按 T/2 交替落强/弱均值低; 按 1.5T 轮流落 强/弱/弱 均值低。真周期唯一胜出。
 * (曾用纯均值 + P^-0.1 密度罚: 2T 与 T 的分差被 Hann 相位奇偶偏差 (~8%) 淹没, 弃用)
 */
export function trackScore(env: Float32Array, P: number): number {
  if (P < 2 || env.length < P * 3) return 0;
  let t = 0;
  { // 起点: 前 2P 内最强帧
    let bv = -1;
    const end = Math.min(env.length - 1, Math.round(P * 2));
    for (let i = 0; i <= end; i++) if (env[i] > bv) { bv = env[i]; t = i; }
  }
  const beats: number[] = [];
  while (t < env.length) {
    beats.push(t);
    const j0 = Math.round(t + P * 0.85), j1 = Math.min(env.length - 1, Math.round(t + P * 1.15));
    if (j0 > j1) break;
    let bj = j0, bv = -1;
    for (let j = j0; j <= j1; j++) if (env[j] > bv) { bv = env[j]; bj = j; }
    t = bj;
  }
  if (beats.length < 3) return 0;
  const meanEnv = beats.reduce((s, b) => s + env[b], 0) / beats.length;
  // v498: 拍点强度一致性罚 — 真周期 T 的拍点全落强 onset (强度均匀, cv≈0);
  // T/2 交替落强/弱 (cv≈0.44), 2T 虽均匀但由未解释峰罚。仅靠 meanEnv 时
  // T/2 的均值 0.63~0.73 与 T 的 0.82 差距被 Hann 相位噪声淹没 (实测窗间互有胜负),
  // 加 cv 罚后 T:T/2 分差从 ~1.2× 拉到 ~2×, Viterbi 换段增益稳定压过转移罚
  let varSum = 0;
  for (const b of beats) { const d = env[b] - meanEnv; varSum += d * d; }
  const cv = Math.sqrt(varSum / beats.length) / (meanEnv || 1);
  // 显著峰列中只把"强度可比拍点均值"的峰计入未解释 (弱 offbeat 不罚真周期;
  //   2T 漏掉的强拍 ≥ 0.75 阈值 → 重罚)。offbeat/强拍的幅度比在 log 压缩下缩小,
  //   歧义裁决主要由上面的 cv 强度一致性罚承担
  let peakE = 0, unexplained = 0;
  const thresh = meanEnv * 0.75;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] >= thresh) {
      peakE += env[i];
      let onGrid = false;
      for (const b of beats) if (Math.abs(b - i) <= P * 0.12) { onGrid = true; break; }
      if (!onGrid) unexplained += env[i];
    }
  }
  const resid = peakE > 0 ? unexplained / peakE : 1;
  return meanEnv * (1 - resid) * (1 - Math.min(0.5, cv));
}

/**
 * comb-acf 窗口候选: 整数粗扫 → top-8 局部峰分数精修 (±1 帧, 0.1 步) → 各候选
 * 贪心跟踪网格分 (trackScore: 每拍均值 × (1−未解释峰能比))。返回候选列 (供 Viterbi
 * 选); 弱峰窗返回 []。
 * (单窗最大 adj 直接取音不稳 — 强弱幅度被 Hann 相位调制后 T/2T 分差仅 ~3%, 噪声级;
 *   必须靠 tempoCurve 的跨窗连续性约束定唯一解)
 */
export function acfCandidates(seg: Float32Array, minLag: number, maxLag: number): { lag: number; adj: number }[] {
  maxLag = Math.min(maxLag, (seg.length >> 1) - 2);
  if (maxLag <= minLag + 1) return [];
  const acf = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= maxLag * 2 && lag < seg.length - 2; lag++) acf[lag] = acfFrac(seg, lag);
  const peaks: number[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = acf[lag] + 0.5 * acf[lag * 2];
    if (s >= acf[lag - 1] + 0.5 * acf[(lag - 1) * 2] && s > acf[lag + 1] + 0.5 * acf[(lag + 1) * 2]) peaks.push(lag);
  }
  peaks.sort((a, b) => (acf[b] + 0.5 * acf[b * 2]) - (acf[a] + 0.5 * acf[a * 2]));
  const cand = peaks.slice(0, 8);
  if (!cand.length) return [];
  let bestAcf = 0;
  const refd: { lag: number; adj: number }[] = [];
  for (const c of cand) {
    let bl = c, bs = -Infinity;
    for (let d = -1; d <= 1.0001; d += 0.1) {
      const l = c + d;
      if (l < minLag || l > maxLag) continue;
      const s = acfFrac(seg, l) + 0.5 * acfFrac(seg, l * 2);
      if (s > bs) { bs = s; bl = l; }
    }
    if (bs > bestAcf) bestAcf = bs;
    refd.push({ lag: bl, adj: trackScore(seg, bl) });
  }
  if (bestAcf <= 0.002) return [];
  refd.sort((a, b) => b.adj - a.adj);
  return refd.slice(0, 6);
}

/** 兼容导出: 单窗最大 adj (tempoPrior 用; 曲线请走 tempoCurve 的 Viterbi) */
export function acfBestPeriod(seg: Float32Array, minLag: number, maxLag: number): { lag: number; score: number } | null {
  const c = acfCandidates(seg, minLag, maxLag);
  return c.length ? { lag: c[0].lag, score: c[0].adj } : null;
}

/**
 * 全局 tempo 先验: 整曲 comb-acf + 跟踪分 (60~440 BPM)。返回参考周期 (帧)。
 */
export function tempoPrior(env: Float32Array, hopMs: number, minBpm = 60, maxBpm = 440): number {
  const minLag = Math.max(2, Math.round(60000 / maxBpm / hopMs));
  const maxLag = Math.round(60000 / minBpm / hopMs);
  return acfBestPeriod(env, minLag, maxLag)?.lag ?? Math.round(60000 / 120 / hopMs);
}

/**
 * 滑动窗局部 tempo 曲线: 双尺度窗 (4s+1.6s) / 0.5s 步, 每窗取 top-6 候选 (acfCandidates
 * 合并去重) + 每窗注入全局先验候选 (稀疏/弱证据段留在主 tempo),
 * **Viterbi 跨窗解码** (状态 = 候选, 转移罚 λ·ln²(lag/lag'), **λ=1.0**, 发射 = adj²
 * +先验弱拉力 PRIOR_K·exp(−ln²(lag/prior)/2σ²)) — 单窗歧义 (T/2T/1.5T 因 Hann 相位
 * 调制的奇偶拍幅度偏差达 ~8%, 单窗必振荡) 由全局一致性锁定。
 * 首窗用全局先验锚定 (em − 2·ln²(lag/prior)) 防起步锁错; 跨 >4 窗空洞免罚
 * (静音 break 两侧允许自由换 tempo)。无效窗跳过。3 窗中值滤波后线性插值成逐帧函数。
 */
export function tempoCurve(env: Float32Array, hopMs: number, minBpm = 60, maxBpm = 440): (i: number) => number {
  const minLag = Math.max(2, Math.round(60000 / maxBpm / hopMs));
  // v498: maxLag 需 +1 — round 后 lag==maxLag 被 acfCandidates 的 lag<maxLag 排除,
  // 边界 tempo (如 60BPM=172 帧) 永远进不了候选
  const maxLag = Math.ceil(60000 / minBpm / hopMs) + 1;
  // 双尺度窗: 4s 窗保证慢速段 octave 裁决的样本量; 1.6s 窗捕捉短促的快 tempo 段
  // (4s 窗对 <2s 的段只能给出混合前后的中间值, 实测 1.6s@440BPM 段完全丢失)
  const winFL = Math.round(4000 / hopMs), winFS = Math.round(1600 / hopMs), hopF = Math.round(500 / hopMs);
  const LAMBDA = 1.0;
  // v498: 全局先验弱拉力 — 弱拍/分解段音乐本身强调半程 (kick 隔拍), 局部证据会锁到
  // 1/2 速; 而全局先验 = 全曲主 tempo, 对其 ±25% 内的候选加恒定小奖励 (κ=0.1),
  // 证据相当的窗倾向主 tempo; 远离先验的真变速 (渐慢段等) 奖励≈0 不受影响
  const PRIOR_K = 0.1, PRIOR_SIG = 0.25;
  const fallback = tempoPrior(env, hopMs, minBpm, maxBpm);

  interface Win { at: number; cands: { lag: number; adj: number }[] }
  const wins: Win[] = [];
  for (let w0 = 0; w0 + winFL <= env.length; w0 += hopF) {
    const cands = acfCandidates(env.subarray(w0, w0 + winFL), minLag, Math.min(maxLag, (winFL >> 1) - 1));
    // 短窗候选合并 (trackScore 按拍均值打分, 尺度无关可直接比); 近重复 lag 留高分
    if (w0 + winFS <= env.length) {
      const s0 = w0 + ((winFL - winFS) >> 1);
      for (const c of acfCandidates(env.subarray(s0, s0 + winFS), minLag, Math.min(maxLag, (winFS >> 1) - 1))) {
        const dup = cands.find(x => Math.abs(Math.log(x.lag / c.lag)) < 0.03);
        if (dup) { if (c.adj > dup.adj) { dup.lag = c.lag; dup.adj = c.adj; } }
        else cands.push(c);
      }
      cands.sort((a, b) => b.adj - a.adj);
      cands.length = Math.min(cands.length, 6);
    }
    if (cands.length) wins.push({ at: w0 + winFL / 2, cands });
    // v498: 每窗注入全局先验候选 — 段首/稀疏段证据弱时 acf 候选全是伪周期,
    //   先验候选 + PRIOR_K 拉力让曲线留在主 tempo 直到真证据出现
    const win = wins[wins.length - 1];
    if (win && win.at === w0 + winFL / 2 && !win.cands.some(x => Math.abs(Math.log(x.lag / fallback)) < 0.03)) {
      const adj = trackScore(env.subarray(w0, w0 + winFL), fallback);
      win.cands.push({ lag: fallback, adj });
      win.cands.sort((a, b) => b.adj - a.adj);
      win.cands.length = Math.min(win.cands.length, 6);
    }
  }
  if (!wins.length) return () => fallback;

  // Viterbi (首窗先验锚定; 跨 >4 窗空洞免转移罚)
  const dp: number[][] = [];
  const bp: number[][] = [];
  for (let w = 0; w < wins.length; w++) {
    dp.push([]); bp.push([]);
    for (let c = 0; c < wins[w].cands.length; c++) {
      const cur = wins[w].cands[c];
      // v498: 发射分用 adj² 锐化真假候选差 (真周期 0.82²=0.67 vs 倍程 0.67²=0.44,
      // 差 0.23/窗 × 段内窗数 > 换段转移罚 → 真变速能盖过平滑偏好)
      const lg2 = Math.log(cur.lag / fallback);
      const em = cur.adj * cur.adj + PRIOR_K * Math.exp(-(lg2 * lg2) / (2 * PRIOR_SIG * PRIOR_SIG));
      if (w === 0) {
        const lg = Math.log(cur.lag / fallback);
        dp[w].push(em - 2 * lg * lg); bp[w].push(-1);
        continue;
      }
      const gapFree = wins[w].at - wins[w - 1].at > hopF * 4;
      let best = -Infinity, bj = 0;
      for (let p = 0; p < wins[w - 1].cands.length; p++) {
        const prev = wins[w - 1].cands[p];
        const lg = Math.log(cur.lag / prev.lag);
        const s = dp[w - 1][p] + em - (gapFree ? 0 : LAMBDA * lg * lg);
        if (s > best) { best = s; bj = p; }
      }
      dp[w].push(best); bp[w].push(bj);
    }
  }
  let bi = 0;
  for (let c = 1; c < dp[wins.length - 1].length; c++) if (dp[wins.length - 1][c] > dp[wins.length - 1][bi]) bi = c;
  const pts: { at: number; period: number }[] = [];
  for (let w = wins.length - 1; w >= 0; w--) {
    pts.unshift({ at: wins[w].at, period: wins[w].cands[bi].lag });
    bi = bp[w][bi];
    if (bi < 0 && w > 0) bi = 0;
  }
  // 3 窗中值滤波 (Viterbi 已平滑, 这里只去单窗毛刺)
  const sm = pts.map((p, i) => {
    const nb = [pts[i - 1]?.period, p.period, pts[i + 1]?.period].filter(x => x !== undefined) as number[];
    nb.sort((a, b) => a - b);
    return { at: p.at, period: nb[nb.length >> 1] };
  });
  return (i: number) => {
    if (i <= sm[0].at) return sm[0].period;
    const last = sm[sm.length - 1];
    if (i >= last.at) return last.period;
    for (let k = 1; k < sm.length; k++) {
      if (i < sm[k].at) {
        const f = (i - sm[k - 1].at) / (sm[k].at - sm[k - 1].at);
        return sm[k - 1].period + (sm[k].period - sm[k - 1].period) * f;
      }
    }
    return last.period;
  };
}

/**
 * DP 节拍跟踪 (Ellis 2007 改): period 逐帧取自 tempo 曲线 → 变速段跟随, 窗口
 * [0.8P, 1.25P] + 高 tightness 因局部周期已准, 跟踪非常稳; 段间 P 突变时下一拍
 * 直接落新周期 (惩罚相对当帧 P, 不存在全局先验惩罚压死远端正确 tempo 的问题)。
 * backtrace 从尾窗 (最后 1.5 周期) 最大累计分起, 避免尾拍缺失。
 */
export function trackBeats(env: Float32Array, periodAt: (i: number) => number, tightness = 50): number[] {
  const n = env.length;
  if (n < 4) return [];
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const P = periodAt(i);
    if (P < 2) { cum[i] = env[i]; continue; }
    const lo = Math.max(1, Math.round(P * 0.8));
    const hi = Math.max(lo + 1, Math.round(P * 1.25));
    let best = -Infinity, bj = -1;
    const j0 = Math.max(0, i - hi), j1 = i - lo;
    for (let j = j0; j <= j1; j++) {
      const ratio = (i - j) / P;
      const lg = Math.log(ratio);
      const s = cum[j] - tightness * lg * lg;
      if (s > best) { best = s; bj = j; }
    }
    cum[i] = env[i] + (bj >= 0 ? best : 0);
    back[i] = bj;
  }
  const Pn = periodAt(n - 1);
  let e = Math.max(0, n - 1 - Math.round(Pn * 1.5));
  for (let i = e + 1; i < n; i++) if (cum[i] > cum[e]) e = i;
  const beats: number[] = [];
  for (let i = e; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  // 链根假拍: back=-1 的起根帧 onset 极弱 (如 t=0 处) 时丢弃
  while (beats.length && back[beats[0]] === -1 && env[beats[0]] < 0.05) beats.shift();
  return beats;
}

/** 亚帧精修: 每拍在 onset 包络 ±2 帧内取峰 + 抛物线插值, 帧下标 → ms。
 *  时间基准: hop(64)≪win(1024) 高重叠下相邻帧频谱高度相关, 通量 ≈ 汉宁窗能量
 *  包络的导数, 其峰值落在 click 位于窗左 1/4 处, 即 t ≈ f·hop + 3win/4。
 *  (合成轨实测旧基准 (f−0.5)·hop+win 恒慢 ~24ms, 与 3/4 窗理论值吻合。) */
export function refineBeats(env: Float32Array, beats: number[], hopMs: number): number[] {
  const winThreeQuarterMs = (0.75 * WIN) / ANALYSIS_SR * 1000;
  return beats.map(b => {
    let p = b;
    for (let i = Math.max(0, b - 2); i <= Math.min(env.length - 1, b + 2); i++) if (env[i] > env[p]) p = i;
    let frac = 0;
    if (p > 0 && p < env.length - 1) {
      const y0 = env[p - 1], y1 = env[p], y2 = env[p + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-9) frac = 0.5 * (y0 - y2) / denom;
    }
    return (p + Math.max(-0.5, Math.min(0.5, frac))) * hopMs + winThreeQuarterMs;
  });
}

/** 游程分段 + 最小二乘量化 → 红线列 */
export function segmentBeats(beatsMs: number[], opts: BpmDetectOptions = {}): BpmSegment[] {
  const tol = opts.segmentTol ?? 0.02;
  const meter = opts.meter ?? 4;
  const quantize = opts.quantize ?? 0.1;
  if (beatsMs.length < 2) return [];
  // 游程: 间隔偏离当前游程中位数 > tol 即切段。
  // v498: 用中值3滤波后的间隔判离群 + 连续 2 个离群才切段 — 单拍抖动
  //   (真实音频精修抖动 ±10ms, 恒速歌实测每 ~30 拍被抖断一次) 不再切碎游程
  const runs: [number, number][] = []; // [首拍下标, 末拍下标] 闭区间
  const ivs: number[] = [];
  for (let i = 1; i < beatsMs.length; i++) ivs.push(beatsMs[i] - beatsMs[i - 1]);
  const ivSm = ivs.map((_, i) => median(ivs.slice(Math.max(0, i - 1), i + 2)));
  let s = 0;
  let outlier = 0;
  for (let i = 1; i < beatsMs.length; i++) {
    const iv = ivSm[i - 1];
    const runIvs: number[] = [];
    for (let k = s + 1; k < i; k++) runIvs.push(beatsMs[k] - beatsMs[k - 1]);
    const med = runIvs.length ? median(runIvs) : iv;
    if (runIvs.length && Math.abs(iv - med) / med > tol) {
      if (++outlier >= 2) { runs.push([s, i - outlier]); s = i - outlier + 1; outlier = 0; }
    } else outlier = 0;
  }
  runs.push([s, beatsMs.length - 1]);
  // v498: 相邻游程合并 — 包络抖动会把同一 tempo 段切成 2~4 拍的碎片 (实测稳态段
  //   每 ~30 拍断一次), 碎片 LSQ 周期不准还打断网格连续性; 周期差 <1.5% 的相邻
  //   游程合并后重拟合
  const merged: [number, number][] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const p1 = fitLine(beatsMs.slice(prev[0], prev[1] + 1)).period;
      const p2 = fitLine(beatsMs.slice(r[0], r[1] + 1)).period;
      if (Math.abs(p1 - p2) / Math.min(p1, p2) < 0.015) { prev[1] = r[1]; continue; }
    }
    merged.push([r[0], r[1]]);
  }
  // 逐段 LSQ 拟合 a + k·T
  const segs: BpmSegment[] = [];
  for (const [a0, a1] of merged) {
    const nBeats = a1 - a0 + 1;
    if (nBeats < 2) continue;
    const ts = beatsMs.slice(a0, a1 + 1);
    let { period, phase } = fitLine(ts);
    let bpm = 60000 / period;
    if (quantize > 0) {
      bpm = Math.round(bpm / quantize) * quantize;
      period = 60000 / bpm;
      // 量化后重拟合相位
      let sum = 0;
      for (let k = 0; k < ts.length; k++) sum += ts[k] - k * period;
      phase = sum / ts.length;
    }
    const ivs: number[] = [];
    for (let k = 1; k < ts.length; k++) ivs.push(ts[k] - ts[k - 1]);
    const mean = ivs.reduce((x, y) => x + y, 0) / ivs.length;
    const sd = Math.sqrt(ivs.reduce((x, y) => x + (y - mean) * (y - mean), 0) / ivs.length);
    const cv = sd / mean;
    segs.push({
      time: Math.round(phase),
      bpm: Math.round(bpm * 1000) / 1000,
      meter,
      beats: nBeats,
      confidence: Math.max(0, Math.min(1, 1 - cv / 0.05)),
    });
  }
  return segs;
}

/** 最小二乘拟合 t_k ≈ phase + k·period */
function fitLine(ts: number[]): { period: number; phase: number } {
  const n = ts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sx += k; sy += ts[k]; sxx += k * k; sxy += k * ts[k]; }
  const det = n * sxx - sx * sx;
  const period = det !== 0 ? (n * sxy - sx * sy) / det : (ts[n - 1] - ts[0]) / (n - 1);
  const phase = (sy - period * sx) / n;
  return { period, phase };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 全管线入口 (纯函数, worker 壳与 node 单测共用) */
export function detectBpm(buf: AudioBufferLike, opts: BpmDetectOptions = {}): BpmDetectResult {
  const prog = opts.onProgress ?? (() => {});
  prog(0.02, 'mixdown');
  const mono = mixDownResample(buf);
  prog(0.1, 'onset');
  const { env, hopMs } = onsetEnvelope(mono, ANALYSIS_SR);
  prog(0.55, 'tempo prior');
  // v498: 两遍 tempo 范围 — 默认 60~440; 若曲线明显贴底 (≥3% 时间贴近 60BPM 边界,
  // 说明存在真慢速段被钳住, 如渐慢到 52BPM 的 ritardando) 再以 45~440 重算。
  // 不能默认 45: 候选范围放宽会让先验误选慢谐波 (实测恒速 128 先验误出 64)
  let periodAt = tempoCurve(env, hopMs, opts.minBpm ?? 60, opts.maxBpm ?? 440);
  if (opts.minBpm === undefined) {
    const floorMs = 60000 / 60;
    let pinned = 0, total = 0;
    for (let f = 0; f < env.length; f += Math.round(500 / hopMs)) {
      total++;
      if (Math.abs(periodAt(f) * hopMs - floorMs) / floorMs < 0.05) pinned++;
    }
    if (pinned / total > 0.03) periodAt = tempoCurve(env, hopMs, 45, opts.maxBpm ?? 440);
  }
  prog(0.65, 'beat tracking');
  const rawBeats = trackBeats(env, periodAt, opts.tightness ?? 50);
  prog(0.85, 'refine');
  const beats = refineBeats(env, rawBeats, hopMs);
  prog(0.92, 'segment');
  const segments = segmentBeats(beats, opts);
  prog(1, 'done');
  return { beats, segments, analysis: { env, hopMs } };
}

/** 恒速提炼结果: 单条红线的 BPM + offset, 及网格覆盖信息 */
export interface ConstantTempoResult {
  bpm: number;
  /** 首条红线时刻 (ms, 落在首个被解释节拍最近的格点上) */
  offsetMs: number;
  /** 主网格 (含 1/8、1/6 细分) 能解释的节拍比例 0~1 */
  coverage: number;
  /** 原始分段数 (检出碎段数量, 仅供参考; 变速判定看 variableSections) */
  segmentCount: number;
  /** 主段 BPM 原始检出值 (未量化) */
  rawBpm: number;
  /** v499: 疑似真变速段 — 未被主网格 1/8/1/6 细分解释 (允许最佳相位拟合)、≥8 拍、
   *  周期与主 BPM 不同 (>2%)、内部一致 (CV<0.1) 且主周期支撑明显弱 (<0.7×) 的段;
   *  另有 8s 滑窗补逐拍连续变速判定。空数组 = 恒速 (碎段不算变速) */
  variableSections: { time: number; bpm: number; beats: number }[];
}

/**
 * v498: 从检出结果提炼恒速答案 — 取节拍数最多的段为主段, 周期/相位直接用主段值
 * (不做跨段全局重拟合: 段间相位差会被 LSQ 学成周期误差); offset = 首个被解释节拍最近格点。
 * v499: 变速判定不再按碎段数:
 *  - 每个 onset 能落在主网格 **1/8 或 1/6 节拍细分** 上 (容差 min(15ms, P/24)) 即视为
 *    同 BPM — 没有明显节拍的段落也按此豁免 (半程/三连音/稀疏段不再误报);
 *  - 逐段复核: 段内 <90% onset 合网格 (允许最佳相位拟合, 同周期族相位平移段豁免)
 *    + ≥8 拍 + 周期与主 BPM 差 >2% + 间隔 CV<0.1 才报疑似真变速段;
 *    短碎段/同周期相位偏移段/跟踪噪声段都不算变速。
 */
export function extractConstantTempo(result: BpmDetectResult, quantize = 0.1, tolMs = 15): ConstantTempoResult | null {
  const segs = result.segments;
  if (!segs.length || !result.beats.length) return null;
  const dom = [...segs].sort((a, b) => b.beats - a.beats)[0];
  let P = 60000 / dom.bpm;
  const phi = dom.time;
  const beats = result.beats;
  // v500: 容差 ms 可选 (UI 传入, 默认 15ms)。P/360 缩放保持与旧版 min(15, P/24)
  // 完全一致的默认行为 — 高 BPM 网格密, 容差必须随周期缩小, 否则随机 onset 全被"解释"
  const tol = tolMs * Math.min(1, P / 360);
  const gridDist = (b: number, sub: number): number => {
    const g = P / sub;
    const d = ((b - phi) % g + g) % g;
    return Math.min(d, g - d);
  };
  const explained = beats.map(b => gridDist(b, 8) <= tol || gridDist(b, 6) <= tol);
  // 变速段判定 (v499): 逐段评估 — ①段内 ≥90% onset 能落主网格 1/8/1/6 → 同 BPM
  // (稀疏/无明确节拍段豁免); ② <8 拍碎段 → 噪点忽略; ③ 周期与主 BPM 差 ≤2%
  // → 同 BPM (相位重置/段首偏移不算变速); ④ 间隔 CV ≥0.1 → 跟踪噪声不是真变速。
  // 四条全不通过 (不合网格 + ≥8 拍 + 周期不同 + 内部一致) 才报疑似真变速段。
  const variableSections: { time: number; bpm: number; beats: number }[] = [];
  // 相位优化网格拟合: 同周期族 (2×/0.5×) 但相位平移的段, 在最佳相位下仍能合主网格
  // → 不是变速。逐段在 [0, P/sub) 扫 24 个相位, 任一相位 ≥90% 合网格即豁免
  const bestFitRatio = (bs: number[]): number => {
    let best = 0;
    for (const sub of [8, 6]) {
      const g = P / sub;
      for (let step = 0; step < 24; step++) {
        const d0 = (g * step) / 24;
        let ok = 0;
        for (const b of bs) {
          const d = ((b - phi - d0) % g + g) % g;
          if (Math.min(d, g - d) <= tol) ok++;
        }
        if (ok / bs.length > best) best = ok / bs.length;
      }
    }
    return best;
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.beats < 8) continue;
    if (Math.abs(60000 / s.bpm - P) / P <= 0.02) continue;
    const end = i + 1 < segs.length ? segs[i + 1].time : Infinity;
    const bs = beats.filter(b => b >= s.time - 1 && b < end - 1);
    if (bs.length < 8) continue;
    const ivs: number[] = [];
    for (let k = 1; k < bs.length; k++) ivs.push(bs[k] - bs[k - 1]);
    const mean = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const cv = Math.sqrt(ivs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ivs.length) / mean;
    if (cv >= 0.1) continue;
    if (bestFitRatio(bs) >= 0.9) continue;
    // 证据复核 (v499): 主周期在该段 onset 包络上仍有相当支撑 (≥0.7×) 则不是变速 —
    // 稠密 16/32 分音符段跟踪会锁到伪周期, 但主周期通量分依然很高; 真变速处主周期
    // 支撑应明显弱于局部新周期
    const a = result.analysis;
    if (a) {
      const f0 = Math.max(0, Math.round(s.time / a.hopMs));
      const f1 = Math.min(a.env.length, Math.round((end === Infinity ? bs[bs.length - 1] : end) / a.hopMs));
      const win = a.env.subarray(f0, f1);
      const sDom = trackScore(win, P / a.hopMs);
      const sVar = trackScore(win, (60000 / s.bpm) / a.hopMs);
      if (sDom >= sVar * 0.7) continue;
    }
    variableSections.push({ time: s.time, bpm: s.bpm, beats: s.beats });
  }
  // 逐拍连续变速 (ritardando 型) 补充判定 (v499): 分段一致性检查抓不到逐拍变化,
  // 用 8s 滑窗 (步 4s): 窗内 ≥6 拍、未解释 onset ≥50%、间隔中位数与主周期差 >2%,
  // 且新周期支撑明显强于主周期 (同一 trackScore 证据复核) → 报一段疑似变速。
  // 同 BPM 相位重置段间隔中位数≈P, 不会误报
  const a0 = result.analysis;
  if (a0) {
    const winMs = 8000, stepMs = 4000;
    const songEnd = beats[beats.length - 1];
    let marked: { t0: number; t1: number; med: number; n: number }[] = [];
    for (let t0 = Math.max(0, dom.time - winMs); t0 < songEnd; t0 += stepMs) {
      const idxs: number[] = [];
      for (let i = 0; i < beats.length; i++) if (beats[i] >= t0 && beats[i] < t0 + winMs) idxs.push(i);
      if (idxs.length < 6) continue;
      const un = idxs.filter(i => !explained[i]);
      if (un.length / idxs.length < 0.5) continue;
      const bs = idxs.map(i => beats[i]);
      const ivs: number[] = [];
      for (let k = 1; k < bs.length; k++) ivs.push(bs[k] - bs[k - 1]);
      const med = median(ivs);
      if (Math.abs(med - P) / P <= 0.02) continue;
      const f0 = Math.round(t0 / a0.hopMs), f1 = Math.min(a0.env.length, Math.round((t0 + winMs) / a0.hopMs));
      const win = a0.env.subarray(f0, f1);
      if (trackScore(win, P / a0.hopMs) >= trackScore(win, med / a0.hopMs) * 0.7) continue;
      marked.push({ t0, t1: t0 + winMs, med, n: idxs.length });
    }
    for (const m of marked) {
      if (variableSections.some(v => Math.abs(v.time - m.t0) < winMs)) continue;
      variableSections.push({ time: Math.round(m.t0), bpm: Math.round(60000 / m.med * 1000) / 1000, beats: m.n });
    }
    variableSections.sort((a, b) => a.time - b.time);
  }
  const explainedBeats = beats.filter((_, i) => explained[i]);
  const first = explainedBeats.length ? Math.min(...explainedBeats) : phi;
  const bpm = quantize > 0 ? Math.round((60000 / P) / quantize) * quantize : 60000 / P;
  P = 60000 / bpm;
  const offset = Math.round(phi + Math.round((first - phi) / P) * P);
  return {
    bpm: Math.round(bpm * 1000) / 1000,
    offsetMs: offset,
    coverage: explainedBeats.length / beats.length,
    segmentCount: segs.length,
    rawBpm: dom.bpm,
    variableSections,
  };
}

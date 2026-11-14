// v543: 变速证据的独立时域复核 — RMS 正差分，不复用 STFT 频谱通量候选。
import type { AudioBufferLike } from './waveformData';
import type { VariableTempoEvidence } from './bpmResearch';

function timeDomainEnvelope(buf: AudioBufferLike, startMs: number, endMs: number): { env: Float32Array; hopMs: number } {
  const sr = buf.sampleRate;
  const hopMs = 10;
  const hop = Math.max(1, Math.round(sr * hopMs / 1000));
  const win = Math.max(hop, Math.round(sr * 0.02));
  const begin = Math.max(0, Math.floor(startMs / 1000 * sr));
  const finish = Math.min(buf.length, Math.ceil(endMs / 1000 * sr));
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch));
  const energy: number[] = [];
  for (let offset = begin; offset + win < finish; offset += hop) {
    let sum = 0;
    for (const pcm of channels) {
      for (let i = offset; i < offset + win; i++) sum += pcm[i] * pcm[i];
    }
    energy.push(Math.log1p(100 * Math.sqrt(sum / (win * channels.length))));
  }
  const env = new Float32Array(Math.max(0, energy.length - 1));
  for (let i = 1; i < energy.length; i++) env[i - 1] = Math.max(0, energy[i] - energy[i - 1]);
  let max = 0;
  for (const value of env) max = Math.max(max, value);
  if (max > 0) for (let i = 0; i < env.length; i++) env[i] /= max;
  return { env, hopMs };
}

function correlation(env: Float32Array, lag: number): number | null {
  const base = Math.floor(lag);
  if (base < 2 || env.length < lag * 4 + 2) return null;
  let mean = 0;
  for (const value of env) mean += value;
  mean /= env.length;
  let numerator = 0, left = 0, right = 0;
  for (let i = 0; i + base + 1 < env.length; i++) {
    const a = env[i] - mean;
    const fraction = lag - base;
    const b = env[i + base] * (1 - fraction) + env[i + base + 1] * fraction - mean;
    numerator += a * b;
    left += a * a;
    right += b * b;
  }
  return left > 0 && right > 0 ? numerator / Math.sqrt(left * right) : null;
}

/** v543: 一、二倍周期按有效权重归一；短窗缺少二倍周期时不能把它当零。 */
export function timeDomainPeriodicity(env: Float32Array, hopMs: number, bpm: number): number | null {
  const lag = 60000 / bpm / hopMs;
  const weighted = [{ value: correlation(env, lag), weight: 0.67 }, { value: correlation(env, lag * 2), weight: 0.33 }]
    .filter((item): item is { value: number; weight: number } => item.value !== null);
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return weight ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : null;
}

export interface VariableEvidenceInspection extends VariableTempoEvidence {
  accepted: boolean;
  rejection: 'accepted' | 'unavailable' | 'weak_short' | 'insufficient_margin';
}

/** v544: 保留分数和拒绝原因；三连音候选用半倍/原倍/双倍主周期对照，兼容主 BPM 倍程错误。 */
export function inspectVariableEvidence(buf: AudioBufferLike, evidence: VariableTempoEvidence[], globalBpm: number): VariableEvidenceInspection[] {
  return evidence.map(item => {
    const strongGrid = (item.localGridCoverage ?? 1) >= 0.5;
    const { env, hopMs } = timeDomainEnvelope(buf, item.startMs, item.endMs);
    let independentMainScore: number | null = null;
    let independentMainBpm: number | undefined;
    for (const scale of item.tripletLike ? [0.5, 1, 2] : [1]) {
      const bpm = globalBpm * scale;
      const score = timeDomainPeriodicity(env, hopMs, bpm);
      if (score !== null && (independentMainScore === null || score > independentMainScore)) {
        independentMainScore = score;
        independentMainBpm = bpm;
      }
    }
    const independentLocalScore = timeDomainPeriodicity(env, hopMs, item.bpm);
    // v544: 第二组否决两条放宽规则；生产路径恢复 v543 阈值，实验分支仅供漏斗诊断。
    const requiredMargin = item.tripletLike ? 0.15 : strongGrid ? 0 : item.points >= 4 ? 0.1 : 0.3;
    const continuousEnough = item.tripletLike ? item.points >= 5
      : strongGrid || item.points >= 4 || independentLocalScore !== null && independentLocalScore >= 0.3;
    const rejection = independentMainScore === null || independentLocalScore === null ? 'unavailable'
      : !continuousEnough ? 'weak_short'
        : independentLocalScore <= independentMainScore + requiredMargin ? 'insufficient_margin' : 'accepted';
    return { ...item, independentMainScore, independentMainBpm, independentLocalScore, accepted: rejection === 'accepted', rejection };
  });
}

/**
 * v543: 高整拍覆盖只需独立 RMS 占优；低覆盖用更严的连续性/周期优势。
 * 3 窗低覆盖是实验性强证据例外：Carnival 前奏为此类；须在独立百首集验证，不能视作已证明通用。
 */
export function verifyVariableEvidence(buf: AudioBufferLike, evidence: VariableTempoEvidence[], globalBpm: number): VariableTempoEvidence[] {
  return inspectVariableEvidence(buf, evidence, globalBpm).filter(item => item.accepted)
    .map(({ accepted: _accepted, rejection: _rejection, ...item }) => item);
}

// v167: 数学工具 — 逐字移植 lazer osu.Game/Rulesets/Difficulty/Utils/DiffUtils.cs 中被星数计算用到的函数
// JS number 全为 double; C# 中 float 处存在可接受的精度差 (任务许可)

// v167: 对应 lazer DiffUtils.Pow — C# Math.Pow 对负数底数非整数指数返回 NaN, JS Math.pow 行为一致, 直接照搬
export function pow(x: number, e: number): number { return Math.pow(x, e); }

// v167: 对应 lazer DiffUtils.Norm (p-范数)
export function norm(p: number, ...values: number[]): number {
  let sum = 0;
  for (const x of values) sum += pow(x, p);
  return pow(sum, 1.0 / p);
}

// v167: 对应 lazer DiffUtils.Logistic(x, midpointOffset, multiplier, maxValue)
export function logistic(x: number, midpointOffset: number, multiplier: number, maxValue = 1): number {
  return maxValue / (1 + Math.exp(multiplier * (midpointOffset - x)));
}

// v167: 对应 lazer DiffUtils.Logistic(exponent, maxValue) (两参重载)
export function logisticExp(exponent: number, maxValue = 1): number {
  return maxValue / (1 + Math.exp(exponent));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// v167: 对应 lazer DiffUtils.Smoothstep
export function smoothstep(x: number, start: number, end: number): number {
  x = clamp((x - start) / (end - start), 0, 1);
  return x * x * (3 - 2 * x);
}

// v167: 对应 lazer DiffUtils.Smootherstep
export function smootherstep(x: number, start: number, end: number): number {
  x = clamp((x - start) / (end - start), 0, 1);
  return x * x * x * (x * (6 * x - 15) + 10);
}

// v167: 对应 lazer DiffUtils.SmoothstepBellCurve(x) (无参重载, RhythmEvaluator 用)
export function smoothstepBellCurve(x: number): number {
  x = 0.5 - Math.abs(x - 0.5);
  x = clamp(x * 2, 0, 1);
  return x * x * (3 - 2 * x);
}

// v167: 对应 lazer DiffUtils.ReverseLerp
export function reverseLerp(x: number, start: number, end: number): number {
  return clamp((x - start) / (end - start), 0, 1);
}

// v167: 对应 osu.Framework Utils.Interpolation.Lerp
export function lerp(start: number, final: number, amount: number): number {
  return start + (final - start) * amount;
}

// v167: 对应 lazer DiffUtils.BPMToMilliseconds (默认 1/4)
export function bpmToMilliseconds(bpm: number, delimiter = 4): number {
  return 60000 / delimiter / bpm;
}

// v167: 对应 lazer DiffUtils.MillisecondsToBPM (默认 1/4)
export function millisecondsToBPM(ms: number, delimiter = 4): number {
  return 60000 / (ms * delimiter);
}

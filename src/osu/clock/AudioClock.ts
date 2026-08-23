// AudioClock: 渲染与音频 offset < 1ms 的相位跟踪时钟
//
// 问题分析:
//  - AudioContext.currentTime 按 128 采样块量子化 (44.1kHz 下 ≈2.9ms), 其读数系统性
//    滞后真实音频位置 0~2.9ms, 直接用作渲染时钟必然超标;
//  - 人耳听到的声音还要再晚 outputLatency (通常 5~20ms), 渲染应对齐"可闻位置";
//  - 音频硬件时钟与性能计数器之间存在 ppm 级漂移, 需连续校正.
//
// 方案 (相位跟踪):
//  - 音频硬件时钟模型: hwSec(t) = t/1000 + c(t), c(t) 为缓变相位偏移 (含漂移斜坡);
//  - 每次 ctx.currentTime 量子跳变时取相位样本: φ = ctxV + Q/2 - t/1000
//    (量子滞后均匀分布于 [0,Q), 取中点 Q/2 使样本无偏), EMA 平滑得 ĉ ≈ c(t);
//  - 播放位置 = mapOffset + (hwSec(t) - hwSec(t_start)) × rate —— 相位估计误差为
//    共模量, 在起止点间抵消, 残余仅为 EMA 噪声差 (~0.2ms) 与斜坡跟踪延迟
//    (500ppm 极端漂移下 ~0.1ms), 总体稳定 < 1ms;
//  - heardNowMs() = rawNowMs() - outputLatency, 渲染对齐可闻位置;
//  - rawNowMs() / ctxTimeForMapTime() 供 hitsound 采样级排程.
//
// 时间源全部注入, 可在 Node 下用 Mock 做亚毫秒级单元测试.

export interface ClockTimeSources {
  /** AudioContext.currentTime (秒) */
  ctxNow(): number;
  /** performance.now() (毫秒) */
  perfNow(): number;
  /** 输出延迟 (秒): actx.outputLatency ?? actx.baseLatency ?? 0 */
  outputLatency(): number;
}

export interface AudioClockOptions {
  /** 相位 EMA 平滑系数 (0~1), 默认 0.08 */
  phaseSmoothing?: number;
  /** 渲染量子时长 (秒), 默认 128/44100 ≈ 2.9ms */
  quantumSec?: number;
  /** ctx 读数异常跳变阈值 (秒), 超过则重置相位跟踪, 默认 0.5 */
  jumpResetSec?: number;
}

export class AudioClock {
  /** 播放速率 (0.5 / 0.75 / 1.0) */
  rate = 1;
  running = false;

  private pausedTimeMs = 0;
  private mapOffsetMs = 0;
  private phaseStartSec = 0;

  private lastCtxV = -1;
  private phaseSec = NaN; // ĉ: hwSec(t) = t/1000 + ĉ 的 EMA 估计
  private readonly src: ClockTimeSources;
  private readonly k: number;
  private readonly quantumSec: number;
  private readonly jumpResetSec: number;

  constructor(src: ClockTimeSources, opts: AudioClockOptions = {}) {
    this.src = src;
    this.k = opts.phaseSmoothing ?? 0.08;
    this.quantumSec = opts.quantumSec ?? 128 / 44100;
    this.jumpResetSec = opts.jumpResetSec ?? 0.5;
  }

  /** 播放引擎在 source.start() 立即生效后调用 (锚点带相位估计残差, 优先用 onStartedAtCtxTime) */
  onStarted(mapOffsetMs: number) {
    this.trackPhase(); // 确保 ĉ 已初始化
    this.mapOffsetMs = mapOffsetMs;
    this.phaseStartSec = this.hwSec(this.src.perfNow());
    this.running = true;
  }

  /**
   * 确定性锚定: 播放引擎以 source.start(W, offset) 延迟数毫秒启动,
   * W 时刻谱面位置精确等于 offset (无相位估计残差), 全程误差仅剩 ĉ 噪声 (~0.2ms).
   */
  onStartedAtCtxTime(ctxW: number, mapOffsetMs: number) {
    this.trackPhase();
    this.mapOffsetMs = mapOffsetMs;
    this.phaseStartSec = ctxW; // hwSec 在 ctx 读数为 W 时精确等于 W
    this.running = true;
  }

  /** 暂停: 冻结当前精确位置, 返回该位置 */
  onStopped(): number {
    this.pausedTimeMs = this.rawNowMs();
    this.running = false;
    return this.pausedTimeMs;
  }

  /** 暂停态 seek */
  onSeekPaused(mapMs: number) {
    if (!this.running) this.pausedTimeMs = mapMs;
  }

  /** 当前暂停位置 */
  get pausedTime(): number { return this.pausedTimeMs; }

  /** 相位跟踪: 处理 ctx 量子跳变, 更新 ĉ (每帧调用幂等; 暂停中也应持续调用以预热) */
  trackPhase() {
    const v = this.src.ctxNow();
    const t = this.src.perfNow();
    if (v === this.lastCtxV) return;
    const sample = v + this.quantumSec / 2 - t / 1000;
    if (Number.isNaN(this.phaseSec) || (this.lastCtxV >= 0 && Math.abs(v - this.lastCtxV) > this.jumpResetSec)) {
      this.phaseSec = sample; // 初始化或异常跳变重置
    } else {
      this.phaseSec += this.k * (sample - this.phaseSec);
    }
    this.lastCtxV = v;
  }

  /** 当前硬件音频时钟估计 (秒) */
  private hwSec(perfT: number): number {
    return perfT / 1000 + this.phaseSec;
  }

  /**
   * 精确播放位置 (ms, 不含输出延迟补偿).
   * 相位估计误差在起止点共模抵消, 典型误差 < 0.5ms.
   */
  rawNowMs(): number {
    if (!this.running) return this.pausedTimeMs;
    this.trackPhase();
    const t = this.src.perfNow();
    return this.mapOffsetMs + (this.hwSec(t) - this.phaseStartSec) * 1000 * this.rate;
  }

  /** 人耳可闻位置 (ms): 渲染/时间轴应对齐此值 */
  heardNowMs(): number {
    return this.rawNowMs() - (this.running ? this.src.outputLatency() * 1000 : 0);
  }

  /**
   * 谱面时间 -> AudioContext 时间 (秒), 供 hitsound source.start(when) 排程.
   * 锚点 phaseStartSec 就是 source.start(W) 的 ctx 时刻, 故目标时刻本来就在
   * AudioContext 时钟线上, 直接使用即可, 与相位估计无关 (采样级, 无 EMA 噪声).
   * 切勿再减 phaseSec: 它是 perf 时钟与 ctx 时钟的原点差 (真实浏览器中
   * ≈ -(页面加载到 ctx 启动的秒数)), 误减会把所有 hitsound 统一推迟该时长.
   * 已过去的时刻返回 null.
   */
  ctxTimeForMapTime(mapMs: number): number | null {
    const atCtx = this.phaseStartSec + (mapMs - this.mapOffsetMs) / (1000 * this.rate);
    return atCtx >= this.src.ctxNow() ? atCtx : null;
  }

  /** 当前相位估计 (测试/诊断用) */
  get phaseEstimateSec(): number { return this.phaseSec; }
}

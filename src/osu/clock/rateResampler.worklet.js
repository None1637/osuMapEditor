// v382: 高质量变速变调重采样 AudioWorklet 处理器 (窗口 sinc 插值, 对齐 osu!stable BASS 语义:
// HT/慢放 = plain resample, 音高随速度下降; 非保时音高拉伸)。
//
// 背景: Chromium 的 AudioBufferSourceNode.playbackRate 重采样是低质量线性插值 —
// 实测 0.5x 下 10kHz 正弦杂散总量 -19dB / 峰值 -22dB (镜像+混叠折回可闻频段),
// 5kHz -31dB, 听感 = 各频率刺耳失真 (verifier/v382 基线)。本处理器用 48-tap
// Blackman 窗 sinc 插值, 镜像抑制 >70dB, 逼近理想重采样。
//
// 用法 (buffer 模式, 与 signalsmith-stretch 封装同语义):
//   - numberOfInputs: 0; 整首 PCM 经 port 'buffers' 消息移交 (transferable);
//   - 'schedule' {output, input, rate, active} 在 AudioContext 时间线上锚定
//     "谱面位置 ↔ 播放时刻", 语义同 AudioBufferSourceNode.start(when, offset):
//     output/input 为秒; 对称窗 => 零群延迟, output 帧精确对应 input 采样;
//     重复 schedule 直接重锚定 (变速/seek);
//   - 'stop' 停止发声; 播到缓冲尾发 'ended' 消息 (调用方另用定时器兜底)。
//
// 插值核: y(t) = Σ x[k]·c·sinc(c·(k-t))·blackman((k-t)/HALF), c = min(1, 1/step)
//   - 减速 (step<1): c=1 全带宽重建, 慢放的失真来自插值镜像, sinc 核直接压制;
//   - 加速 (step>1): c=1/step 抗混叠抽取, 通带增益保持 1 (Poisson 求和);
//   - 相位量化 2048 相 (最大相位误差 1/4096 采样 => 20kHz 处残余 <-70dB)。
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */

const HALF = 24;      // 单侧 tap 数 (共 48 taps)
const TAPS = 2 * HALF;
const PHASES = 2048;  // 相位量化级数

function buildTable(cutoff) {
  const table = new Float32Array(PHASES * TAPS);
  for (let p = 0; p < PHASES; p++) {
    const frac = p / PHASES;
    const row = p * TAPS;
    for (let k = -HALF + 1; k <= HALF; k++) {
      const x = k - frac;
      let h = 0;
      if (Math.abs(x) <= HALF) {
        const sx = cutoff * x;
        const sinc = sx === 0 ? 1 : Math.sin(Math.PI * sx) / (Math.PI * sx);
        // Blackman 窗
        const w = 0.42 + 0.5 * Math.cos(Math.PI * x / HALF) + 0.08 * Math.cos(2 * Math.PI * x / HALF);
        h = cutoff * sinc * w;
      }
      table[row + k + HALF - 1] = h;
    }
  }
  return table;
}

class RateResamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;   // Float32Array[] (源 PCM, 采样率 srcSr)
    this.srcSr = 48000;
    this.active = false;
    this.anchorFrame = 0;   // 锚点: 输出帧 (AudioContext 采样网格)
    this.anchorInput = 0;   // 锚点: 源位置 (源采样, 浮点)
    this.step = 1;          // 源采样/输出采样 = rate * srcSr/outSr
    this.cutoff = -1;
    this.table = null;
    this.endedSent = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'buffers') {
        this.channels = m.channels;
        this.srcSr = m.sampleRate;
        if (m.schedule) this.applySchedule(m.schedule); // 原子初始化 (离线渲染下背靠背消息可能丢失)
        this.port.postMessage({ type: 'buffers-acked' }); // 送达回执 (测量/调用方确认后再渲染)
      } else if (m.type === 'schedule') {
        this.applySchedule(m);
      } else if (m.type === 'stop') {
        this.active = false;
      }
    };
  }

  applySchedule(m) {
    const step = m.rate * this.srcSr / sampleRate;
    const c = Math.min(1, 1 / step);
    if (c !== this.cutoff) { this.cutoff = c; this.table = buildTable(c); }
    this.step = step;
    this.anchorFrame = Math.round(m.output * sampleRate);
    this.anchorInput = m.input * this.srcSr;
    this.active = m.active !== false;
    this.endedSent = false;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const nch = out.length;
    const N = out[0] ? out[0].length : 0;
    const chans = this.channels;
    if (!this.active || !chans || !this.table || N === 0) {
      for (let c = 0; c < nch; c++) out[c].fill(0);
      return true;
    }
    const len = chans[0].length;
    const step = this.step, table = this.table;
    const aF = this.anchorFrame, aI = this.anchorInput;
    const f0 = currentFrame;
    let ended = false;
    for (let i = 0; i < N; i++) {
      const f = f0 + i;
      const t = aI + (f - aF) * step;
      const on = f >= aF && t >= 0 && t <= len - 1;
      if (!on) {
        for (let c = 0; c < nch; c++) out[c][i] = 0;
        if (f >= aF && t > len - 1) ended = true;
        continue;
      }
      let i0 = Math.floor(t);
      let p = Math.round((t - i0) * PHASES);
      if (p >= PHASES) { i0++; p -= PHASES; }
      const row = p * TAPS;
      for (let c = 0; c < nch; c++) {
        const src = chans[c < chans.length ? c : chans.length - 1];
        let v = 0;
        for (let k = 1 - HALF; k <= HALF; k++) {
          const idx = i0 + k;
          if (idx >= 0 && idx < len) v += src[idx] * table[row + k + HALF - 1];
        }
        out[c][i] = v;
      }
    }
    if (ended && !this.endedSent) {
      this.endedSent = true;
      this.port.postMessage({ type: 'ended' });
    }
    return true;
  }
}

registerProcessor('osu-rate-resampler', RateResamplerProcessor);

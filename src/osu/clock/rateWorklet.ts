// v382: 高质量变速变调重采样节点封装 (窗口 sinc 插值 AudioWorklet).
// 背景: Chromium 的 AudioBufferSourceNode.playbackRate 是低质量线性插值重采样 —
// 实测 0.5x 下 10kHz 正弦杂散总量 -19dB / 峰值 -22dB (镜像+混叠折回可闻频段,
// 见 verifier/v382 基线)。本节点用 48-tap Blackman 窗 sinc 插值, 镜像抑制 >70dB,
// 对齐 osu!stable (BASS) 的 HT/慢放语义: 变速变调, 音高随速度下降, 频谱干净。
//
// 用法 (buffer 模式, 与 tempoWorklet.ts 的 signalsmith 封装同语义):
//   - numberOfInputs = 0, 整首 PCM 经 addBuffers 移交节点内部 (transferable);
//   - schedule({output, input, rate}) 在 AudioContext 时间线上锚定 "谱面位置 ↔ 播放时刻",
//     output/input 为秒, 语义同 AudioBufferSourceNode.start(when, offset);
//     对称窗 sinc => 零群延迟, 锚点采样级精确, 重复 schedule 直接重锚定 (变速/seek);
//   - stop() 停声; 播到缓冲尾节点发 'ended' port 消息 (调用方另用定时器兜底)。
import workletSrc from './rateResampler.worklet.js?raw';

/** schedule 的可调度参数 (秒/倍率) */
export interface RateSchedule {
  output?: number;  // AudioContext 时间线上的生效时刻
  input?: number;   // 输入缓冲内的位置 (谱面秒)
  rate?: number;    // 播放倍率 (0.5 = 半速, 音高降八度)
  active?: boolean; // 是否处理音频
}

/** 重采样节点: AudioWorkletNode + 扩展方法 (port 消息语义见 rateResampler.worklet.js) */
export interface RateNode extends AudioWorkletNode {
  schedule(obj: RateSchedule): void;
  stop(): void;
  addBuffers(channels: Float32Array[], sampleRate: number, transfer?: Transferable[]): void;
}

/** 创建重采样节点 (worklet 经 blob URL 注入, 无外部资源; 失败 reject, 调用方回退原生 playbackRate) */
export async function createRateNode(actx: AudioContext): Promise<RateNode> {
  const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
  try {
    await actx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(actx, 'osu-rate-resampler', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  }) as RateNode;
  node.schedule = (obj) => { node.port.postMessage({ type: 'schedule', ...obj }); };
  node.stop = () => { node.port.postMessage({ type: 'stop' }); };
  node.addBuffers = (channels, sampleRate, transfer) => {
    node.port.postMessage({ type: 'buffers', sampleRate, channels }, transfer ?? []);
  };
  return node;
}

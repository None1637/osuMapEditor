// signalsmith-stretch (WASM/AudioWorklet, MIT) 变速不变调节点封装.
// 官方 Web Audio 发布版: SignalsmithStretch(audioContext) 异步返回一个挂了扩展方法的
// AudioWorkletNode (WASM 内嵌 base64, 无外部资源; worklet 代码经 blob URL 自动注入).
//
// 用法 (buffer 模式): 整首 PCM 经 addBuffers 送入节点内部缓冲, **不连接输入**;
// schedule({output, input, rate}) 在 AudioContext 时间线上锚定 "谱面位置 ↔ 播放时刻":
//   - output/input 为秒, 锚点语义与 AudioBufferSourceNode.start(when, offset) 一致;
//   - 节点内部自补偿其处理延迟 (默认 preset 总延迟 120ms, latency() 可查询), 且每个
//     渲染块按时间映射重新定位输入, 锚点精确、全程无漂移
//     (实测冲激落点偏差 < 3ms, 含 0.25x 与仅提前 20ms 排程, 见 verifier/v60);
//   - schedule 会清除其后的所有排程, 变速/seek 直接重新锚定即可.
//
// 注意: 必须保持 numberOfInputs = 1 (默认) 且不连接任何输入 — 节点以此判定 buffer
// 模式; numberOfInputs = 0 会在其静音分支解引用空输入列表而崩溃 (官方实现细节).
import SignalsmithStretch from 'signalsmith-stretch';

/** schedule 的可调度参数 (signalsmith-stretch 文档子集, 秒/倍率) */
export interface TempoSchedule {
  output?: number;  // AudioContext 时间线上的生效时刻
  active?: boolean; // 是否处理音频
  input?: number;   // 输入缓冲内的位置 (谱面秒)
  rate?: number;    // 播放倍率 (0.5 = 半速)
}

/** signalsmith-stretch 创建的节点: AudioWorkletNode + 扩展方法 (包无 TS 声明, 见 src/types) */
export interface TempoNode extends AudioWorkletNode {
  schedule(obj: TempoSchedule): Promise<unknown>;
  start(when?: number, offset?: number, duration?: number, rate?: number): Promise<unknown>;
  stop(when?: number): Promise<unknown>;
  addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
  latency(): Promise<number>;
  inputTime: number;
}

/** 创建变速节点 (加载 WASM worklet; 失败 reject, 调用方回退 playbackRate 变调路径) */
export async function createTempoNode(actx: AudioContext): Promise<TempoNode> {
  const create = SignalsmithStretch as (a: AudioContext) => Promise<AudioWorkletNode>;
  return await create(actx) as TempoNode;
}

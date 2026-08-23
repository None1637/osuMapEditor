// signalsmith-stretch 官方包无 TS 声明; 实际节点类型见 src/osu/clock/tempoWorklet.ts 的 TempoNode
declare module 'signalsmith-stretch' {
  const create: (audioContext: AudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioWorkletNode>;
  export default create;
}

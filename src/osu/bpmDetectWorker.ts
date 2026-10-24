// v498: 自动 BPM 检测 worker 壳 — DSP 管线 (bpmDetect.ts) 在后台线程跑, 不卡 UI。
// 主线程把 AudioBuffer 各声道 PCM 以 Transferable 传入; 进度/结果 postMessage 返回。
import { detectBpm, extractConstantTempo } from './bpmDetect';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.type !== 'detect') return;
  try {
    const channels = m.channels as Float32Array[];
    const buf = {
      sampleRate: m.sampleRate as number,
      numberOfChannels: channels.length,
      length: m.length as number,
      getChannelData: (i: number) => channels[Math.min(i, channels.length - 1)],
    };
    const result = detectBpm(buf, { onProgress: (p, stage) => post({ type: 'progress', p, stage }) });
    // v498: 恒速提炼也在 worker 内完成 (1/8、1/6 细分碎段合并 → 单 BPM+offset)
    const constant = extractConstantTempo(result);
    post({ type: 'done', result: { beats: result.beats, segments: result.segments, constant } });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.name} ${e.message}` : String(e) });
  }
};

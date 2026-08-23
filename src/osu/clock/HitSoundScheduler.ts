// HitSoundScheduler: hitsound 采样级排程
// 维护未来 lookahead 窗口内的音效事件, 用 AudioBufferSourceNode.start(when) 精确排程,
// 避免 setTimeout/rAF 触发带来的 5~50ms 抖动; seek 过程中静音(lazer 同款行为).
import type { AudioClock } from './AudioClock';

export interface HitSoundEvent {
  /** 谱面时间 (ms) */
  mapTimeMs: number;
  /** 音效 stem (如 'soft-hitnormal'); 带自定义序号时为主候选 */
  soundId: string;
  /** 主候选无对应采样时的后备 stem 列表 */
  fallbacks?: string[];
  /** 0-100 (lazer: hitSample.volume 覆盖 timing point volume, 下限 5); 缺省 100 */
  volume?: number;
}

export interface HitSoundSink {
  /** 在指定 AudioContext 时间 (秒) 播放音效 */
  schedule(atCtxTimeSec: number, soundId: string, fallbacks?: string[], volume?: number): void;
}

export class HitSoundScheduler {
  private events: HitSoundEvent[] = [];
  /** 已排程的事件指针 (events 按时间排序, 指针左侧全部已处理) */
  private cursor = 0;
  private muted = false;
  lookaheadMs = 250;
  private readonly clock: AudioClock;
  private readonly sink: HitSoundSink;

  constructor(clock: AudioClock, sink: HitSoundSink) {
    this.clock = clock;
    this.sink = sink;
  }

  /** 设置事件表 (按 mapTimeMs 排序); seek/换谱时调用 */
  setEvents(events: HitSoundEvent[]) {
    this.events = events;
    this.cursor = 0;
  }

  /** seek 后调用: 跳过已过去的事件, 重新对准 */
  resync() {
    const now = this.clock.rawNowMs();
    this.cursor = 0;
    while (this.cursor < this.events.length && this.events[this.cursor].mapTimeMs < now - 5) {
      this.cursor++;
    }
  }

  /** seek 中静音 (lazer: seeking 时不播放采样) */
  setMuted(m: boolean) { this.muted = m; }

  /** 每帧调用 */
  tick() {
    if (!this.clock.running || this.muted) return;
    const horizon = this.clock.rawNowMs() + this.lookaheadMs;
    while (this.cursor < this.events.length && this.events[this.cursor].mapTimeMs <= horizon) {
      const ev = this.events[this.cursor++];
      const at = this.clock.ctxTimeForMapTime(ev.mapTimeMs);
      if (at !== null) this.sink.schedule(at, ev.soundId, ev.fallbacks, ev.volume);
    }
  }
}

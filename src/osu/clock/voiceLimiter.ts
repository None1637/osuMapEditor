// 采样并发上限 (纯函数, 可单测)
// lazer OsuGameBase.SAMPLE_CONCURRENCY = 6 (Audio.Samples.PlaybackConcurrency):
// 同一采样最多同时发声 6 个 voice, 超限时最老的让位 (BASS 采样并发语义).
// 没有上限时, 密集段同一 hitnormal 的长尾巴可叠十几层, 总线超满幅硬削波 (刺耳).
// v122: 只统计"发声中"的 voice — 编辑器 hitsound 会提前 ~250ms 预排程 (lookahead),
// 尚未发声的未来 voice 不占名额; 旧实现把预排程 voice 一并计入, 密集段 (如 180bpm 1/8)
// 名额被未来 voice 占满, 正在发声的 voice 一开口就被逐出瞬杀 => 听感近乎完全消音.

/** lazer OsuGameBase.SAMPLE_CONCURRENCY */
export const SAMPLE_CONCURRENCY = 6;

/** 已登记 voice: start/end = AudioContext 时间 (秒), end = 预计自然结束时刻 */
export interface VoiceEntry<V> { v: V; start: number; end: number }

/** 通用 voice 限流器: 按 key (采样 buffer) 维护 FIFO 队列; 与新 voice 同时发声的旧 voice 超上限时逐出最老 */
export class VoiceLimiter<K, V> {
  private queues = new Map<K, VoiceEntry<V>[]>();
  private readonly cap: number;

  constructor(cap = SAMPLE_CONCURRENCY) { this.cap = cap; }

  /** 登记新 voice; 返回需让位的最老 voice (在新 voice 发声时刻仍在发声且超上限者; 调用方负责淡出+停止) */
  register(key: K, v: V, start: number, end: number): VoiceEntry<V>[] {
    let q = this.queues.get(key);
    if (!q) this.queues.set(key, (q = []));
    const entry: VoiceEntry<V> = { v, start, end };
    q.push(entry);
    // 与新 voice 同时发声的旧 voice (e.start <= start < e.end), q 为 FIFO 序 => 队首最老
    const sounding = q.filter(e => e !== entry && e.start <= start && start < e.end);
    const evicted: VoiceEntry<V>[] = [];
    while (sounding.length + 1 > this.cap) {
      const old = sounding.shift()!;
      evicted.push(old);
      q.splice(q.indexOf(old), 1);
    }
    return evicted;
  }

  /** voice 结束 (自然播完/被停) 后注销; 已被逐出的 voice 不在队列中, 调用无效果 */
  release(key: K, v: V) {
    const q = this.queues.get(key);
    if (!q) return;
    const i = q.findIndex(e => e.v === v);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) this.queues.delete(key);
  }

  /** v122: 取出并清空全部 voice (暂停/换谱时停止所有发声中与已预排程未发声的 voice) */
  drain(): VoiceEntry<V>[] {
    const out: VoiceEntry<V>[] = [];
    for (const q of this.queues.values()) out.push(...q);
    this.queues.clear();
    return out;
  }

  count(key: K): number { return this.queues.get(key)?.length ?? 0; }

  totalCount(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  clear() { this.queues.clear(); }
}

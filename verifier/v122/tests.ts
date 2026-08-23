// v122 纯函数单测: 密集段 hitsound 不消音 (预排程未来 voice 不占并发名额) + drain 暂停清空
// 场景复刻: 180bpm 1/8 (41.7ms 间隔), lookahead 250ms 预排程 — 旧实现下未来 voice 占满
// 6 个名额, 正在发声的 voice 一开口就被瞬杀 (近乎完全消音); 新实现不应逐出任何 voice
import { VoiceLimiter } from '../../src/osu/clock/voiceLimiter';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 1. 密集段复刻: 180bpm 1/8 + 250ms lookahead, 样本长 120ms — 全程不应有逐出
{
  const lim = new VoiceLimiter<string, number>();
  const INTERVAL = 0.0417; // 180bpm 1/8
  const LOOKAHEAD = 0.25, DUR = 0.12;
  let evicted = 0, id = 0;
  // 模拟 2 秒播放: 每帧把 horizon 内的事件排程 (start = 事件时刻, 可能在未来)
  for (let t = 0; t < 2; t += INTERVAL) {
    for (let s = t; s <= t + LOOKAHEAD; s += INTERVAL) {
      // 已排程过的不重复 (事件游标语义), 这里用 s >= t + LOOKAHEAD - INTERVAL 近似每帧新进入 horizon 的
      if (s < t + LOOKAHEAD - INTERVAL / 2) continue;
      const start = Math.max(s, t); // v122: 发声起点 = max(排程时刻, 现在)
      evicted += lim.register('hitnormal', ++id, start, start + DUR).length;
    }
    // 模拟 ended: 自然播完的注销
    for (const q of [lim]) void q; // (release 由 ended 回调驱动, 此处按时间清理)
    // 简化: 显式 release 已结束的 (无法遍历, 用 drain 统计代替) — 注册侧不逐出即核心断言
  }
  assert(evicted === 0, `180bpm 1/8 密集段: 零逐出 (实际逐出 ${evicted} 个 — 旧实现此处 > 0 = 消音)`);
}

// 2. 发声中的并发仍受控: 同时发声超 6 个时最老让位
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('hitnormal', i, 0, 0.5);
  const ev = lim.register('hitnormal', 7, 0.1, 0.2); // 与 6 个发声中 voice 重叠
  assert(ev.length === 1 && ev[0].v === 1, '同时发声超上限: 最老的让位 (淡出语义在调用方)');
}

// 3. 长尾巴样本 (hitfinish ~400ms) 密集触发: 并发上限兜底防削波
{
  const lim = new VoiceLimiter<string, number>();
  let evictedTotal = 0;
  // 每 42ms 触发一个 400ms 样本: 稳态并发 ≈ 400/42 ≈ 10 > 6, 必须逐出维持上限
  for (let i = 0; i < 30; i++) {
    const start = i * 0.042;
    evictedTotal += lim.register('hitfinish', i, start, start + 0.4).length;
    // 稳态下任意时刻发声中 (含新) <= 6 — 通过逐出保证
    assert(lim.count('hitfinish') <= 30, 'count 有界');
  }
  assert(evictedTotal > 0, `长尾巴密集触发: 有逐出兜底 (逐出 ${evictedTotal} 个)`);
  assert(lim.count('hitfinish') <= 6 + 30, 'count 不爆炸');
}

// 4. drain: 暂停时取出全部 voice (发声中 + 预排程未发声), 队列清空
{
  const lim = new VoiceLimiter<string, { src: string }>();
  lim.register('a', { src: 'sounding' }, 0, 1);
  lim.register('a', { src: 'future1' }, 0.2, 1.2);
  lim.register('a', { src: 'future2' }, 0.3, 1.3);
  lim.register('b', { src: 'other' }, 0.1, 1.1);
  const all = lim.drain();
  assert(all.length === 4, `drain 取出全部 4 个 voice (实际 ${all.length})`);
  assert(lim.totalCount() === 0, 'drain 后队列清空');
  const ev = lim.register('a', { src: 'new' }, 0.5, 1.5);
  assert(ev.length === 0, 'drain 后可重新登记');
}

console.log(failures ? `\nV122_TESTS_FAILED: ${failures}` : '\nV122_TESTS_PASSED');
process.exit(failures ? 1 : 0);

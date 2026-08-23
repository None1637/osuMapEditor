// v101 纯函数单测: VoiceLimiter 并发上限语义 (lazer SAMPLE_CONCURRENCY=6)
// v122 起新语义: 只统计与新 voice 同时发声的旧 voice (预排程未来 voice 不占名额);
// register(key, v, start, end) start/end = 发声区间, 返回需让位的最老 voice
import { SAMPLE_CONCURRENCY, VoiceLimiter } from '../../src/osu/clock/voiceLimiter';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 1. 上限常量对齐 lazer
assert(SAMPLE_CONCURRENCY === 6, `SAMPLE_CONCURRENCY = 6 (实际 ${SAMPLE_CONCURRENCY})`);

// 2. 同时发声上限内不逐出
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) {
    const ev = lim.register('a', i, 0, 10); // 全部在 [0,10) 发声
    assert(ev.length === 0, `第 ${i} 个同时发声 voice 不逐出 (逐出 ${ev.length} 个)`);
  }
  assert(lim.count('a') === 6, `上限内 count = 6 (实际 ${lim.count('a')})`);
}

// 3. 同时发声超限逐出最老 (FIFO)
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 10);
  const ev = lim.register('a', 7, 1, 2); // 与 6 个旧 voice 同时发声
  assert(ev.length === 1 && ev[0].v === 1, `第 7 个 voice 逐出最老的 1 (实际 ${JSON.stringify(ev)})`);
  assert(lim.count('a') === 6, `逐出后 count 仍为 6 (实际 ${lim.count('a')})`);
  const ev2 = lim.register('a', 8, 1.5, 2);
  const ev3 = lim.register('a', 9, 1.5, 2);
  assert(ev2[0].v === 2 && ev3[0].v === 3, `FIFO 顺序: 逐出 2 再 3 (实际 ${ev2[0]?.v}, ${ev3[0]?.v})`);
}

// 4. 不重叠发声不互逐 (发声窗口错开)
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 1); // [0,1)
  const ev = lim.register('a', 7, 5, 6); // [5,6) 与全部旧 voice 不重叠
  assert(ev.length === 0, '发声窗口错开: 不逐出');
  assert(lim.count('a') === 7, '错开后 count = 7');
}

// 5. 部分重叠只逐重叠者 (边界: start 恰等于旧 end 不算同时发声)
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 1);
  const ev = lim.register('a', 7, 1, 2); // start=1 = 旧 voice end, 边界不算重叠
  assert(ev.length === 0, '边界相接 (start == 旧 end) 不算同时发声, 不逐出');
}

// 6. release 注销后腾出名额
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 10);
  lim.release('a', 3);
  assert(lim.count('a') === 5, `release 后 count = 5 (实际 ${lim.count('a')})`);
  const ev = lim.register('a', 7, 1, 2);
  assert(ev.length === 0, `release 腾名额后注册不逐出 (逐出 ${ev.length})`);
}

// 7. release 已被逐出/不存在的 voice: 无效果不报错
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 10);
  lim.register('a', 7, 1, 2); // 1 被逐出
  lim.release('a', 1); // 已逐出
  lim.release('a', 999); // 不存在
  assert(lim.count('a') === 6, `无效 release 不影响 count (实际 ${lim.count('a')})`);
}

// 8. 不同 key (不同采样 buffer) 互不影响
{
  const lim = new VoiceLimiter<string, number>();
  for (let i = 1; i <= 6; i++) lim.register('a', i, 0, 10);
  const ev = lim.register('b', 100, 0, 10);
  assert(ev.length === 0 && lim.count('b') === 1, '不同 key 独立计数');
  assert(lim.totalCount() === 7, `totalCount = 7 (实际 ${lim.totalCount()})`);
}

// 9. clear 清空 / 空队列自动回收
{
  const lim = new VoiceLimiter<string, number>();
  lim.register('a', 1, 0, 1); lim.register('b', 2, 0, 1);
  lim.clear();
  assert(lim.totalCount() === 0 && lim.count('a') === 0, 'clear 后全空');
  lim.register('a', 1, 0, 1);
  lim.release('a', 1);
  assert(lim.count('a') === 0, 'release 到 0 (key 自动回收)');
  const ev = lim.register('a', 2, 0, 1);
  assert(ev.length === 0 && lim.count('a') === 1, '回收后可重新注册');
}

if (failures) { console.error(`\nV101_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV101_TESTS_PASSED');

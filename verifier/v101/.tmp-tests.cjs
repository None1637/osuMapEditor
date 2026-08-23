// src/osu/clock/voiceLimiter.ts
var SAMPLE_CONCURRENCY = 6;
var VoiceLimiter = class {
  queues = /* @__PURE__ */ new Map();
  cap;
  constructor(cap = SAMPLE_CONCURRENCY) {
    this.cap = cap;
  }
  /** 登记新 voice; 返回被逐出的最老 voice 列表 (调用方负责停止它们) */
  register(key, voice) {
    let q = this.queues.get(key);
    if (!q) this.queues.set(key, q = []);
    q.push(voice);
    const evicted = [];
    while (q.length > this.cap) evicted.push(q.shift());
    return evicted;
  }
  /** voice 结束 (自然播完/被停) 后注销; 已被逐出的 voice 不在队列中, 调用无效果 */
  release(key, voice) {
    const q = this.queues.get(key);
    if (!q) return;
    const i = q.indexOf(voice);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) this.queues.delete(key);
  }
  count(key) {
    return this.queues.get(key)?.length ?? 0;
  }
  totalCount() {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }
  clear() {
    this.queues.clear();
  }
};

// verifier/v101/tests.ts
var failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  } else console.log("  ok:", msg);
}
assert(SAMPLE_CONCURRENCY === 6, `SAMPLE_CONCURRENCY = 6 (\u5B9E\u9645 ${SAMPLE_CONCURRENCY})`);
{
  const lim = new VoiceLimiter();
  for (let i = 1; i <= 6; i++) {
    const ev = lim.register("a", i);
    assert(ev.length === 0, `\u7B2C ${i} \u4E2A voice \u4E0D\u9010\u51FA (\u9010\u51FA ${ev.length} \u4E2A)`);
  }
  assert(lim.count("a") === 6, `\u4E0A\u9650\u5185 count = 6 (\u5B9E\u9645 ${lim.count("a")})`);
}
{
  const lim = new VoiceLimiter();
  for (let i = 1; i <= 6; i++) lim.register("a", i);
  const ev = lim.register("a", 7);
  assert(ev.length === 1 && ev[0] === 1, `\u7B2C 7 \u4E2A voice \u9010\u51FA\u6700\u8001\u7684 1 (\u5B9E\u9645 ${JSON.stringify(ev)})`);
  assert(lim.count("a") === 6, `\u9010\u51FA\u540E count \u4ECD\u4E3A 6 (\u5B9E\u9645 ${lim.count("a")})`);
  const ev2 = lim.register("a", 8);
  const ev3 = lim.register("a", 9);
  assert(ev2[0] === 2 && ev3[0] === 3, `FIFO \u987A\u5E8F: \u9010\u51FA 2 \u518D 3 (\u5B9E\u9645 ${ev2[0]}, ${ev3[0]})`);
}
{
  const lim = new VoiceLimiter();
  for (let i = 1; i <= 6; i++) lim.register("a", i);
  lim.release("a", 3);
  assert(lim.count("a") === 5, `release \u540E count = 5 (\u5B9E\u9645 ${lim.count("a")})`);
  const ev = lim.register("a", 7);
  assert(ev.length === 0, `release \u817E\u540D\u989D\u540E\u6CE8\u518C\u4E0D\u9010\u51FA (\u9010\u51FA ${ev.length})`);
}
{
  const lim = new VoiceLimiter();
  for (let i = 1; i <= 7; i++) lim.register("a", i);
  lim.release("a", 1);
  lim.release("a", 999);
  assert(lim.count("a") === 6, `\u65E0\u6548 release \u4E0D\u5F71\u54CD count (\u5B9E\u9645 ${lim.count("a")})`);
}
{
  const lim = new VoiceLimiter();
  for (let i = 1; i <= 6; i++) lim.register("a", i);
  const ev = lim.register("b", 100);
  assert(ev.length === 0 && lim.count("b") === 1, "\u4E0D\u540C key \u72EC\u7ACB\u8BA1\u6570");
  assert(lim.totalCount() === 7, `totalCount = 7 (\u5B9E\u9645 ${lim.totalCount()})`);
}
{
  const lim = new VoiceLimiter();
  lim.register("a", 1);
  lim.register("b", 2);
  lim.clear();
  assert(lim.totalCount() === 0 && lim.count("a") === 0, "clear \u540E\u5168\u7A7A");
}
{
  const lim = new VoiceLimiter();
  lim.register("a", 1);
  lim.release("a", 1);
  assert(lim.count("a") === 0, "release \u5230 0");
  const ev = lim.register("a", 2);
  assert(ev.length === 0 && lim.count("a") === 1, "\u56DE\u6536\u540E\u53EF\u91CD\u65B0\u6CE8\u518C");
}
if (failures) {
  console.error(`
V101_TESTS_FAILED: ${failures} \u5904\u5931\u8D25`);
  process.exit(1);
}
console.log("\nV101_TESTS_PASSED");

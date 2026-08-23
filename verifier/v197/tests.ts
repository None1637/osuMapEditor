// v197: 滑条时长帧级 memo (播放性能优化) — 正确性: 同帧缓存/跨帧指纹失效/物件 time/length/slides 变化失效
import { sliderDurationMemo, beginLifecycleFrame, hitObjectDuration, hitObjectEndTime } from '../../src/osu/lifecycle';
import { sliderVelocityAt, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.error(`  FAIL ${msg}`); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const tp = (time: number, beatLength: number, uninherited: boolean): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const slider = (id: number, time: number, length = 200, slides = 1): HitObject => ({
  id, type: 'slider', x: 256, y: 192, time, curveType: 'L', curvePoints: [{ x: 300, y: 192 }], slides, length,
} as HitObject);

const expectDur = (points: TimingPoint[], mult: number, o: HitObject) => {
  const vel = sliderVelocityAt(points, o.time, mult);
  return vel > 0 ? ((o.length ?? 0) / vel) * (o.slides ?? 1) : 0;
};

// ---- T1: 值与非 memo 路径一致 ----
{
  const points = [tp(0, 500, true), tp(1000, -50, false), tp(2000, -100, false)];
  const o = slider(1, 1500); // SV 2.0 区间
  beginLifecycleFrame();
  const d = sliderDurationMemo(points, 1.4, o);
  assert(near(d, expectDur(points, 1.4, o)), `T1 值与非 memo 一致 (${d})`);
  assert(near(d, 200 / 0.56), 'T1 SV2.0: vel=0.56 px/ms, 200px → 357.14ms');
}

// ---- T2: 同帧重复调用走缓存 (结果相同) ----
{
  const points = [tp(0, 500, true), tp(1000, -50, false)];
  const o = slider(2, 1200);
  beginLifecycleFrame();
  const a = sliderDurationMemo(points, 1.4, o);
  const b = sliderDurationMemo(points, 1.4, o);
  assert(a === b, 'T2 同帧两次调用结果一致');
}

// ---- T3: timing 内容变化 → 跨帧失效 ----
{
  const points = [tp(0, 500, true), tp(1000, -50, false)];
  const o = slider(3, 1500);
  beginLifecycleFrame();
  const before = sliderDurationMemo(points, 1.4, o);
  points.push(tp(1400, -100, false)); // 原地加绿线 SV 1.0
  beginLifecycleFrame(); // 模拟下一帧 (应用里任何修改都会触发重绘)
  const after = sliderDurationMemo(points, 1.4, o);
  assert(near(before, 200 / 0.56) && near(after, 200 / 0.28), `T3 加绿线后时长 357.14→714.29 (实际 ${before}→${after})`);
}

// ---- T4: 物件 time/length/slides 变化 → 同帧也失效 ----
{
  const points = [tp(0, 500, true), tp(1000, -50, false), tp(2000, -100, false)];
  const o = slider(4, 1500);
  beginLifecycleFrame();
  const d1 = sliderDurationMemo(points, 1.4, o);
  o.length = 400;
  const d2 = sliderDurationMemo(points, 1.4, o);
  assert(near(d2, d1 * 2), `T4 length 翻倍 → 时长翻倍 (${d1}→${d2})`);
  o.slides = 2;
  const d3 = sliderDurationMemo(points, 1.4, o);
  assert(near(d3, d2 * 2), `T4 slides 翻倍 → 时长翻倍 (${d2}→${d3})`);
  o.time = 2500; // SV 1.0 区间
  const d4 = sliderDurationMemo(points, 1.4, o);
  assert(near(d4, 400 / 0.28 * 2), `T4 time 移到 SV1.0 区 → vel 变化 (${d4})`);
}

// ---- T5: hitObjectDuration / hitObjectEndTime 走 memo 后语义不变 ----
{
  const bm = {
    hitObjects: [], timingPoints: [tp(0, 500, true), tp(1000, -50, false)],
    difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {},
  } as unknown as Beatmap;
  const o = slider(5, 1500, 200, 2);
  beginLifecycleFrame();
  assert(near(hitObjectDuration(bm, o), 200 / 0.56 * 2), `T5 duration = 714.29ms (实际 ${hitObjectDuration(bm, o)})`);
  assert(near(hitObjectEndTime(bm, o), 1500 + 200 / 0.56 * 2), 'T5 endTime = time + duration');
}

console.log(failures ? `\nV197_TESTS_FAILED: ${failures}` : '\nV197_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v287 数值测试: 测试游玩判定/计分/会话状态机 (lazer 移植公式)
// 判定窗 OsuHitWindows / 计分血量 Judgement / combo HitResult.AffectsCombo / 转盘 Spinner / 会话判定流
import { hitWindows, judgeDelta, spinnerRequired, spinnerResult, TestScore } from '../../src/osu/gameplay/judgement';
import { TestPlaySession, TESTPLAY_LEAD_BACK } from '../../src/osu/gameplay/testPlaySession';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited = true): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const obj = (id: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x: 256, y: 192, time, ...extra,
} as HitObject);
const mkBm = (hitObjects: HitObject[], difficulty: Record<string, number> = {}): Beatmap => ({
  hitObjects, timingPoints: [tp(0, 500)],
  difficulty: { cs: 4, od: 5, sliderMultiplier: 1.4, sliderTickRate: 1, ...difficulty },
  editor: {}, general: {}, metadata: {},
} as unknown as Beatmap);

section('判定窗 (lazer OsuHitWindows: floor(DR)-0.5)');
{
  const w5 = hitWindows(5);
  assert(w5.great === 49.5 && w5.ok === 99.5 && w5.meh === 149.5 && w5.miss === 400, 'OD5: 49.5/99.5/149.5/400');
  const w10 = hitWindows(10);
  assert(w10.great === 19.5 && w10.ok === 59.5 && w10.meh === 99.5, 'OD10: 19.5/59.5/99.5');
  const w0 = hitWindows(0);
  assert(w0.great === 79.5 && w0.ok === 139.5 && w0.meh === 199.5, 'OD0: 79.5/139.5/199.5');
}

section('judgeDelta (过早/过晚 null = 不判定)');
{
  const w = hitWindows(5);
  assert(judgeDelta(0, w) === 'great' && judgeDelta(-49.5, w) === 'great', '±49.5 内 great');
  assert(judgeDelta(80, w) === 'ok' && judgeDelta(-99.5, w) === 'ok', 'ok 区间');
  assert(judgeDelta(120, w) === 'meh' && judgeDelta(149.5, w) === 'meh', 'meh 区间');
  assert(judgeDelta(149.6, w) === null && judgeDelta(-200, w) === null, '超出 meh → null');
}

section('TestScore (lazer 数值/combo/血量)');
{
  const s = new TestScore();
  s.apply('great');
  assert(s.combo === 1 && s.baseScore === 300 && s.maxBaseScore === 300 && s.hp === 1 && s.accuracy === 1, 'great: combo1/300/acc1');
  assert(s.score === 1_000_000, '全 great → 标准分 100 万');
  s.apply('smallTickHit');
  assert(s.combo === 1 && s.baseScore === 310, '小 tick 不影响 combo (lazer AffectsCombo=false), +10 分');
  s.apply('largeTickMiss');
  assert(s.combo === 0, 'repeat miss 断 combo (LargeTickMiss AffectsCombo=true)');
  const hp0 = s.hp;
  s.apply('miss');
  assert(Math.abs(s.hp - (hp0 - 0.10)) < 1e-9 && s.counts.miss === 1, 'miss: HP -0.10, miss 计数');
  const s2 = new TestScore();
  s2.prefill('great');
  assert(s2.combo === 1 && s2.baseScore === 300 && s2.counts.great === 1 && s2.accuracy === 1, 'prefill 满分预填 (lazer markPreviousObjectsHit)');
}

section('转盘 (lazer Spinner: CLEAR_RPM(90,150,225) / 结束判定)');
{
  const r = spinnerRequired(5, 1000);
  assert(r.spinsRequired === 2 && r.maxBonusSpins === 2, 'OD5 1s: 需 2 圈, bonus 2');
  const r2 = spinnerRequired(5, 3000);
  assert(r2.spinsRequired === 7, 'OD5 3s: 需 7 圈 (int 截断)');
  assert(spinnerResult(1) === 'great' && spinnerResult(1.5) === 'great', 'progress≥1 great');
  assert(spinnerResult(0.95) === 'ok' && spinnerResult(0.8) === 'meh' && spinnerResult(0.75) === 'miss', '>0.9 ok / >0.75 meh / else miss');
}

section('会话: 单点判定流 (过早忽略/准时 great/超时 miss 断 combo)');
{
  const bm = mkBm([obj(1, 5000, { x: 100, y: 100 }), obj(2, 5500, { x: 300, y: 100 })]);
  const s = new TestPlaySession(bm, 0);
  assert(s.startTime === 0, 'editorTime≤首物件 → 从头开始 (lazer gameplayStart 语义)');
  s.hit(4800, { x: 100, y: 100 });
  assert(s.score.combo === 0 && s.score.baseScore === 0, '过早点击忽略 (lazer DrawableHitCircle)');
  s.hit(4800, { x: 500, y: 300 });
  assert(s.score.combo === 0, '光标不在半径内不判');
  s.hit(5010, { x: 100, y: 100 });
  assert(s.score.combo === 1 && s.score.counts.great === 1, '准时点击 great');
  assert(s.popups.length === 1 && s.popups[0].result === 'great' && s.popups[0].x === 100, '弹出 300 于物件处');
  s.update(5500 + 160, { x: 0, y: 0 }, false);
  assert(s.score.combo === 0 && s.score.counts.miss === 1, '过 meh 窗口未点 → miss 断 combo');
}

section('会话: prefill (editorTime 前物件满分预填, lead-back 3s)');
{
  const bm = mkBm([obj(1, 5000, { x: 100, y: 100 }), obj(2, 9000, { x: 300, y: 100 })]);
  const s = new TestPlaySession(bm, 5400);
  assert(s.startTime === 5400 - TESTPLAY_LEAD_BACK, 'startTime = editorTime - 3000');
  assert(s.score.counts.great === 1 && s.score.combo === 1, 'c1 prehit 满分预填 (lazer markPreviousObjectsHit)');
  assert(s.renderInfo().get(1)!.state === 'prehit' && s.renderInfo().get(2)!.state === 'pending', 'prehit/pending 状态');
  s.update(5400, { x: 0, y: 0 }, false);
  assert(s.score.counts.miss === 0, 'prehit 物件经过不判 Miss (lazer preventMissOnPreviousHitObjects)');
}

section('会话: 滑条 head/tick/tail 跟踪判定 (lazer tracking = 2.4r 内 + 按住)');
{
  const bm = mkBm([
    obj(1, 7000, { type: 'slider', x: 100, y: 100, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 } as Partial<HitObject>),
  ]);
  const s = new TestPlaySession(bm, 0);
  // vel = 100*1.4/500 = 0.28 px/ms → span 714.29ms; tickDistance=140 → tick@7500 位置 (240,100); tail@7714 判于 7678
  s.hit(7000, { x: 100, y: 100 });
  assert(s.score.counts.great === 1, '滑条头点击 great');
  s.update(7501, { x: 240, y: 100 }, true); // 球在 (240,100), 光标按住 → tracking → tick hit
  assert(s.score.baseScore === 310, 'tick 跟踪命中 +10 (实际 ' + s.score.baseScore + ')');
  assert(s.renderInfo().get(1)!.tracking === true, '2.4r 内按住 → tracking');
  s.update(7680, { x: 100, y: 300 }, true); // 光标远离球 → tail miss
  assert(s.score.baseScore === 310, '尾未跟踪 → sliderTailMiss 不得分 (实际 ' + s.score.baseScore + ')');
  s.update(7720, { x: 0, y: 0 }, false);
  assert(s.renderInfo().get(1)!.state === 'done', '滑条结束 done');
  // 对照: 全程不跟踪 → tick miss (smallTickMiss 不断 combo)
  const s2 = new TestPlaySession(bm, 0);
  s2.hit(7000, { x: 100, y: 100 });
  s2.update(7501, { x: 0, y: 0 }, false);
  assert(s2.score.combo === 1 && s2.score.baseScore === 300, 'tick miss 不断 combo 不得分');
  // 头 miss 不阻止后续跟踪 (lazer 同款)
  const s3 = new TestPlaySession(bm, 0);
  s3.update(7160, { x: 0, y: 0 }, false); // 头超 meh 窗
  assert(s3.score.counts.miss === 1, '头超时 miss');
  s3.update(7501, { x: 240, y: 100 }, true);
  assert(s3.score.baseScore === 10, '头 miss 后 tick 仍可跟踪命中');
}

section('会话: 转盘摇转 (光标绕心累计转角 → 圈 tick + 结束判定)');
{
  const bm = mkBm([obj(1, 9000, { type: 'spinner', x: 256, y: 192, endTime: 10000 } as Partial<HitObject>)]);
  const s = new TestPlaySession(bm, 0);
  for (let t = 9000; t <= 10000; t += 25) { // 1s 摇 3 圈 (需 2 圈)
    const th = ((t - 9000) / 1000) * 3 * 2 * Math.PI;
    s.update(t, { x: 256 + 100 * Math.cos(th), y: 192 + 100 * Math.sin(th) }, false);
  }
  s.update(10001, { x: 256, y: 192 }, false);
  assert(s.score.counts.great === 1, '3/2 圈 → progress≥1 → great');
  assert(s.score.baseScore === 300 + 30, `3 圈 tick +30 (实际 ${s.score.baseScore})`);
  // 对照: 不摇 → miss
  const s2 = new TestPlaySession(bm, 0);
  s2.update(10001, { x: 256, y: 192 }, false);
  assert(s2.score.counts.miss === 1 && s2.score.baseScore === 0, '不摇 → miss');
}

if (failures) { console.error(`\nV287_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV287_TESTS_PASSED');

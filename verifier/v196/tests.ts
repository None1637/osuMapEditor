// v196: paste 取整 round → floor — 与底部时间戳 fmt (floor) 一致, 显示 55749 粘贴就落 55749
// 复现布景: 节拍吸附经红线 1665 (422.535211267606ms/拍) 走 128 拍得 currentTime=55749.507 (显示 0:55.749),
// 复制 15186 的绿线粘贴 — 旧逻辑 Math.round(55749.507)=55750, 与显示/目标既有线 55749 差 1ms
import { store } from '../../src/osu/store';
import { sliderVelocityAt, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra,
});
const obj = (id: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x: 256, y: 192, time, ...extra,
} as HitObject);

function reset(hitObjects: HitObject[], timingPoints: TimingPoint[]) {
  store.beatmap = { hitObjects, timingPoints, difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {} } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
}

const BL = 422.535211267606; // 142 BPM
const SNAP_T = 1665 + 128 * BL; // 55749.507 — 显示 floor 为 0:55.749

section('v196 复现: 节拍吸附时刻 55749.507 粘贴绿线应落 55749 (显示时刻), 不是 55750');
{
  reset([], [tp(1665, BL, true), tp(15186, -25, false), tp(55749, -50, false)]);
  store.selectedGreenLines.add(15186);
  store.copy();
  store.paste(SNAP_T);
  const bm = store.beatmap!;
  const greens = bm.timingPoints.filter(p => !p.uninherited);
  assert(greens.length === 2, `绿线总数不变 (覆盖既有 55749, 不新增 55750) — 实际 ${greens.length} 条: [${greens.map(g => g.time)}]`);
  const g55749 = greens.find(g => g.time === 55749)!;
  assert(!!g55749 && g55749.beatLength === -25, `55749 的绿线被覆盖为 -25 (实际 ${g55749?.beatLength})`);
  assert(!greens.some(g => g.time === 55750), '不存在 55750 的错位绿线');
  assert(store.selectedGreenLines.has(55749), '粘贴结果选中键 = 55749');
}

section('v196: 同刻物件+绿线粘贴仍严格相等 (v113 语义保持, floor 同路径)');
{
  reset(
    [obj(11, 1000, { type: 'slider', curveType: 'L', curvePoints: [{ x: 356, y: 192 }], slides: 1, length: 100 } as Partial<HitObject>)],
    [tp(0, 500, true), tp(1000, -50, false)],
  );
  store.selected.add(11);
  store.selectedGreenLines.add(1000);
  store.copy();
  store.paste(10000.6); // 小数 ≥0.5 — round 会到 10001, floor 到 10000 (与显示一致)
  const bm = store.beatmap!;
  const pasted = bm.hitObjects.find(o => o.id !== 11)!;
  const pastedGreen = bm.timingPoints.find(p => !p.uninherited && p.time === 10000);
  assert(pasted.time === 10000, `滑条 floor 到 10000 (实际 ${pasted.time})`);
  assert(!!pastedGreen && pastedGreen.beatLength === -50, '同刻 10000 存在粘贴的绿线');
  const vel = sliderVelocityAt(bm.timingPoints, pasted.time, 1.4);
  const expect = (100 * 1.4 * 2) / 500;
  assert(Math.abs(vel - expect) < 1e-9, `滑条吃到新绿线 SV 2.0 (vel=${vel}, 期望 ${expect})`);
}

section('v196: 物件粘贴 floor 恒 ≤ 放置 round — 不会落到同刻绿线之前 (SV 取错方向不可能)');
{
  for (const f of [55749.1, 55749.507, 55749.9, 55750.0, 55750.4]) {
    const floor = Math.floor(f), round = Math.round(f);
    assert(round >= floor, `round(${f})=${round} ≥ floor=${floor}`);
  }
}

console.log(failures ? `\nV196_TESTS_FAILED: ${failures}` : '\nV196_TESTS_PASSED');
process.exit(failures ? 1 : 0);

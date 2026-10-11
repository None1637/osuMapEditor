// v196: paste 取整 round → floor — 与底部时间戳 fmt (floor) 一致, 显示 55749 粘贴就落 55749
// v380 适配: 取整规则统一回 round (与 finishSlider/圆圈/转盘等放置入口一致) — 修复「复制粘贴放置的物件
//   与期望吸附点偏差 1ms」(非整节拍 tick 55749.507: 点击放置落 55750, v196 的 floor 粘贴落 55749)。
//   本文件的 floor 期望全部改为 round 期望; v113 语义 (物件与绿线同刻) 保持不变。
// 复现布景: 节拍吸附经红线 1665 (422.535211267606ms/拍) 走 128 拍得 currentTime=55749.507,
// 复制 15186 的绿线粘贴 — round 落 55750 (与点击放置同刻); v196 时代 floor 落 55749 (对齐 floor 显示)。
import { store } from '../../src/osu/store';
import { sliderVelocityAt, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';
import { snapPlacementTime } from '../../src/osu/sliderPath'; // v380 适配: 期望 = round(吸附锚点)

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
const SNAP_T = 1665 + 128 * BL; // 55749.507 — round 55750 (v380: 与放置一致), floor 55749 (v196 旧语义)

section('v380 适配: 节拍吸附时刻 55749.507 粘贴绿线落 55750 (round, 与放置同刻), 不再落 55749');
{
  reset([], [tp(1665, BL, true), tp(15186, -25, false), tp(55750, -50, false)]);
  store.selectedGreenLines.add(15186);
  store.copy();
  store.paste(SNAP_T);
  const bm = store.beatmap!;
  const greens = bm.timingPoints.filter(p => !p.uninherited);
  assert(greens.length === 2, `绿线总数不变 (覆盖既有 55750, 不新增 55749) — 实际 ${greens.length} 条: [${greens.map(g => g.time)}]`);
  const g55750 = greens.find(g => g.time === 55750)!;
  assert(!!g55750 && g55750.beatLength === -25, `55750 的绿线被覆盖为 -25 (实际 ${g55750?.beatLength})`);
  assert(!greens.some(g => g.time === 55749), '不存在 55749 的错位绿线 (v196 时代的 floor 落点)');
  assert(store.selectedGreenLines.has(55750), '粘贴结果选中键 = 55750');
}

section('v380 适配: 同刻物件+绿线粘贴仍严格相等 (v113 语义保持, round 同路径)');
{
  reset(
    [obj(11, 1000, { type: 'slider', curveType: 'L', curvePoints: [{ x: 356, y: 192 }], slides: 1, length: 100 } as Partial<HitObject>)],
    [tp(0, 500, true), tp(1000, -50, false)],
  );
  store.selected.add(11);
  store.selectedGreenLines.add(1000);
  store.copy();
  store.paste(10000.6); // v357 锚点先吸附: 10000.6 -> 10000 (整格, round==floor); 物件/绿线仍同刻
  const bm = store.beatmap!;
  const pasted = bm.hitObjects.find(o => o.id !== 11)!;
  const pastedGreen = bm.timingPoints.find(p => !p.uninherited && p.time === 10000);
  assert(pasted.time === 10000, `滑条落 10000 (吸附锚点取整; 实际 ${pasted.time})`);
  assert(!!pastedGreen && pastedGreen.beatLength === -50, '同刻 10000 存在粘贴的绿线');
  const vel = sliderVelocityAt(bm.timingPoints, pasted.time, 1.4);
  const expect = (100 * 1.4 * 2) / 500;
  assert(Math.abs(vel - expect) < 1e-9, `滑条吃到新绿线 SV 2.0 (vel=${vel}, 期望 ${expect})`);
}

section('v380: 物件粘贴 round == 放置 round — 与同刻粘贴的绿线严格相等 (SV 方向不取错)');
{
  // 多档小数时刻粘贴: 物件与绿线均落 round(at), 二者恒等 => timingAt(p.time <= time) 必取到同刻绿线
  for (const f of [10000.1, 10000.507, 10000.9, 10001.0, 10001.4]) {
    reset([obj(11, 1000)], [tp(0, 500, true), tp(1000, -50, false)]);
    store.selected.add(11);
    store.selectedGreenLines.add(1000);
    store.copy();
    store.paste(f);
    const bm = store.beatmap!;
    const pasted = bm.hitObjects.find(o => o.id !== 11)!;
    const pastedGreen = bm.timingPoints.find(p => !p.uninherited && p.time !== 1000 && p.time === pasted.time);
    // 期望 = round(吸附锚点) — 与点击放置同一公式 (放置落点 = Math.round(snapPlacementTime(...)))
    const expect = Math.round(snapPlacementTime(bm.timingPoints, f, 4));
    assert(pasted.time === expect && !!pastedGreen,
      `粘贴 @${f}: 物件 ${pasted.time} == round(吸附) ${expect} 且同刻绿线存在`);
  }
}

console.log(failures ? `\nV196_TESTS_FAILED: ${failures}` : '\nV196_TESTS_PASSED');
process.exit(failures ? 1 : 0);

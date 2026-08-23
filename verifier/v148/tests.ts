// 验证器 v148 纯函数测试: ① SV 不被红线重置 (lazer ControlPointInfo 分表独立查询)
//                        ② 滑条路径末端延长到 expectedLength (lazer SliderPath.calculateLength)
import { svPointAt, sliderVelocityAt, svMultiplierAt, timingAt, type TimingPoint } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) < eps; }

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 } as TimingPoint);
const green = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 } as TimingPoint);

section('svPointAt: 红线不清除 SV (修复核心 bug)');
{
  // 绿线@1000 SV=2 (-50), 红线@2000 (250ms) — 红线之后 SV 仍为 2
  const pts = [red(0, 500), green(1000, -50), red(2000, 250)];
  const g = svPointAt(pts, 3000);
  assert(g !== null && g.beatLength === -50, '红线后 svPointAt 仍返回绿线 (旧 timingAt 会清零)');
  // 对照: timingAt 的 green 在红线后清零 (采样语义, 保持不变)
  assert(timingAt(pts, 3000).green === null, 'timingAt.green 采样语义不变 (红线后清零)');
  // sliderVelocityAt: 100 * 1 * 2 / 250 = 0.8 px/ms (旧: SV 丢失误算 0.4)
  const vel = sliderVelocityAt(pts, 3000, 1);
  assert(near(vel, 0.8), `红线后速度 0.8 px/ms (实际 ${vel})`);
  assert(near(svMultiplierAt(pts, 3000, 1), 5), `svMultiplierAt = 2 * 1 * 250/100 = 5 (实际 ${svMultiplierAt(pts, 3000, 1)})`);
}

section('svPointAt: 边界');
{
  const pts = [red(0, 500), green(1000, -50), green(2000, -100)];
  assert(svPointAt(pts, 500) === null, '首条绿线前无 SV');
  assert(svPointAt(pts, 1500)?.beatLength === -50, '取最近绿线');
  assert(svPointAt(pts, 2500)?.beatLength === -100, '后一条绿线覆盖 (SV 回 1)');
  assert(svPointAt([], 0) === null, '空表');
}

section('SliderPath 末端延长: expectedLength > 几何全长时沿末端切线延长');
{
  // 直线 100px, expected 150 → 延长到 (150,0)
  const p = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 150);
  assert(near(p.totalLength, 150, 0.01), `totalLength=150 (实际 ${p.totalLength})`);
  const end = p.positionAt(150);
  assert(near(end.x, 150, 0.5) && near(end.y, 0, 0.5), `尾端 (150,0) (实际 ${end.x.toFixed(1)},${end.y.toFixed(1)})`);
  // 折线: 沿末段方向延长 ((0,0)->(100,0)->(100,100), 几何 200, expected 250 → 尾 (100,150))
  const q = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 250);
  assert(near(q.totalLength, 250, 0.01), `折线 totalLength=250 (实际 ${q.totalLength})`);
  const qe = q.positionAt(250);
  assert(near(qe.x, 100, 0.5) && near(qe.y, 150, 0.5), `折线尾端 (100,150) (实际 ${qe.x.toFixed(1)},${qe.y.toFixed(1)})`);
}

section('SliderPath 例外与截短不变');
{
  // 末两点重合 → 不延长 (stable/lazer 同款)
  const p = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }], 150);
  assert(p.totalLength <= 100.01, `末点重合不延长 (totalLength=${p.totalLength})`);
  // expected < 几何全长 → 仍截短 (既有行为不变)
  const t = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 60);
  assert(near(t.totalLength, 60, 0.01), `截短 totalLength=60 (实际 ${t.totalLength})`);
  const te = t.positionAt(60);
  assert(near(te.x, 60, 0.5), `截短尾端 (60,0) (实际 ${te.x.toFixed(1)})`);
  // expected == 几何全长 → 不动作
  const e = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100);
  assert(near(e.totalLength, 100, 0.01), `等长 totalLength=100 (实际 ${e.totalLength})`);
}

if (failures) { console.error(`\nV148_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV148_TESTS_ALL_PASSED');

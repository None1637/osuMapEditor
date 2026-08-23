// v211: 锁定间距移除 0.25 拍下限 (对齐 lazer CircularDistanceSnapGrid.GetSnappedPosition fixedTime 分支无下限)
// 用户复现场景: 间隔 <0.25 拍 (如 1/8、1/16 密排) 时间距被钳成固定 0.25 拍距离, 不随间隔缩小
// 运行: cd app && npx esbuild verifier/v211/tests.ts --bundle --platform=node --outfile=verifier/v211/_bundle.mjs && node verifier/v211/_bundle.mjs
import { distanceLockDistance } from '../../src/osu/spacing';
import type { Beatmap, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function near(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) < eps; }

const red: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
const bm = {
  timingPoints: [red],
  hitObjects: [],
  difficulty: { sliderMultiplier: 1.4 },
  editor: { distanceSpacing: 1, beatDivisor: 8 },
} as unknown as Beatmap;
// 每拍 = DS1 * 100 * SM1.4 * SV1 = 140px

console.log('== distanceLockDistance: 亚 0.25 拍间隔按比例 (下限 0)');
// 前件结束 1000ms, 放置 1062.5ms = 1/8 拍 (0.125) -> 17.5px (旧实现钳到 0.25 拍 = 35px)
assert(near(distanceLockDistance(bm, 1000, 1062.5), 17.5), `1/8 拍 = 17.5px (实际 ${distanceLockDistance(bm, 1000, 1062.5)})`);
// 1/16 拍 (0.0625) -> 8.75px
assert(near(distanceLockDistance(bm, 1000, 1031.25), 8.75), `1/16 拍 = 8.75px (实际 ${distanceLockDistance(bm, 1000, 1031.25)})`);
// 间隔 0 -> 距离 0 (叠在前件末端, lazer 同款)
assert(near(distanceLockDistance(bm, 1000, 1000), 0), '间隔 0 = 距离 0');
// 负间隔 (前件结束晚于放置时刻 1ms 容差内) -> 钳 0, 不出负距离
assert(near(distanceLockDistance(bm, 1000, 999), 0), '负间隔钳 0');
// 大间隔不受影响: 4 拍 = 560px
assert(near(distanceLockDistance(bm, 1000, 3000), 560), `4 拍 = 560px (实际 ${distanceLockDistance(bm, 1000, 3000)})`);

if (failures) { console.error(`TESTS FAILED: ${failures}`); process.exit(1); }
console.log('TESTS ALL PASSED');

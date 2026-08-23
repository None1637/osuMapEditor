// v116 纯函数测试: 批量复制「缩放/份」+「添加绿线缩放滑条」
// 运行: cd app && npx esbuild verifier/v116/tests.ts --bundle --platform=node --outfile=/tmp/v116.cjs && node /tmp/v116.cjs
import { computeDuplicate, computeDuplicateTiming, computeDuplicateScaleTiming, DEFAULT_DUPLICATE_PARAMS, type DuplicateParams } from '../../src/osu/duplicate';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const tp = (time: number, beatLength: number, uninherited: boolean): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const circle = (id: number, x: number, time: number): HitObject => ({ id, type: 'circle', x, y: 192, time } as HitObject);
const slider = (id: number, time: number): HitObject => ({
  id, type: 'slider', x: 256, y: 192, time,
  curveType: 'L', curvePoints: [{ x: 356, y: 192 }], slides: 1, length: 100,
} as HitObject);
const bmOf = (points: TimingPoint[]): Beatmap => ({
  hitObjects: [], timingPoints: points, difficulty: { sliderMultiplier: 1.0 }, editor: {}, general: {}, metadata: {},
} as unknown as Beatmap);
const P = (patch: Partial<DuplicateParams>): DuplicateParams => ({ ...DEFAULT_DUPLICATE_PARAMS, ...patch });

section('缩放/份: 0.1 => 第 1 份 1.1x, 第 2 份 1.2x (绕选区中心)');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [circle(1, 200, 1000), circle(2, 312, 1500)]; // 选区中心 (256,192)
  const out = computeDuplicate(bm, objs, 'selection', P({ count: 2, intervalBeats: 1, scalePerCopy: 0.1 }));
  // 第 1 份 (s=1.1): 200 -> 256-56*1.1=194.4->194, 312 -> 256+56*1.1=317.6->318
  assert(out[0].x === 194 && out[1].x === 318, `第 1 份 1.1x (实际 ${out[0].x}/${out[1].x})`);
  // 第 2 份 (s=1.2): 256-67.2=188.8->189, 256+67.2=323.2->323
  assert(out[2].x === 189 && out[3].x === 323, `第 2 份 1.2x (实际 ${out[2].x}/${out[3].x})`);
  assert(out[0].time === 1500 && out[2].time === 2000, '时间偏移不受缩放影响 (各 +i×1 拍 = 500ms)');
}

section('缩放/份: -0.1 => 第 1 份 0.9x, 第 2 份 0.8x');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [circle(1, 200, 1000), circle(2, 312, 1500)];
  const out = computeDuplicate(bm, objs, 'selection', P({ count: 2, intervalBeats: 1, scalePerCopy: -0.1 }));
  // s=0.9: 256-50.4=205.6->206, 256+50.4=306.4->306; s=0.8: 256-44.8=211.2->211, 256+44.8=300.8->301
  assert(out[0].x === 206 && out[1].x === 306, `第 1 份 0.9x (实际 ${out[0].x}/${out[1].x})`);
  assert(out[2].x === 211 && out[3].x === 301, `第 2 份 0.8x (实际 ${out[2].x}/${out[3].x})`);
}

section('滑条: 未勾选 => 不缩放 (几何与长度原样); 勾选 => 控制点与像素长度同步缩放');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [slider(1, 1000)];
  const off = computeDuplicate(bm, objs, 'playfield', P({ count: 1, intervalBeats: 1, scalePerCopy: 0.1, scaleSlidersGreenLines: false }));
  assert(off[0].x === 256 && off[0].curvePoints![0].x === 356 && off[0].length === 100, '未勾选: 滑条原样');
  const on = computeDuplicate(bm, objs, 'playfield', P({ count: 1, intervalBeats: 1, scalePerCopy: 0.1, scaleSlidersGreenLines: true }));
  // 锚点 (256,192): 头不动, 尾 256+100*1.1=366, length 110
  assert(on[0].x === 256 && on[0].curvePoints![0].x === 366, `勾选: 控制点 1.1x (实际 ${on[0].curvePoints![0].x})`);
  assert(near(on[0].length ?? 0, 110), `勾选: 像素长度 110 (实际 ${on[0].length})`);
}

section('补偿绿线: 头 SV×s / 尾还原, 拷贝时长与原件一致');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [slider(1, 1000)];
  const p = P({ count: 1, intervalBeats: 2, scalePerCopy: 0.1, scaleSlidersGreenLines: true });
  const gs = computeDuplicateScaleTiming(bm, objs, p, []);
  assert(gs.length === 2, `生成 2 条绿线 (实际 ${gs.length})`);
  const head = gs.find(g => g.time === 2000)!, tail = gs.find(g => g.time !== 2000)!;
  // vel = 100*1.0*1/500 = 0.2 px/ms, 原时长 500ms; s=1.1 后 vel=0.22, 时长 110/0.22 = 500ms 不变
  assert(near(head.beatLength, -100 / 1.1), `头绿线 SV=1.1x (beatLength ${head.beatLength.toFixed(3)})`);
  assert(tail.time === 2500 && near(tail.beatLength, -100), `尾 2500 还原 SV=1.0 (实际 ${tail.time}/${tail.beatLength})`);
}

section('补偿绿线: 生效 SV 为乘算基准 (已有 2.0x 绿线 => 头 2.2x, 尾还原 2.0x)');
{
  const bm = bmOf([tp(0, 500, true), tp(0, -50, false)]);
  const objs = [slider(1, 1000)];
  const p = P({ count: 1, intervalBeats: 2, scalePerCopy: 0.1, scaleSlidersGreenLines: true });
  const gs = computeDuplicateScaleTiming(bm, objs, p, []);
  const head = gs.find(g => g.time === 2000)!, tail = gs.find(g => g.time !== 2000)!;
  assert(near(head.beatLength, -100 / 2.2), `头 SV=2.2x (实际 ${head.beatLength.toFixed(3)})`);
  assert(tail.time === 2250 && near(tail.beatLength, -50), `尾 2250 还原 SV=2.0x (实际 ${tail.time}/${tail.beatLength})`);
}

section('补偿绿线: 不勾选/缩放为 0/无滑条 => 不生成');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [slider(1, 1000)];
  assert(computeDuplicateScaleTiming(bm, objs, P({ count: 1, scalePerCopy: 0.1, scaleSlidersGreenLines: false }), []).length === 0, '未勾选 => 空');
  assert(computeDuplicateScaleTiming(bm, objs, P({ count: 1, scalePerCopy: 0, scaleSlidersGreenLines: true }), []).length === 0, '缩放 0 => 空');
  assert(computeDuplicateScaleTiming(bm, [circle(1, 256, 1000)], P({ count: 1, scalePerCopy: 0.1, scaleSlidersGreenLines: true }), []).length === 0, '无滑条 => 空');
}

section('多份: 第 2 份 s=1.2 独立生成, 各份时长均不变');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [slider(1, 1000)];
  const p = P({ count: 2, intervalBeats: 4, scalePerCopy: 0.1, scaleSlidersGreenLines: true });
  const gs = computeDuplicateScaleTiming(bm, objs, p, []);
  // 份1: 头 3000 SV1.1 / 尾 3500 还原; 份2: 头 5000 SV1.2 / 尾 5500 还原 (时长均 500ms)
  const heads = gs.filter(g => g.beatLength !== -100).map(g => g.time).sort((a, b) => a - b);
  assert(JSON.stringify(heads) === JSON.stringify([3000, 5000]), `两份头部绿线 [${heads}]`);
  assert(gs.some(g => g.time === 5000 && near(g.beatLength, -100 / 1.2)), '份2 头 SV=1.2x');
  assert(gs.filter(g => near(g.beatLength, -100)).length === 2, '两条还原绿线');
}

section('回归: scalePerCopy 默认 0 时 computeDuplicate 行为与 v65 完全一致');
{
  const bm = bmOf([tp(0, 500, true)]);
  const objs = [circle(1, 200, 1000)];
  const out = computeDuplicate(bm, objs, 'selection', P({ count: 1, intervalBeats: 1, rotateDeg: 90 }));
  // 绕 (200,192) 自旋 90° 位置不变, 时间 +500
  assert(out[0].x === 200 && out[0].y === 192 && out[0].time === 1500, '默认参数行为不变');
}

console.log(failures ? `\nV116_TESTS_FAILED: ${failures}` : '\nV116_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v42: 按数量模式时间对齐节拍网格 纯函数测试
// v43 语义修正: 位置先按数量沿路径分布 (等距=索引均布), 时间 = head + i*div (吸附 red 网格),
//   允许超出滑条尾继续生成 (时间超尾位置不堆在路径尾)
import { computeStream, DEFAULT_STREAM_PARAMS, type StreamParams } from '../../src/osu/convert/stream';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 合成谱面: 红线 0/500, SM 1 -> vel 0.2 px/ms, len 200 单程 1000ms
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
} as unknown as Beatmap;
const mkSlider = (time: number): HitObject => ({
  id: 1, type: 'slider', x: 100, y: 100, time,
  curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
  hitSound: 0, newCombo: true, comboSkip: 0,
});
const run = (time: number, p: Partial<StreamParams>) =>
  computeStream(bm, [mkSlider(time)], { ...DEFAULT_STREAM_PARAMS, mode: 'count', ...p });

section('按数量: 时间 = head + i*div (吸附网格), 数量恒定');
{
  // count=5, 网格 1/2 (250ms): 恰覆盖全时长
  assert(run(2000, { count: 5, spacingBeats: 0.5 }).map(c => c.time).join(',') === '2000,2250,2500,2750,3000',
    `count=5 @1/2: ${run(2000, { count: 5, spacingBeats: 0.5 }).map(c => c.time).join(',')}`);
  // count=6: 时间跨到滑条尾后 (3250 > 3000), 仍然 6 点
  const c6 = run(2000, { count: 6, spacingBeats: 0.5 });
  assert(c6.map(c => c.time).join(',') === '2000,2250,2500,2750,3000,3250', `count=6 @1/2: ${c6.map(c => c.time).join(',')}`);
  // count=16: 恒 16 点, 一路超尾
  assert(run(2000, { count: 16, spacingBeats: 0.5 }).length === 16, 'count=16 @1/2 -> 16 点');
  // 网格 1/1 (500ms): 5 点
  assert(run(2000, { count: 5, spacingBeats: 1 }).map(c => c.time).join(',') === '2000,2500,3000,3500,4000',
    `count=5 @1/1: ${run(2000, { count: 5, spacingBeats: 1 }).map(c => c.time).join(',')}`);
  // 网格 1/4 (125ms): 全部在 125 网格
  const c4 = run(2000, { count: 6, spacingBeats: 0.25 });
  assert(c4.length === 6 && c4.every(c => c.time % 125 === 0), `count=6 @1/4 全部在 125 网格 (${c4.map(c => c.time).join(',')})`);
}

section('按数量: 位置按数量均布 (超尾时间位置不堆在尾部)');
{
  const c6 = run(2000, { count: 6, spacingBeats: 0.5 });
  assert(c6.map(c => c.x).join(',') === '100,140,180,220,260,300', `count=6 位置均布 (${c6.map(c => c.x).join(',')})`);
  // 最后一个点 (时间 3250 超尾) 位置仍在路径尾 (因为它是索引末点, 而非时间挤出来的)
  assert(c6[5].x === 300 && c6[5].time === 3250, '超尾末点位置 = 路径尾 (索引末点)');
}

section('按数量: 头部 note 保持滑条起点不动 (即使起点不在网格上)');
{
  const t = run(2010, { count: 5, spacingBeats: 0.5 }).map(c => c.time);
  assert(t[0] === 2010 && t.slice(1).join(',') === '2250,2500,2750,3000', `滑条@2010: ${t.join(',')}`);
}

section('按间距模式: 不吸附 (保持 lazer 语义, 从滑条起点等距)');
{
  const t = computeStream(bm, [mkSlider(2010)], { ...DEFAULT_STREAM_PARAMS, mode: 'spacing', spacingBeats: 0.5 }).map(c => c.time);
  assert(t.join(',') === '2010,2260,2510,2760,3010', `spacing @2010: ${t.join(',')}`);
}

if (failures) { console.error(`\nV42_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV42_TESTS_PASSED');

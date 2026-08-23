// 验证器 v167 纯函数测试: lazer osu!standard 星数移植 (computeStarRating)
// 不变量: 空谱面 0 / 单圆圈 0 (lazer: 难度物件对从第 2 个物件起) / 双圆圈小正值 /
//   距离更远星数更高 / 滑条与折返滑条不 NaN 不崩 / 200 物件密集谱面合理区间 / BPM 翻倍单调升高
import { parseOsu } from '../../src/osu/parser';
import { computeStarRating, computeStarRatingAttributes } from '../../src/osu/starRating';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

interface MapOpts { ar?: number; cs?: number; od?: number; sm?: number; tickRate?: number; beatLength?: number }

function makeOsu(objects: string[], opts: MapOpts = {}): string {
  const { ar = 9, cs = 4, od = 8, sm = 1.4, tickRate = 1, beatLength = 500 } = opts;
  return [
    'osu file format v14',
    '',
    '[General]',
    'Mode: 0',
    '',
    '[Difficulty]',
    `HPDrainRate: 5`,
    `CircleSize: ${cs}`,
    `OverallDifficulty: ${od}`,
    `ApproachRate: ${ar}`,
    `SliderMultiplier: ${sm}`,
    `SliderTickRate: ${tickRate}`,
    '',
    '[TimingPoints]',
    `0,${beatLength},4,1,0,80,1,0`,
    '',
    '[HitObjects]',
    ...objects,
    '',
  ].join('\n');
}

const circle = (x: number, y: number, t: number) => `${x},${y},${t},1,0`;
// 直线滑条: 从 (x,y) 到 (x+len,y), slides 折返数
const slider = (x: number, y: number, t: number, len: number, slides = 1) =>
  `${x},${y},${t},2,0,L|${x + len}:${y},${slides},${len}`;

const finite = (v: number) => Number.isFinite(v);

section('(a) 空谱面 → 0');
{
  const bm = parseOsu(makeOsu([]));
  const sr = computeStarRating(bm);
  assert(sr === 0, `空物件 → 0 (得 ${sr})`);
}

section('(b) 单圆圈 → 0 (lazer: 无难度物件对); 双圆圈 → 小正值');
{
  const single = computeStarRating(parseOsu(makeOsu([circle(256, 192, 1000)])));
  assert(single === 0, `单圆圈 → 0 (得 ${single}) — lazer 首个物件不产生 DifficultyHitObject`);

  const two = computeStarRating(parseOsu(makeOsu([circle(200, 192, 1000), circle(300, 192, 1500)])));
  assert(finite(two) && two > 0, `双圆圈 → 正值 (得 ${two})`);
  assert(two >= 0.01 && two <= 0.5, `双圆圈星数量级 0.01~0.5 (得 ${two})`);
}

section('(c) 同 BPM 同节奏: 跳距更远 → 星数更高');
{
  const mkJump = (spacing: number) => {
    const objs: string[] = [];
    for (let i = 0; i < 8; i++) objs.push(circle(256 + (i % 2 === 0 ? -spacing / 2 : spacing / 2), 192, 1000 + i * 300));
    return computeStarRating(parseOsu(makeOsu(objs)));
  };
  const near = mkJump(40), far = mkJump(160);
  assert(finite(near) && finite(far) && near > 0 && far > 0, `两图均为正值 (近 ${near} / 远 ${far})`);
  assert(far > near, `远跳 (${far}) > 近跳 (${near})`);
}

section('(d) 滑条 / 折返滑条: 不 NaN 不崩');
{
  const bm = parseOsu(makeOsu([
    circle(100, 192, 1000),
    slider(150, 150, 1500, 200),          // 单程直线滑条
    circle(420, 192, 2500),
    slider(300, 250, 3000, 180, 2),        // 折返滑条 (slides=2)
    circle(150, 100, 4200),
    `256,192,5000,8,0,6500`,               // 转盘也不崩
    circle(300, 250, 7000),
  ]));
  const attrs = computeStarRatingAttributes(bm);
  const allFinite = [attrs.starRating, attrs.aimDifficulty, attrs.speedDifficulty, attrs.readingDifficulty,
    attrs.sliderFactor, attrs.aimDifficultStrainCount, attrs.speedDifficultStrainCount, attrs.readingDifficultNoteCount,
    attrs.aimTopWeightedSliderFactor, attrs.speedTopWeightedSliderFactor, attrs.aimDifficultSliderCount, attrs.speedNoteCount]
    .every(finite);
  assert(allFinite, '全部中间量有限 (无 NaN/Infinity)');
  assert(attrs.starRating > 0, `含滑条谱面星数 > 0 (得 ${attrs.starRating})`);
  assert(attrs.flashlightDifficulty === 0, '无 FL mod → flashlightDifficulty = 0');
  console.log(`  info: SR=${attrs.starRating.toFixed(4)} aim=${attrs.aimDifficulty.toFixed(4)} speed=${attrs.speedDifficulty.toFixed(4)} reading=${attrs.readingDifficulty.toFixed(4)}`);
}

section('(e) 200 物件真实量级谱面 → 合理区间');
{
  // 200bpm (beatLength=300) 1/2 密度 (150ms 一件) 共 200 件, 走位: 中段 zigzag 跳 (~130px) 夹少量滑条,
  // 密度/间距对标 4~6★ 常规谱面; 区间设宽 (1.5~8) 容忍浮点/实现差, 量级之外即视为移植错误
  const objs: string[] = [];
  let x = 256, y = 192, dir = 1;
  for (let i = 0; i < 200; i++) {
    const t = 1000 + i * 150;
    x = 256 + dir * 65; y = 192 + ((i % 3) - 1) * 40;
    dir = -dir;
    if (i % 25 === 12) objs.push(slider(x, y, t, 140));
    else objs.push(circle(x, y, t));
  }
  const bm = parseOsu(makeOsu(objs, { beatLength: 300 }));
  const sr = computeStarRating(bm);
  console.log(`  info: 200 物件 SR=${sr.toFixed(4)}`);
  assert(finite(sr) && sr >= 1.5 && sr <= 8, `200 物件密集谱面星数在 [1.5, 8] (得 ${sr})`);
}

section('(f) 单调性: 同排布 BPM 翻倍 → 星数明显升高');
{
  const mkStream = (beatLength: number, interval: number) => {
    const objs: string[] = [];
    for (let i = 0; i < 64; i++) {
      const t = 1000 + Math.round(i * interval);
      objs.push(circle(256 + (i % 2 === 0 ? -60 : 60), 192 + ((i % 4) - 1.5) * 30, t));
    }
    return computeStarRating(parseOsu(makeOsu(objs, { beatLength })));
  };
  const slow = mkStream(500, 250);   // 120bpm 1/2
  const fast = mkStream(250, 125);   // 240bpm 1/2 (BPM 翻倍, 排布相同)
  console.log(`  info: 120bpm SR=${slow.toFixed(4)} / 240bpm SR=${fast.toFixed(4)}`);
  assert(finite(slow) && finite(fast) && slow > 0, `两图均为正值 (${slow} / ${fast})`);
  assert(fast > slow * 1.3, `BPM 翻倍星数明显升高 (${fast} > ${slow} * 1.3)`);
}

if (failures) { console.error(`V167_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V167_TESTS_PASSED');

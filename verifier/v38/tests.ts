// 验证器 v38: F3 多个物件合并为滑条 — computeMerge 纯函数测试
import { computeMerge } from '../../src/osu/convert/merge';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 合成谱面: 红线 0/500, SliderMultiplier 1 -> vel = 100*1/500 = 0.2 px/ms; beatDivisor 1 -> tickPx = 0.2*500/1 = 100
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
  editor: { beatDivisor: 1 },
} as unknown as Beatmap;

const circle = (id: number, x: number, y: number, time: number, extra?: Partial<HitObject>): HitObject =>
  ({ id, type: 'circle', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0, ...extra });

const hasDupPair = (pts: { x: number; y: number }[], x: number, y: number) =>
  pts.some((p, i) => i > 0 && p.x === x && p.y === y && pts[i - 1].x === x && pts[i - 1].y === y);

section('圆+圆 -> 直线滑条 (长度由几何全长决定, 不看尾部时间)');
{
  const a = circle(1, 100, 100, 2000, { hitSound: 10, newCombo: true, hitSampleRaw: '1:2:0:80:' });
  const b = circle(2, 300, 100, 5000, { hitSound: 12, hitSampleRaw: '3:0:1:70:' });
  const r = computeMerge(bm, [a, b]);
  assert(!!r && r.type === 'slider', '生成滑条');
  assert(r!.x === 100 && r!.y === 100 && r!.time === 2000, 'head/时间 = 第一个物件');
  assert(r!.curveType === 'B' && r!.slides === 1, "curveType 'B' slides=1");
  assert(r!.curvePoints!.length === 1 && r!.curvePoints![0].x === 300 && r!.curvePoints![0].y === 100, '单控制点 = 第二个圆位置');
  // 几何全长 200 -> 吸附 tick 100 = 200; 两圆相隔 3000ms (等效 600px) 但不拉伸
  assert(r!.length === 200, `长度 = 几何全长吸附 200, 不拉到尾部时间 (实际 ${r!.length})`);
  assert(r!.hitSound === 10 && r!.hitSampleRaw === '1:2:0:80:' && r!.newCombo === true, 'hitsound/newCombo 仅首物件');
  assert(r!.edgeSoundsRaw === undefined && r!.edgeSetsRaw === undefined, '无边缘音字段');
}

section('圆+滑条 -> 滑条形状保留 (贝塞尔段原样拼入) + 接缝红锚点');
{
  const c = circle(1, 100, 100, 2000, { hitSound: 2 });
  const s: HitObject = {
    id: 2, type: 'slider', x: 300, y: 100, time: 3000, hitSound: 8, newCombo: true,
    curveType: 'B', curvePoints: [{ x: 350, y: 150 }, { x: 400, y: 100 }], slides: 1, length: 130,
    edgeSoundsRaw: '0|2', edgeSetsRaw: '0:0|1:0',
  };
  const r = computeMerge(bm, [c, s])!;
  assert(!!r, '生成滑条');
  assert(r.x === 100 && r.y === 100 && r.time === 2000, 'head/时间 = 第一个物件 (圆)');
  // 点列: (100,100) -> 直线接缝 -> (300,100) 红锚点 -> 原 B 滑条控制点 (350,150),(400,100) 原样保留
  const cp = r.curvePoints!;
  assert(cp.length === 4, `控制点数 = 接缝点x2 + 原滑条 2 点 (实际 ${cp.length})`);
  assert(cp[0].x === 300 && cp[0].y === 100 && cp[1].x === 300 && cp[1].y === 100, '接缝红锚点重复点 (300,100)');
  assert(cp[2].x === 350 && cp[2].y === 150 && cp[3].x === 400 && cp[3].y === 100, '原滑条控制点原样拼入 (形状不变)');
  assert(r.hitSound === 2 && r.hitSampleRaw === undefined && !r.newCombo, 'hitsound 仅首物件 (源滑条采样/边缘音丢弃)');
  assert(r.edgeSoundsRaw === undefined && r.edgeSetsRaw === undefined, '源滑条边缘音不保留');
}

section('catmull 滑条并入 -> 转贝塞尔 (段接缝过原卡特姆点)');
{
  const s: HitObject = {
    id: 1, type: 'slider', x: 100, y: 100, time: 2000,
    curveType: 'C', curvePoints: [{ x: 200, y: 100 }, { x: 300, y: 200 }], slides: 1, length: 260,
  };
  const c = circle(2, 300, 200, 3000); // 与卡特姆终点重合 -> 去重不补接缝
  const r = computeMerge(bm, [s, c])!;
  assert(!!r && r.curveType === 'B', '输出 B 滑条');
  assert(hasDupPair([{ x: r.x, y: r.y }, ...r.curvePoints!], 200, 100), '卡特姆中间点 (200,100) 成为红锚点接缝 (段经过原点)');
  // 转换确实发生: 含非原控制点的贝塞尔控制柄 (117,100) = (-v1+6v2+v3)/6 取整
  assert(r.curvePoints!.some(p => p.x === 117 && p.y === 100), '含 catmull->bezier 转换出的控制柄 (117,100)');
  const tail = r.curvePoints![r.curvePoints!.length - 1];
  assert(tail.x === 300 && tail.y === 200, '末点 = 卡特姆终点 (重合的圆不再补点)');
}

section('时间顺序: 传入顺序无关, 按 time 升序连接');
{
  const a = circle(1, 100, 100, 2000);
  const b = circle(2, 250, 150, 3000);
  const c = circle(3, 400, 100, 4000);
  const r = computeMerge(bm, [c, a, b])!; // 乱序传入
  assert(r.time === 2000 && r.x === 100 && r.y === 100, 'head/时间 = 最早的物件');
  const cp = r.curvePoints!;
  // (100,100) -> (250,150) -> (400,100) 顺序连接, 接缝红锚点
  assert(cp[0].x === 250 && cp[0].y === 150 && cp[1].x === 250 && cp[1].y === 150, '第二段接缝 = (250,150) 红锚点');
  assert(cp[2].x === 400 && cp[2].y === 100, '末点 = 最晚物件 (400,100)');
}

section('去重零长接缝');
{
  // 相邻圆位置完全相同: 不产生零长接缝/多余红锚点
  const r1 = computeMerge(bm, [circle(1, 100, 100, 2000), circle(2, 100, 100, 2500), circle(3, 400, 100, 3000)])!;
  assert(!!r1 && r1.curvePoints!.length === 1 && r1.curvePoints![0].x === 400, `同位圆去重, 控制点仅末点 (实际 ${JSON.stringify(r1?.curvePoints)})`);
  // 滑条尾与下一物件头重合: 不补零长接缝
  const s: HitObject = {
    id: 4, type: 'slider', x: 100, y: 100, time: 2000,
    curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
  };
  const r2 = computeMerge(bm, [s, circle(5, 300, 100, 3000)])!;
  assert(!!r2 && r2.curvePoints!.length === 1 && r2.curvePoints![0].x === 300 && r2.curvePoints![0].y === 100, '滑条尾与圆重合去重, 无尾部红锚点');
}

section('边界: 不满足条件返回 null');
{
  assert(computeMerge(bm, [circle(1, 100, 100, 2000)]) === null, '单物件 -> null');
  assert(computeMerge(bm, []) === null, '空选区 -> null');
  assert(computeMerge(bm, [circle(1, 100, 100, 2000), circle(2, 100, 100, 3000), circle(3, 100, 100, 4000)]) === null, '全部位置重合 -> null');
}

if (failures) { console.error(`\nTESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_ALL_PASSED');

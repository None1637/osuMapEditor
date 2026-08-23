// 验证器 v79 纯函数测试: timelineMarkerHit — 头圆/尾圆命中, 连体条中段不命中
import { timelineMarkerHit, timelineBarHit } from '../../src/osu/timelineHit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 布景: t0=1000, win=6000, width=600px => 1ms = 0.1px; rad=24 => 阈值 27px = 270ms
const T0 = 1000, WIN = 6000, W = 600, RAD = 24;
const objs = [
  { id: 1, time: 2000 },               // circle, px=100
  { id: 2, time: 3000 },               // slider/spinner 3000..4500, px=200..350
  { id: 3, time: 2300 },               // circle, px=130 (与 1 相邻测就近)
];
const endOf = (o: { id: number; time: number }) => (o.id === 2 ? 4500 : o.time);
const hit = (px: number) => timelineMarkerHit(objs, endOf, T0, WIN, W, px, RAD);

section('头圆命中');
{
  assert(hit(100) === 1, '正中头圆 => id1');
  assert(hit(110) === 1, '阈值内 (差 10px < 27, 离 id1 更近) => id1');
  assert(hit(129) === 3, '相邻两圆就近胜出 (px129: 1 差 29, 3 差 1)');
  assert(hit(200) === 2, '滑条头圆 => id2');
}

section('尾圆命中 (v79 新增)');
{
  assert(hit(350) === 2, '正中尾圆 => id2');
  assert(hit(330) === 2, '尾圆阈值内 (差 20px) => id2');
  assert(hit(380) === null, '尾圆阈值外 (差 30px > 27) => null');
}

section('连体条中段不命中 (v50 框选保护)');
{
  assert(hit(275) === null, '条中段 => null (拖动时留给框选)');
}

section('timelineBarHit: 单击/右键兜底 (v80)');
{
  const bar = (px: number) => timelineBarHit(objs, endOf, T0, WIN, W, px);
  assert(bar(275) === 2, '条中段 => id2 (单击选中滑条)');
  assert(bar(200) === 2 && bar(350) === 2, '条两端边界 => id2');
  assert(bar(500) === null, '窗口内空白 => null');
  assert(bar(100) === null, '单点无连体条 => null (由 markerHit 负责)');
  // 重叠条取 time 最晚者 (最上层)
  const overlap = [
    { id: 5, time: 3000 }, // 3000..5000, px=200..400
    { id: 6, time: 4000 }, // 4000..6000, px=300..500
  ];
  const oEnd = (o: { id: number; time: number }) => o.time + 2000;
  assert(timelineBarHit(overlap, oEnd, T0, WIN, W, 350) === 6, '重叠区 => 最晚 id6');
  assert(timelineBarHit(overlap, oEnd, T0, WIN, W, 250) === 5, '非重叠区 => id5');
}

section('窗口外物件跳过');
{
  const far = [{ id: 9, time: 9000 }]; // end 9000 > t0+win=7000
  assert(timelineMarkerHit(far, o => o.time, T0, WIN, W, 500, RAD) === null, '窗口右侧外 => null');
  const gone = [{ id: 8, time: 500 }]; // end 500 < t0
  assert(timelineMarkerHit(gone, o => o.time, T0, WIN, W, 0, RAD) === null, '窗口左侧外 => null');
}

if (failures) { console.error(`\nTESTS_V79_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V79_ALL_PASSED');

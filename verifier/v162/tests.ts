// 验证器 v162 纯函数测试: 上时间轴同刻物件堆叠 — stackInfo / stackLayout / 堆叠命中
import { stackInfo, stackLayout, timelineMarkerHit, timelineBarHit } from '../../src/osu/timelineHit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const OBJ_H = 60, RAD = 24;
const o = (id: number, time: number) => ({ id, time });

section('stackInfo: 同刻分组, 文件顺序从下往上');
{
  const m = stackInfo([o(1, 1000), o(2, 2000), o(3, 3000)]);
  assert(m.get(1)!.count === 1 && m.get(1)!.level === 0, '无同刻 → count=1 level=0');

  const m2 = stackInfo([o(1, 1000), o(2, 1000), o(3, 2000)]);
  assert(m2.get(1)!.level === 0 && m2.get(1)!.count === 2, '文件靠前 → level 0 (最下)');
  assert(m2.get(2)!.level === 1 && m2.get(2)!.count === 2, '文件靠后 → level 1 (其上)');
  assert(m2.get(3)!.count === 1, '其他时间点不受影响');

  const m3 = stackInfo([o(1, 500), o(2, 500), o(3, 500), o(4, 900), o(5, 900)]);
  assert(m3.get(3)!.level === 2 && m3.get(3)!.count === 3, '三件堆叠 level 递增至 2');
  assert(m3.get(5)!.level === 1 && m3.get(5)!.count === 2, '两组各自独立计数');
}

section('stackLayout: 半径缩小 + 行内布局');
{
  const single = stackLayout(1, OBJ_H, RAD);
  assert(single.rad === RAD && single.yOf(0) === OBJ_H / 2, '非堆叠: 原半径 + 行居中 (旧行为)');

  const two = stackLayout(2, OBJ_H, RAD);
  assert(two.rad === RAD, `两件 rad 不缩小=24 (v189) (得 ${two.rad})`);
  assert(two.yOf(0) === 34 && two.yOf(1) === 26, `两件 y: 34/26 (v189) (得 ${two.yOf(0)}/${two.yOf(1)})`);
  assert(two.yOf(0) > two.yOf(1), 'level 0 在下, level 1 在上');
  assert(two.yOf(0) + two.rad <= OBJ_H - 2 && two.yOf(1) - two.rad >= 2, '不越出行上下界');

  const three = stackLayout(3, OBJ_H, RAD);
  assert(three.rad === RAD && three.yOf(0) === 34 && three.yOf(2) === 26, `三件 rad=24 y=34/30/26 (v189) (得 ${three.rad}/${three.yOf(0)}/${three.yOf(2)})`);

  // 大堆叠: v189 起半径不缩小, 仅层距压缩, 仍全部在行内
  const ten = stackLayout(10, OBJ_H, RAD);
  assert(ten.rad === RAD, `十件 rad 仍=24 (v189 不缩小) (得 ${ten.rad})`);
  assert(ten.yOf(9) - ten.rad >= 1.9 && ten.yOf(0) + ten.rad <= 58.1, '十件仍在行内');
  assert(ten.yOf(0) > ten.yOf(9), '十件保持从下到上');
}

section('timelineMarkerHit: 堆叠 2D 命中 + 旧行为兼容');
{
  const objs = [o(1, 1000)];
  const endOf = () => 1000;
  // t0=0, win=2000, width=1000 → 头圆 x=500
  // 无 geom (旧调用): x-only, 任意 py 等价
  assert(timelineMarkerHit(objs, endOf, 0, 2000, 1000, 500, RAD) === 1, '旧 7 参调用: x 命中');
  assert(timelineMarkerHit(objs, endOf, 0, 2000, 1000, 500 + RAD + 5, RAD) === null, '旧调用: 超阈值不命中');
  // 堆叠 geom: {y:35, rad:23} — 2D 距离
  const geom = () => ({ y: 35, rad: 23 });
  assert(timelineMarkerHit(objs, endOf, 0, 2000, 1000, 500, RAD, 35, geom) === 1, '堆叠: 正中命中');
  assert(timelineMarkerHit(objs, endOf, 0, 2000, 1000, 500, RAD, 5, geom) === null, '堆叠: 垂直偏离 30 > rad+3 → 不命中');
  assert(timelineMarkerHit(objs, endOf, 0, 2000, 1000, 500, RAD, 5, () => undefined) === 1, 'geom 返回 undefined (非堆叠) → 旧 x-only, py 无关');
  // 同刻两件的层级命中: 下层 (y=35) 与上层 (y=25) 各自可点
  const two = [o(1, 1000), o(2, 1000)];
  const g2 = (x: { id: number }) => (x.id === 1 ? { y: 35, rad: 23 } : { y: 25, rad: 23 });
  assert(timelineMarkerHit(two, endOf, 0, 2000, 1000, 500, RAD, 36, g2) === 1, '点下层位置 → 下层件');
  assert(timelineMarkerHit(two, endOf, 0, 2000, 1000, 500, RAD, 24, g2) === 2, '点上层位置 → 上层件');
}

section('timelineBarHit: 堆叠条带垂直厚度');
{
  const objs = [o(1, 1000), o(2, 1000)];
  const endOf = () => 1500; // 条 x: 500..750
  const g2 = (x: { id: number }) => (x.id === 1 ? { y: 35, rad: 23 } : { y: 25, rad: 23 });
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600) === 2, '无 geom: 同刻取最晚 (旧行为)');
  // 两层 y=35/25 rad=23 → 条带 [12,58]/[2,48] 有重叠; 独占区: y>48 仅下层, y<12 仅上层
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600, 52, g2) === 1, '堆叠: py=52 (下层独占区) → 下层条');
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600, 6, g2) === 2, '堆叠: py=6 (上层独占区) → 上层条');
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600, 30, g2) === 2, '堆叠: 重叠区同刻取最晚 (旧平局规则)');
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600, 59, g2) === null, '堆叠: 两层厚度之外 → 不命中');
  assert(timelineBarHit(objs, endOf, 0, 2000, 1000, 600, 59, () => undefined) === 2, 'geom undefined (非堆叠) → 任意 y 命中 (旧行为)');
}

if (failures) { console.error(`V162_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V162_TESTS_PASSED');

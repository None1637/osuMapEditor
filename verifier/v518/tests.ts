// v518: 上方时间轴按实际显示像素命中（非堆叠/堆叠、头尾/repeat/连体条）
import { stackInfo, stackLayout, timelineHeadHit, timelineMarkerHit, timelineNodeHit, timelineBarHit } from '../../src/osu/timelineHit';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const objs = [
  { id: 1, time: 3000 },
  { id: 2, time: 4000 },
  { id: 3, time: 5000 },
  { id: 4, time: 5000 },
];
const endOf = (o: { id: number }) => o.id === 2 ? 6000 : o.id === 1 || o.id === 2 ? o.time : 5000;
const spansOf = (o: { id: number }) => o.id === 2 ? 2 : 0;
const geomOf = (o: { id: number }) => {
  const si = stackInfo(objs).get(o.id)!;
  const lay = stackLayout(si.count, 60, 24);
  return { y: lay.yOf(si.level), rad: lay.rad };
};

console.log('== 非堆叠: 圆心可点, 整行竖条/圆外不再误选');
{
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 300, 24, 1, geomOf) === null, '头圆正上方空白不选');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 300, 24, 30, geomOf) === 1, '头圆中心可选');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 300, 24, 4, geomOf) === null, '距圆心 26px（旧 rad+3 内）也不选');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 300, 24, 53.9, geomOf) === 1, 'rad 内边界可选');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 300, 24, 54, geomOf) === null, '恰 rad 边界不选（严格 <）');
  assert(timelineMarkerHit(objs, endOf, 0, 6000, 600, 400, 24, 1, geomOf) === null, '滑条头上方空白不选');
  assert(timelineMarkerHit(objs, endOf, 0, 6000, 600, 600, 24, 1, geomOf) === null, '滑条尾上方空白不选');
  assert(timelineMarkerHit(objs, endOf, 0, 6000, 600, 600, 24, 30, geomOf) === 2, '滑条尾中心可选');
}

console.log('== repeat/连体条: x 在范围内也必须 y 命中');
{
  assert(timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 500, 24, 1, geomOf) === null, 'repeat 上方空白不选');
  const hit = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 500, 24, 30, geomOf);
  assert(hit?.id === 2 && hit.edge === 1, `repeat 中心命中 (${JSON.stringify(hit)})`);
  const tail = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 600, 24, 30, geomOf);
  assert(tail?.id === 2 && tail.edge === 2, `最终尾命中 (${JSON.stringify(tail)})`);
  assert(timelineBarHit(objs, endOf, 0, 6000, 600, 450, 1, geomOf) === null, '连体条上方空白不选');
  assert(timelineBarHit(objs, endOf, 0, 6000, 600, 450, 30, geomOf) === 2, '连体条轨道中心可选');
}

console.log('== 同刻堆叠: 按各自显示 y/rad，不再 x-only');
{
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 500, 24, 60, geomOf) === null, '下层圆外 26px 不选');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 500, 24, 34, geomOf) === 3, '下层圆心选中下层');
  assert(timelineHeadHit(objs, endOf, 0, 6000, 600, 500, 24, 26, geomOf) === 4, '上层圆心选中上层');
}

if (failures) { console.error(`V518_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V518_TESTS_PASSED');

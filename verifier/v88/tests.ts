// 验证器 v88 纯函数测试: geoHelperSources — 辅助显示范围 (all / 选中+上次选中)
import { geoHelperSources } from '@/osu/geometryHelpers';
import type { HitObject } from '@/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const slider = (id: number, time = 0): HitObject => ({ id, type: 'slider', x: 0, y: 0, time, curveType: 'L', curvePoints: [{ x: 100, y: 0 }], slides: 1, length: 100 });
const circle = (id: number, time = 0): HitObject => ({ id, type: 'circle', x: 0, y: 0, time });
const objs = [slider(1), slider(2), circle(3), slider(4, 99999)];
const vis = (o: HitObject) => o.time < 1000; // id4 不可见

{
  const all = geoHelperSources('all', objs, new Set(), new Set(), vis);
  assert(all.length === 2 && all.every(o => o.type === 'slider'), `all => 可见滑条 [1,2] (实际 ${all.map(o => o.id)})`);
}
{
  const sel = geoHelperSources('selection', objs, new Set([1]), new Set(), vis);
  assert(sel.length === 1 && sel[0].id === 1, 'selection => 当前选中');
}
{
  const sel = geoHelperSources('selection', objs, new Set([1]), new Set([2]), vis);
  assert(sel.length === 2, `selection => 选中 ∪ 上次选中 [1,2] (实际 ${sel.map(o => o.id)})`);
}
{
  // 上次选中的物件即使现在不可见也保留 (与"上次选中时显示"语义一致)
  const sel = geoHelperSources('selection', objs, new Set(), new Set([4]), vis);
  assert(sel.length === 1 && sel[0].id === 4, 'selection => 上次选中不受可见性限制');
}
{
  const sel = geoHelperSources('selection', objs, new Set([3]), new Set(), vis);
  assert(sel.length === 0, '选中单点 => 无滑条辅助');
}

if (failures) { console.error(`\nTESTS_V88_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V88_ALL_PASSED');

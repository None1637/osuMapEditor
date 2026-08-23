// 验证器 v90 纯函数测试: geoHelperSources 两范围回归锚点 (none 撤销后行为不变)
import { geoHelperSources } from '@/osu/geometryHelpers';
import type { HitObject } from '@/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const slider = (id: number, time = 0): HitObject => ({ id, type: 'slider', x: 0, y: 0, time, curveType: 'L', curvePoints: [{ x: 100, y: 0 }], slides: 1, length: 100 });
const objs = [slider(1), slider(2), slider(3, 99999)];
const vis = (o: HitObject) => o.time < 1000;

assert(geoHelperSources('all', objs, new Set(), new Set(), vis).length === 2, 'all => 可见滑条');
assert(geoHelperSources('selection', objs, new Set([1]), new Set([3]), vis).length === 2, 'selection => 选中 ∪ 上次选中 (不受可见性限制)');
assert(geoHelperSources('selection', objs, new Set(), new Set(), vis).length === 0, 'selection 无选中 => 空');

if (failures) { console.error(`\nTESTS_V90_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V90_ALL_PASSED');

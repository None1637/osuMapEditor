import assert from 'node:assert';
import { offsetPolyline, geoDistSources } from '../../src/osu/geometryHelpers';
import type { HitObject } from '../../src/osu/parser';

// 1. 直线折线双侧偏移: 水平线 (0,0)->(100,0), 左 = +y 侧? 段法线 = (-dy,dx)/len = (0,1) → 左是 y 增侧
const { left, right } = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
assert.deepStrictEqual(left, [{ x: 0, y: 10 }, { x: 100, y: 10 }], '直线左侧偏移');
assert.deepStrictEqual(right, [{ x: 0, y: -10 }, { x: 100, y: -10 }], '直线右侧偏移');

// 2. 直角转弯 miter: (0,0)->(100,0)->(100,100), 拐角顶点法线平均 = (√2/2, √2/2) 方向, miter 长度 = d/cos45°
const corner = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10);
const mid = corner.left[1];
const miterLen = Math.hypot(mid.x - 100, mid.y - 0);
assert.ok(Math.abs(miterLen - 10 / Math.cos(Math.PI / 4)) < 1e-9, `直角 miter 长度 = d/cos45° (实际 ${miterLen.toFixed(3)})`);
// 凸角外侧到拐点距离恒为 miter 长度, 且方向沿角平分线
const dirx = (mid.x - 100) / miterLen, diry = (mid.y - 0) / miterLen;
assert.ok(Math.abs(dirx + Math.SQRT1_2) < 1e-9 && Math.abs(diry - Math.SQRT1_2) < 1e-9, 'miter 沿角平分线');

// 3. 锐角 miter 限幅 ≤ 3d: 10° 折返
const sharp = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100 + 100 * Math.cos(Math.PI / 18), y: 100 * Math.sin(Math.PI / 18) }], 10);
const sl = Math.hypot(sharp.left[1].x - 100, sharp.left[1].y);
assert.ok(sl <= 30 + 1e-9, `锐角 miter 限幅 3d (实际 ${sl.toFixed(2)})`);

// 4. 重合点不炸 (沿用前段法线)
const dup = offsetPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }], 5);
assert.ok(dup.left.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), '重合点无 NaN');

// 5. 单点/空输入
assert.deepStrictEqual(offsetPolyline([{ x: 1, y: 1 }], 5), { left: [], right: [] }, '单点返回空');

// 6. geoDistSources: 单点+滑条入选, 转盘排除; 范围语义同 geoHelperSources
const mk = (id: number, type: 'circle' | 'slider' | 'spinner'): HitObject => ({ id, type, x: 0, y: 0, time: id * 100 } as HitObject);
const objs = [mk(1, 'circle'), mk(2, 'slider'), mk(3, 'spinner'), mk(4, 'circle')];
const allVis = () => true;
assert.deepStrictEqual(geoDistSources('all', objs, new Set(), new Set(), allVis).map(o => o.id), [1, 2, 4], 'all: 全部单点+滑条');
assert.deepStrictEqual(geoDistSources('all', objs, new Set(), new Set(), o => o.id !== 4).map(o => o.id), [1, 2], 'all: 遵守可见性');
assert.deepStrictEqual(geoDistSources('selection', objs, new Set([2]), new Set([3, 4]), allVis).map(o => o.id), [2, 4], 'selection: 选中 ∪ 上次选中 (转盘仍排除)');
assert.deepStrictEqual(geoDistSources('selection', objs, new Set(), new Set(), allVis).map(o => o.id), [], 'selection: 空选择为空');

console.log('V126_TESTS_PASSED');

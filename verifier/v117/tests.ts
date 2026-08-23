// v117 测试: 滑条节点多选 (Alt 层) — nodeSelection 纯函数 + store 节点选区 API 与联动清空
// 运行: cd app && npx esbuild verifier/v117/tests.ts --bundle --platform=node --outfile=/tmp/v117.cjs --log-level=error --alias:@=./src && node /tmp/v117.cjs
import { store } from '../../src/osu/store';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';
import {
  ctrlPoints, nodeEntries, nearestNode, nodesInRect, nodeBounds,
  withRedPartners, snapshotNodes, transformNodesFromSnapshot,
} from '../../src/osu/nodeSelection';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0,
});
const slider = (id: number, x: number, y: number, curvePoints: { x: number; y: number }[]): HitObject => ({
  id, type: 'slider', x, y, time: id * 1000, curveType: 'L', curvePoints, slides: 1, length: 100,
} as HitObject);
const NO_OFF = new Map<number, { dx: number; dy: number }>();

// ctrl: 头 (100,100), A (150,100), B/B 红锚点重复对 (200,100)x2, C (250,150)
const s1 = () => slider(9001, 100, 100, [{ x: 150, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 100 }, { x: 250, y: 150 }]);
const s2 = () => slider(9002, 300, 300, [{ x: 350, y: 300 }]);

section('ctrlPoints: 含头部, 堆叠偏移生效');
{
  const o = s1();
  const a = ctrlPoints(o);
  assert(a.length === 5 && a[0].x === 100 && a[0].y === 100, '无偏移: 头部在 idx 0');
  const b = ctrlPoints(o, { dx: 10, dy: -5 });
  assert(b[0].x === 110 && b[0].y === 95 && b[4].x === 260 && b[4].y === 145, '偏移应用到全部点');
}

section('nearestNode: 跨滑条最近优先, 并列取序号在前, maxDist 生效');
{
  const objs = [s1(), s2()];
  const hit = nearestNode(objs, NO_OFF, { x: 349, y: 301 });
  assert(hit?.objId === 9002 && hit.idx === 1, '命中最近滑条的最近节点');
  const tie = nearestNode(objs, NO_OFF, { x: 200, y: 100 }); // 红对两点同坐标
  assert(tie?.objId === 9001 && tie?.idx === 2, '同坐标并列取序号在前 (idx 2 先于 3)');
  assert(nearestNode(objs, NO_OFF, { x: 0, y: 0 }) === null, '超出 maxDist 不命中');
}

section('nodesInRect: 红锚点重复对同坐标, 两个下标都命中');
{
  const objs = [s1(), s2()];
  const r = nodesInRect(objs, NO_OFF, { minX: 190, minY: 90, maxX: 210, maxY: 110 });
  assert(r.length === 2 && r[0][1] === 2 && r[1][1] === 3, '红对双命中 (变换天然一起动)');
  const all = nodesInRect(objs, NO_OFF, { minX: 0, minY: 0, maxX: 512, maxY: 384 });
  assert(all.length === 7, '全框: 5 + 2 个节点');
}

section('nodeBounds: q = 点集盒, dq = 外扩 pad');
{
  const bm = { hitObjects: [s1(), s2()] } as unknown as Beatmap;
  const b = nodeBounds(bm, new Map([[9001, new Set([0, 4])]]), NO_OFF, 8)!;
  assert(b.q.x === 100 && b.q.y === 100 && b.q.w === 150 && b.q.h === 50, 'q 包住选中节点');
  assert(b.dq.x === 92 && b.dq.y === 92 && b.dq.w === 166 && b.dq.h === 66, 'dq 外扩 8');
  assert(nodeBounds(bm, new Map([[9001, new Set([9])]]), NO_OFF) === null, '非法下标 -> null');
}

section('withRedPartners: 选中红对之一, 变换集合带上另一个');
{
  const bm = { hitObjects: [s1()] } as unknown as Beatmap;
  const m = withRedPartners(bm, new Map([[9001, new Set([2])]]));
  assert(m.get(9001)?.has(2) && m.get(9001)?.has(3), 'idx 2 扩展出配对 idx 3');
  const solo = withRedPartners(bm, new Map([[9001, new Set([0, 1])]]));
  assert(solo.get(9001)?.size === 2, '非红对点不扩展');
}

section('snapshotNodes + transformNodesFromSnapshot: 平移往返 + 取整写回');
{
  const bm = { hitObjects: [s1()] } as unknown as Beatmap;
  const o = bm.hitObjects[0];
  const orig = snapshotNodes(bm, new Map([[9001, new Set([0, 1])]]));
  assert(orig.get(9001)?.get(0)?.x === 100 && orig.get(9001)?.get(1)?.x === 150, '快照含头部与曲线点');
  const ids = transformNodesFromSnapshot(bm, orig, p => ({ x: p.x + 10.4, y: p.y - 5.4 }));
  assert(ids.length === 1 && ids[0] === 9001, '返回受影响滑条 id');
  assert(o.x === 110 && o.y === 95 && o.curvePoints![0].x === 160 && o.curvePoints![0].y === 95, '取整写回');
  assert(o.curvePoints![3].x === 250, '未选中节点不动');
  transformNodesFromSnapshot(bm, orig, p => p); // 从快照还原
  assert(o.x === 100 && o.curvePoints![0].x === 150, '从快照可重算 (幂等)');
}

function reset() {
  store.beatmap = {
    hitObjects: [s1(), s2()],
    timingPoints: [tp(0, 500, true)],
    difficulty: { sliderMultiplier: 1.4 }, editor: {}, general: {}, metadata: {},
  } as unknown as Beatmap;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.selected.clear();
  store.selectedGreenLines.clear();
  store.selectedNodes.clear();
  store.lockNotes = false;
}

section('store: setSelectedNodes 自动并入物件选区, nodeSelectionCount 计数');
{
  reset();
  store.setSelectedNodes([[9001, 0], [9001, 2], [9002, 1]]);
  assert(store.nodeSelectionCount === 3, '计数 = 3');
  assert(store.selected.has(9001) && store.selected.has(9002), '节点所在滑条自动并入物件选区');
  store.setSelectedNodes([[9001, 4]]);
  assert(store.nodeSelectionCount === 1 && store.selectedNodes.get(9001)?.has(4), '再次设定整体替换');
}

section('store: toggleSelectedNode 加选/减选');
{
  reset();
  store.toggleSelectedNode(9001, 1);
  assert(store.selectedNodes.get(9001)?.has(1) && store.selected.has(9001), '加选并入物件选区');
  store.toggleSelectedNode(9001, 2);
  assert(store.nodeSelectionCount === 2, '加选第二个');
  store.toggleSelectedNode(9001, 1);
  assert(!store.selectedNodes.get(9001)?.has(1) && store.nodeSelectionCount === 1, '减选');
  store.toggleSelectedNode(9001, 2);
  assert(!store.selectedNodes.size, '减空后条目移除');
}

section('store: 联动清空 — select/clearSelection/deleteSelected');
{
  reset();
  store.setSelectedNodes([[9001, 0], [9001, 1]]);
  store.select([9002]); // 非加选
  assert(store.selectedNodes.size === 0, 'select(非加选) 清空节点选区');
  store.setSelectedNodes([[9001, 0]]);
  store.clearSelection();
  assert(store.selectedNodes.size === 0, 'clearSelection 清空节点选区');
  store.setSelectedNodes([[9001, 0], [9001, 1], [9001, 2]]);
  store.deleteSelected();
  assert(store.selectedNodes.size === 0, 'deleteSelected 清空节点选区');
  assert(store.beatmap!.hitObjects.length === 1, '物件删除正常');
  store.undo();
  assert(store.beatmap!.hitObjects.length === 2, 'undo 恢复');
}

section('nodeEntries: 展平选区 (框选 base 用)');
{
  const e = nodeEntries(new Map([[9001, new Set([0, 2])], [9002, new Set([1])]]));
  assert(e.length === 3 && e.some(([o, i]) => o === 9001 && i === 2), '展平 [objId, idx] 对');
}

console.log(failures ? `\nV117_TESTS_FAILED: ${failures}` : '\nV117_TESTS_PASSED');
process.exit(failures ? 1 : 0);

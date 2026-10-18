// v462 单元测试: nodeSelectionEquals 节点选区内容相等判定 (setSelectedNodes emit 守卫用)
import { nodeSelectionEquals } from '@/osu/nodeSelection';

let failures = 0;
const assert = (cond: boolean, msg: string) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };

const m = (entries: [number, number][]): Map<number, Set<number>> => {
  const r = new Map<number, Set<number>>();
  for (const [o, i] of entries) {
    let s = r.get(o);
    if (!s) r.set(o, (s = new Set()));
    s.add(i);
  }
  return r;
};

const a = m([[1, 0], [1, 2], [3, 1]]);
assert(nodeSelectionEquals(a, a), '同引用 → true');
assert(nodeSelectionEquals(a, m([[3, 1], [1, 2], [1, 0]])), '同内容不同插入序 → true');
assert(nodeSelectionEquals(m([]), m([])), '空 = 空 → true');
assert(!nodeSelectionEquals(a, m([[1, 0], [1, 2]])), '少一条滑条 → false');
assert(!nodeSelectionEquals(a, m([[1, 0], [1, 2], [3, 1], [4, 0]])), '多一条滑条 → false');
assert(!nodeSelectionEquals(a, m([[1, 0], [1, 2], [3, 2]])), '同键不同下标 → false');
assert(!nodeSelectionEquals(a, m([[1, 0], [1, 1], [1, 2], [3, 1]])), '同键集大小不同 → false');
assert(!nodeSelectionEquals(a, m([[2, 0], [1, 2], [3, 1]])), '缺键 → false');
assert(!nodeSelectionEquals(m([]), m([[1, 0]])), '空 vs 非空 → false');

if (failures) { console.error(`V462_UNIT_FAILED: ${failures}`); process.exit(1); }
console.log('V462_UNIT_ALL_PASSED');

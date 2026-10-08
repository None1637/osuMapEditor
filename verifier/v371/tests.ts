// 验证器 v371 纯函数测试: firstFramedSliderId — 框到多条滑条时只保留
// 「第一个框到的」(距框选起点最近的框内节点所在滑条)。
import { firstFramedSliderId, type NodeEntry } from '@/osu/nodeSelection';
import type { Pt } from '@/osu/selectionBox';

let failures = 0;
function eq<T>(a: T, b: T, msg: string) {
  if (a !== b) { failures++; console.error('  FAIL:', msg, `(得 ${a}, 期望 ${b})`); }
  else console.log('  ok:', msg);
}

// 场景: 两条滑条 — A (id=1) 节点在 (100,100)/(150,100); B (id=2) 节点在 (300,300)/(350,300)
const pos: Record<string, Pt> = {
  '1:0': { x: 100, y: 100 }, '1:1': { x: 150, y: 100 },
  '2:0': { x: 300, y: 300 }, '2:1': { x: 350, y: 300 },
};
const posOf = (objId: number, idx: number) => pos[`${objId}:${idx}`] ?? null;
const all: NodeEntry[] = [[1, 0], [1, 1], [2, 0], [2, 1]];

eq(firstFramedSliderId(all, posOf, 0, 0), 1, '起点 (0,0): 最近 A → 只框 A');
eq(firstFramedSliderId(all, posOf, 500, 500), 2, '起点 (500,500): 最近 B → 只框 B');
eq(firstFramedSliderId(all, posOf, 240, 240), 2, '起点 (240,240): 距 B(300,300)=85 < 距 A(150,100)=178 → B');
eq(firstFramedSliderId([[1, 0], [1, 1]], posOf, 400, 400), 1, '单条滑条原样返回');
eq(firstFramedSliderId([], posOf, 0, 0), null, '空框 → null');
// 节点位置缺失跳过 (红锚点对/越界下标防御)
eq(firstFramedSliderId([[1, 9], [2, 0]], posOf, 0, 0), 2, '缺失位置节点跳过');

if (failures) { console.error(`V371_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V371_TESTS_ALL_PASSED');

// v213: 时间轴滑条节点 (头/折返点/尾) 单独加音效 — 纯函数单测
// 运行: cd app && npx esbuild verifier/v213/tests.ts --bundle --platform=node --outfile=verifier/v213/_bundle.mjs && node verifier/v213/_bundle.mjs
import { parseEdgeSounds, setEdgeSoundBit, toggleEdgesHitSound, resizeEdgeStrings, setEdgeSoundBitAll } from '../../src/osu/edgeSounds';
import { timelineNodeHit } from '../../src/osu/timelineHit';
import type { HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const mkSlider = (over: Partial<HitObject> = {}): HitObject => ({
  id: 1, type: 'slider', x: 0, y: 0, time: 1000, slides: 2, length: 100, hitSound: 0,
  curveType: 'L', curvePoints: [{ x: 100, y: 0 }], ...over,
});

console.log('== parseEdgeSounds: 回落与解析');
{
  // raw 未定义 → 全段回落物件 hitSound
  const o = mkSlider({ hitSound: 2 });
  assert(parseEdgeSounds(o).join(',') === '2,2,2', 'raw 缺省 → 全段回落 hitSound');
  // raw 定义 → 按段解析, 不再回落
  const o2 = mkSlider({ hitSound: 2, edgeSoundsRaw: '0|2|4' });
  assert(parseEdgeSounds(o2).join(',') === '0,2,4', 'raw 定义 → 按段解析');
  // 段缺失/段非法 → 该段回落
  const o3 = mkSlider({ hitSound: 8, edgeSoundsRaw: '0|x' });
  assert(parseEdgeSounds(o3).join(',') === '0,8,8', '段缺失/非法 → 该段回落 hitSound');
}

console.log('== setEdgeSoundBit: materialize 保持他段听感');
{
  // 物件带 whistle (hitSound=2), 给尾 (edge=2) 加 finish → 其余段必须仍是 2 (不变闷)
  const o = mkSlider({ hitSound: 2 });
  setEdgeSoundBit(o, 2, 4, true);
  assert(o.edgeSoundsRaw === '2|2|6', `materialize: 他段保留 hitSound, 尾段 2|4=6 (实际 ${o.edgeSoundsRaw})`);
  // 清位
  setEdgeSoundBit(o, 2, 4, false);
  assert(o.edgeSoundsRaw === '2|2|2', `清位回退 (实际 ${o.edgeSoundsRaw})`);
  // 越界下标不动作
  const o2 = mkSlider({ edgeSoundsRaw: '0|0|0' });
  setEdgeSoundBit(o2, 5, 2, true);
  assert(o2.edgeSoundsRaw === '0|0|0', '越界下标不动作');
}

console.log('== toggleEdgesHitSound: 三态语义');
{
  const o = mkSlider({ edgeSoundsRaw: '0|0|0' });
  // 未全有 → 全部置位
  toggleEdgesHitSound([{ o, edge: 0 }, { o, edge: 2 }], 2);
  assert(o.edgeSoundsRaw === '2|0|2', `未全有 → 全部置位 (实际 ${o.edgeSoundsRaw})`);
  // 全有 → 全部清位
  toggleEdgesHitSound([{ o, edge: 0 },{ o, edge: 2 }], 2);
  assert(o.edgeSoundsRaw === '0|0|0', `全有 → 全部清位 (实际 ${o.edgeSoundsRaw})`);
  // 混合 (一段有一段没有) → 全部置位
  const o2 = mkSlider({ edgeSoundsRaw: '2|0|0' });
  toggleEdgesHitSound([{ o: o2, edge: 0 }, { o: o2, edge: 1 }], 2);
  assert(o2.edgeSoundsRaw === '2|2|0', `混合 → 全部置位 (实际 ${o2.edgeSoundsRaw})`);
  // raw 缺省时 toggle: materialize 自 hitSound
  const o3 = mkSlider({ hitSound: 4 });
  toggleEdgesHitSound([{ o: o3, edge: 1 }], 2);
  assert(o3.edgeSoundsRaw === '4|6|4', `raw 缺省 toggle → 他段保留 hitSound (实际 ${o3.edgeSoundsRaw})`);
}

console.log('== setEdgeSoundBitAll: 物件级同步所有段');
{
  const o = mkSlider({ edgeSoundsRaw: '0|2|4' });
  setEdgeSoundBitAll(o, 8, true);
  assert(o.edgeSoundsRaw === '8|10|12', `全段置位 (实际 ${o.edgeSoundsRaw})`);
  setEdgeSoundBitAll(o, 2, false);
  assert(o.edgeSoundsRaw === '8|8|12', `全段清位 (实际 ${o.edgeSoundsRaw})`);
}

console.log('== resizeEdgeStrings: slides 变化同步段数');
{
  // 3 折返缩到 1: 截断
  const o = mkSlider({ slides: 3, edgeSoundsRaw: '0|2|4|8', edgeSetsRaw: '1:0|2:0|1:1|0:0' });
  o.slides = 1;
  resizeEdgeStrings(o);
  assert(o.edgeSoundsRaw === '0|2', `截断 edgeSounds (实际 ${o.edgeSoundsRaw})`);
  assert(o.edgeSetsRaw === '1:0|2:0', `截断 edgeSets (实际 ${o.edgeSetsRaw})`);
  // 1 折返拉到 3: 默认段补长
  const o2 = mkSlider({ slides: 1, edgeSoundsRaw: '2|0', edgeSetsRaw: '1:0|0:0' });
  o2.slides = 3;
  resizeEdgeStrings(o2);
  assert(o2.edgeSoundsRaw === '2|0|0|0', `补长 edgeSounds (实际 ${o2.edgeSoundsRaw})`);
  assert(o2.edgeSetsRaw === '1:0|0:0|0:0|0:0', `补长 edgeSets (实际 ${o2.edgeSetsRaw})`);
  // raw 未定义不动作
  const o3 = mkSlider({ slides: 1 });
  o3.slides = 4;
  resizeEdgeStrings(o3);
  assert(o3.edgeSoundsRaw === undefined && o3.edgeSetsRaw === undefined, 'raw 未定义不动作');
}

console.log('== timelineNodeHit: 折返点/尾命中, 头不命中');
{
  // slider: time=1000, end=3000, slides=2 → 节点 k=1 @2000, k=2(尾) @3000
  // t0=0, win=6000, width=600 → 0.1 px/ms: 头@100, k1@200, 尾@300
  const objs = [{ id: 1, time: 1000 }, { id: 2, time: 5000 }];
  const endOf = (o: { id: number; time: number }) => o.id === 1 ? 3000 : 5000;
  const spansOf = (o: { id: number; time: number }) => o.id === 1 ? 2 : 0; // id2 非滑条
  const hit = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 200, 24);
  assert(hit?.id === 1 && hit.edge === 1, `命中折返点 k=1 (实际 ${JSON.stringify(hit)})`);
  const tail = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 298, 24);
  assert(tail?.id === 1 && tail.edge === 2, `命中尾端 k=2 (实际 ${JSON.stringify(tail)})`);
  const head = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 100, 24);
  assert(head === null, '头圆不命中 (头走物件级选中)');
  const miss = timelineNodeHit(objs, endOf, spansOf, 0, 6000, 600, 500, 24);
  assert(miss === null, '非滑条/空白不命中');
  // 近者胜: 两条滑条节点重叠时取距离更近的
  const objs2 = [{ id: 1, time: 1000 }, { id: 3, time: 1000 }];
  const endOf2 = (o: { id: number; time: number }) => 3000;
  const spansOf2 = () => 2;
  const nearHit = timelineNodeHit(objs2, endOf2, spansOf2, 0, 6000, 600, 201, 24);
  assert(nearHit !== null && (nearHit.id === 1 || nearHit.id === 3), `重叠节点近者胜 (实际 ${JSON.stringify(nearHit)})`);
  // 窗口外不命中
  const out = timelineNodeHit(objs, endOf, spansOf, 4000, 6000, 600, 200, 24);
  assert(out === null, '窗口外不命中');
}

if (failures) { console.error(`TESTS FAILED: ${failures}`); process.exit(1); }
console.log('TESTS ALL PASSED');

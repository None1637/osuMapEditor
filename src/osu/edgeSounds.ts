// v213: 滑条 per-edge (头/折返点/尾) hitsound — 纯函数 (时间轴节点选中加音效, 对齐 osu!stable)
// 数据: HitObject.edgeSoundsRaw = "0|2|0" (slides+1 段, k=0 头, 1..slides 各 span 终点);
//       raw 缺省/段缺失时该端点回落物件级 hitSound (与 hitSounds.ts 播放端 nodeSounds 同语义)
import type { HitObject } from './parser';

const segCount = (o: HitObject) => (o.slides ?? 1) + 1;

/** 有效 per-edge 音效位 (长 slides+1; raw 缺省/段缺失/段非法 → 回落 o.hitSound) */
export function parseEdgeSounds(o: HitObject): number[] {
  const n = segCount(o);
  const raw = o.edgeSoundsRaw?.split('|');
  const fb = o.hitSound ?? 0;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const v = raw?.[k] !== undefined ? parseInt(raw[k]) : NaN;
    out.push(Number.isFinite(v) ? v : fb);
  }
  return out;
}

/**
 * 置/清某个端点的音效位。raw 未定义时先按当前有效值 materialize 全部段
 * (每段 = 现状听感), 再改目标段 — 保证只有目标端点的声音变化, 其余端点不受影响。
 */
export function setEdgeSoundBit(o: HitObject, edgeIdx: number, bit: number, on: boolean) {
  const cur = parseEdgeSounds(o);
  if (edgeIdx < 0 || edgeIdx >= cur.length) return;
  cur[edgeIdx] = on ? (cur[edgeIdx] | bit) : (cur[edgeIdx] & ~bit);
  o.edgeSoundsRaw = cur.join('|');
}

/** 三态批量切换 (与 store.toggleSelectedHitSound 同语义): 目标段未全含 bit 则全部置位, 否则全部清位 */
export function toggleEdgesHitSound(targets: { o: HitObject; edge: number }[], bit: number) {
  if (!targets.length) return;
  const allOn = targets.every(t => (parseEdgeSounds(t.o)[t.edge] ?? 0) & bit);
  for (const t of targets) setEdgeSoundBit(t.o, t.edge, bit, !allOn);
}

/** 物件级音效位同步到已 materialize 的 edge 串所有段 (stable: 整条滑条选中时音效作用到所有节点) */
export function setEdgeSoundBitAll(o: HitObject, bit: number, on: boolean) {
  const cur = parseEdgeSounds(o);
  o.edgeSoundsRaw = cur.map(v => on ? (v | bit) : (v & ~bit)).join('|');
}

/**
 * slides 变化后同步 edgeSoundsRaw/edgeSetsRaw 段数 (截断或按默认段补长; raw 未定义不动作)。
 * 缺段数的 raw 会让播放端 ?? 回落静默错位 (如拖尾改折返数后)。
 */
export function resizeEdgeStrings(o: HitObject) {
  const n = segCount(o);
  if (o.edgeSoundsRaw !== undefined) {
    const segs = o.edgeSoundsRaw.split('|');
    o.edgeSoundsRaw = segs.length > n ? segs.slice(0, n).join('|')
      : segs.length < n ? [...segs, ...new Array(n - segs.length).fill('0')].join('|')
        : o.edgeSoundsRaw;
  }
  if (o.edgeSetsRaw !== undefined) {
    const segs = o.edgeSetsRaw.split('|');
    o.edgeSetsRaw = segs.length > n ? segs.slice(0, n).join('|')
      : segs.length < n ? [...segs, ...new Array(n - segs.length).fill('0:0')].join('|')
        : o.edgeSetsRaw;
  }
}

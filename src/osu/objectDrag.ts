// v613/v614: 物件拖拽几何快照 — 反转/旋转/镜像/微调的离散变换后重建基准, 防止旧 orig 覆盖新形状
import type { HitObject } from './parser';
import { SliderPath } from './sliderPath';
import type { Pt } from './objectSnap';

export interface ObjectDragOrigin { x: number; y: number; curve?: Pt[] }
export interface ObjectDragGeometry {
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  orig: Map<number, ObjectDragOrigin>;
  tails: Map<number, Pt>;
  transformSeq: number;
}

export function snapshotObjectDragGeometry(objs: Map<number, HitObject>): Pick<ObjectDragGeometry, 'orig' | 'tails'> {
  return {
    orig: new Map([...objs].map(([id, o]) => [id, { x: o.x, y: o.y, curve: o.curvePoints?.map(c => ({ ...c })) }])),
    tails: new Map([...objs].map(([id, o]) => {
      if (o.type !== 'slider' || !o.curvePoints?.length) return [id, null] as const;
      const path = new SliderPath(o.curveType ?? 'L', [{ x: o.x, y: o.y }, ...o.curvePoints], o.length ?? 100);
      return [id, path.positionAt((o.slides ?? 1) % 2 === 0 ? 0 : (o.length ?? path.totalLength))] as const;
    }).filter(([, t]) => t !== null) as [number, Pt][]),
  };
}

/** 离散变换后从最后已应用指针重新起算: 不追加旧位移, 也不要求用户先松开再拖一次 */
export function rebaseObjectDragAfterTransform<T extends ObjectDragGeometry>(d: T, pointer: Pt, transformSeq: number, objs: Map<number, HitObject>): void {
  d.startX = pointer.x;
  d.startY = pointer.y;
  d.deltaX = 0;
  d.deltaY = 0;
  const snap = snapshotObjectDragGeometry(objs);
  d.orig = snap.orig;
  d.tails = snap.tails;
  d.transformSeq = transformSeq;
}

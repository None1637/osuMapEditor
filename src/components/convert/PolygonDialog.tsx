// v64 多边形生成弹窗 (lazer PolygonGenerationPopover): 圆心固定游玩区中心 (256,192), 实时预览 + 参数记忆 + 一次 undo
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams } from '../DraggableDialog';
import { computePolygon, DEFAULT_POLYGON_PARAMS, POLYGON_LIMITS as L, type PolygonParams } from '@/osu/convert/polygon';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-white/50">{label}</span>
    {children}
  </div>
);

export function PolygonDialog() {
  useEditor();
  const bm = store.beatmap;
  const [params, setParams] = useState<PolygonParams>(() => {
    const p = loadParams('polygon', DEFAULT_POLYGON_PARAMS);
    // 首个物件 newCombo 跟随当前选区 NC 状态 (lazer 绑定 SelectionNewComboState)
    p.newCombo = !!bm && store.selected.size > 0
      && bm.hitObjects.filter(o => store.selected.has(o.id)).every(o => !!o.newCombo);
    return p;
  });

  const result = useMemo(
    () => (bm ? computePolygon(bm, store.currentTime, store.beatSnap, params) : { objects: [], outOfBounds: false, startTime: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, params, store.currentTime, store.beatSnap],
  );
  useEffect(() => {
    store.setConversionPreview(result.objects.length ? { hideIds: [], objects: result.objects } : null);
    return () => store.setConversionPreview(null);
  }, [result]);

  if (!bm) return null;
  const upd = (patch: Partial<PolygonParams>) => setParams(p => ({ ...p, ...patch }));

  return (
    <DraggableDialog title="多边形生成" testid="polygon" onClose={() => store.closeConversion()}>
      <Row label="顶点数">
        <DraftNum value={params.vertices} testid="vertices" min={L.vertices[0]} max={L.vertices[1]}
          set={v => upd({ vertices: Math.round(v) })} />
        <span className="text-white/40">{L.vertices[0]}–{L.vertices[1]}</span>
      </Row>
      <Row label="圈数">
        <DraftNum value={params.repeats} testid="repeats" min={L.repeats[0]} max={L.repeats[1]}
          set={v => upd({ repeats: Math.round(v) })} />
        <span className="text-white/40">{L.repeats[0]}–{L.repeats[1]}</span>
      </Row>
      <Row label="起始角 °">
        <DraftNum value={params.offsetAngle} testid="offsetAngle" min={L.offsetAngle[0]} max={L.offsetAngle[1]}
          set={v => upd({ offsetAngle: Math.round(v) })} />
        <span className="text-white/40">{L.offsetAngle[0]}–{L.offsetAngle[1]}</span>
      </Row>
      <Row label="间距倍率">
        <DraftNum value={params.distanceSnap} testid="distanceSnap" min={L.distanceSnap[0]} max={L.distanceSnap[1]} step={0.1}
          set={v => upd({ distanceSnap: Math.round(v * 10) / 10 })} />
        <span className="text-white/40">{L.distanceSnap[0]}–{L.distanceSnap[1]} (同锁定间距 1x)</span>
      </Row>
      <Row label="新 Combo">
        <input type="checkbox" checked={params.newCombo} data-conv="newCombo"
          onChange={e => upd({ newCombo: e.target.checked })} />
        <span className="text-white/40">仅首个物件</span>
      </Row>
      <div className="text-white/40">
        起始 {result.startTime}ms · 圆心 (256,192) · 将生成 {params.vertices * params.repeats} 个单点
      </div>
      {result.outOfBounds && <div className="text-red-300">顶点超出游玩区, 无法创建 (lazer 同款)</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { saveParams('polygon', params); store.applyConversion([], result.objects); }}
          disabled={!result.objects.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          创建
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">取消</button>
      </div>
    </DraggableDialog>
  );
}

// v65 批量复制弹窗: 选中物件复制 N 份到后续时间 (次数/间隔拍/每份旋转角/每份平移向量)
// v166: 锚点三模式改用独立的 store.dupOriginMode/dupCustomOrigin (与左侧栏变换互不影响; 画布上的自定义点拖拽同样生效)
// v68: 可选同时复制物件范围内绿线 (滑条 = 整条 duration); 向量≠0 时画布绘制箭头, 拖箭头头改向量
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams } from '../DraggableDialog';
import { computeDuplicate, computeDuplicateTiming, computeDuplicateScaleTiming, DEFAULT_DUPLICATE_PARAMS, type DuplicateParams } from '@/osu/duplicate';
import { sliderTailPoint } from '@/osu/objectSnap';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-white/50">{label}</span>
    {children}
  </div>
);

export function DuplicateDialog() {
  useEditor();
  const [params, setParams] = useState<DuplicateParams>(() => loadParams('duplicate', DEFAULT_DUPLICATE_PARAMS));
  const bm = store.beatmap;
  const objs = useMemo(
    () => (bm ? bm.hitObjects.filter(o => store.selected.has(o.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, store.selected, store.conversionDialog],
  );

  const originMode = store.dupOriginMode; // v166: 独立原点 (不再复用左侧栏变换的 originMode)
  const result = useMemo(() => {
    if (!bm) return [];
    const origin = originMode === 'custom' ? store.dupCustomOrigin : originMode;
    return computeDuplicate(bm, objs, origin, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, objs, params, originMode, store.dupCustomOrigin]);
  // v68: 绿线副本 (预览上时间轴 + 应用时一并写入)
  const timing = useMemo(
    () => (bm ? computeDuplicateTiming(bm, objs, params) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, objs, params],
  );
  // v116: 缩放滑条的补偿绿线 (生效 SV 判定含上方绿线副本)
  const scaleTiming = useMemo(
    () => (bm ? computeDuplicateScaleTiming(bm, objs, params, timing) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, objs, params, timing],
  );
  const allTiming = useMemo(() => [...timing, ...scaleTiming], [timing, scaleTiming]);
  useEffect(() => {
    store.setConversionPreview(result.length ? { hideIds: [], objects: result, timingPoints: allTiming } : null);
    return () => store.setConversionPreview(null);
  }, [result, allTiming]);
  // v68: 向量箭头视图 (画布绘制/拖拽); 锚 = 第一批(源)物件结尾 — 最后源物件的结束位置 (滑条取尾端)
  useEffect(() => {
    if (!bm || !objs.length || (params.dx === 0 && params.dy === 0)) { store.dupVectorView = null; return; }
    const last = [...objs].sort((a, b) => (a.endTime ?? a.time) - (b.endTime ?? b.time)).at(-1)!;
    const anchor = last.type === 'slider' ? sliderTailPoint(bm, last) : { x: last.x, y: last.y };
    store.dupVectorView = { anchor, dx: params.dx, dy: params.dy };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, objs, params.dx, params.dy]);
  useEffect(() => {
    store.dupVectorDragHandler = (dx, dy) => setParams(p => ({ ...p, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 }));
    return () => { store.dupVectorDragHandler = null; store.dupVectorView = null; };
  }, []);

  if (!bm) return null;
  const upd = (patch: Partial<DuplicateParams>) => setParams(p => ({ ...p, ...patch }));
  const noAnchor = originMode === 'selection' && objs.every(o => o.type === 'spinner');

  return (
    <DraggableDialog title={`批量复制 (${objs.length} 个源物件)`} testid="duplicate" onClose={() => store.closeConversion()}>
      <Row label="复制次数">
        <DraftNum value={params.count} testid="count" min={1} max={99} set={v => upd({ count: Math.round(v) })} />
      </Row>
      <Row label="间隔 (拍)">
        <DraftNum value={params.intervalBeats} testid="intervalBeats" min={0.25} max={64} step={0.25}
          set={v => upd({ intervalBeats: v })} />
        <span className="text-white/40">每份相对上一份</span>
      </Row>
      <Row label="旋转 °/份">
        <DraftNum value={params.rotateDeg} testid="rotateDeg" min={-360} max={360}
          set={v => upd({ rotateDeg: v })} />
        <span className="text-white/40">顺时针为正</span>
      </Row>
      <Row label="向量/份">
        <DraftNum value={params.dx} testid="dx" min={-512} max={512} set={v => upd({ dx: v })} />
        <DraftNum value={params.dy} testid="dy" min={-512} max={512} set={v => upd({ dy: v })} />
        <span className="text-white/40">dx, dy px · 非 0 时画布可拖箭头</span>
      </Row>
      <Row label="复制绿线">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={params.copyGreenLines} data-conv="copyGreenLines"
            onChange={e => upd({ copyGreenLines: e.target.checked })} />
          同时复制物件范围内的绿线{timing.length > 0 && <span className="text-white/40">(将生成 {timing.length} 条)</span>}
        </label>
      </Row>
      {/* v116: 每份递增缩放 — 第 i 份 = 1 + i×缩放/份; 勾选后滑条参与缩放并加补偿绿线 (头 SV×s / 尾还原, 时长不变) */}
      <Row label="缩放/份">
        <DraftNum value={params.scalePerCopy} testid="scalePerCopy" min={-0.99} max={5} step={0.05}
          set={v => upd({ scalePerCopy: v })} />
        <span className="text-white/40">第 i 份 = 1 + i×此值</span>
      </Row>
      <Row label="绿线缩放">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={params.scaleSlidersGreenLines} data-conv="scaleSlidersGreenLines"
            onChange={e => upd({ scaleSlidersGreenLines: e.target.checked })} />
          添加绿线缩放滑条{scaleTiming.length > 0 && <span className="text-white/40">(将生成 {scaleTiming.length} 条)</span>}
        </label>
      </Row>
      <Row label="旋转锚点">
        {([['selection', '选区中心'], ['playfield', '游玩区中心'], ['custom', '自定义']] as const).map(([m, label]) => (
          <label key={m} className="flex items-center gap-0.5">
            <input type="radio" name="dup-origin" checked={originMode === m} data-conv={`origin-${m}`}
              onChange={() => store.setDupOriginMode(m)} />
            {label}
          </label>
        ))}
      </Row>
      {originMode === 'custom' && (
        <Row label="锚点坐标">
          <DraftNum value={store.dupCustomOrigin.x} testid="originX" set={v => store.setDupCustomOrigin({ x: v, y: store.dupCustomOrigin.y })} />
          <DraftNum value={store.dupCustomOrigin.y} testid="originY" set={v => store.setDupCustomOrigin({ x: store.dupCustomOrigin.x, y: v })} />
          <span className="text-white/40">画布上可拖拽</span>
        </Row>
      )}
      <div className="text-white/40">
        将生成 {objs.length} × {params.count} = {result.length} 个副本 (原物件保留, 预览已显示)
      </div>
      {noAnchor && <div className="text-red-300">只选中转盘时无选区锚点 (转盘位置固定)</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { saveParams('duplicate', params); store.applyConversion([], result, allTiming); }}
          disabled={!result.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          应用
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">取消</button>
      </div>
    </DraggableDialog>
  );
}

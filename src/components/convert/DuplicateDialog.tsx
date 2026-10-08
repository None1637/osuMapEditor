// v65 批量复制弹窗: 选中物件复制 N 份到后续时间 (次数/间隔拍/每份旋转角/每份平移向量)
// v166: 锚点三模式改用独立的 store.dupOriginMode/dupCustomOrigin (与左侧栏变换互不影响; 画布上的自定义点拖拽同样生效)
// v68: 可选同时复制物件范围内绿线 (滑条 = 整条 duration); 向量≠0 时画布绘制箭头, 拖箭头头改向量
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams, useSaveParamsOnClose } from '../DraggableDialog';
import { computeDuplicate, computeDuplicateTiming, computeDuplicateScaleTiming, DEFAULT_DUPLICATE_PARAMS, type DuplicateParams } from '@/osu/duplicate';
import { sliderTailPoint } from '@/osu/objectSnap';
import { useT } from '@/i18n';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  // v239: flex-wrap + label 禁换行 — 行宽不足时整组掉行, 不再把 label/「× 1 /」拦腰截断
  <div className="flex items-center gap-2 flex-wrap">
    <span className="min-w-16 whitespace-nowrap text-white/50">{label}</span>
    {children}
  </div>
);

// v239: 间隔 = a × 1/b 拍 (a,b 均为整数; 取代 v238 的单分数下拉); 内部仍存数字拍 intervalBeats = a/b
const BEAT_DENOMS = [1, 2, 3, 4, 6, 8, 12, 16];
// 数字拍分解 a/b: 取首个使 v*b 为整数 (a>=1) 的分母; 不可分解 (遗留小数) 回退 a=v, b=1
const splitBeat = (v: number): [number, number] => {
  for (const b of BEAT_DENOMS) {
    const a = v * b;
    if (Math.abs(a - Math.round(a)) < 1e-6 && Math.round(a) >= 1) return [Math.round(a), b];
  }
  return [v, 1];
};

export function DuplicateDialog() {
  useEditor();
  const t = useT();
  const [params, setParams] = useState<DuplicateParams>(() => loadParams('duplicate', DEFAULT_DUPLICATE_PARAMS));
  useSaveParamsOnClose('duplicate', params); // v242: 关窗 (含取消/X) 也保存
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
    <DraggableDialog title={t('convert.dup_title', 'Batch Duplicate ({n} source objects)', { n: objs.length })} testid="duplicate" onClose={() => store.closeConversion()}>
      <Row label={t('convert.dup_count', 'Copies')}>
        <DraftNum value={params.count} testid="count" min={1} max={99} set={v => upd({ count: Math.round(v) })} />
      </Row>
      <Row label={t('convert.dup_interval', 'Interval (beats)')}>
        {/* v239: a × 1/b 拍 (a,b 整数); 内部仍存数字拍; 遗留小数 a 取整后收敛; 整组 nowrap 不拦腰断行 */}
        {(() => {
          const [a, b] = splitBeat(params.intervalBeats);
          return (<>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <DraftNum value={a} testid="intervalNum" min={1} max={99}
                set={v => upd({ intervalBeats: Math.round(v) / b })} />
              <span className="text-white/40">× 1 /</span>
              <select value={String(b)} data-conv="intervalBeats"
                onChange={e => upd({ intervalBeats: a / parseInt(e.target.value) })}
                className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
                {BEAT_DENOMS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="text-white/40">{t('convert.dup_beat_unit', 'beats')}</span>
            </span>
            <span className="text-white/40">{t('convert.dup_interval_hint', 'Each copy relative to the previous')}</span>
          </>);
        })()}
      </Row>
      <Row label={t('convert.rotate_per_copy', 'Rotate °/copy')}>
        <DraftNum value={params.rotateDeg} testid="rotateDeg" min={-360} max={360}
          set={v => upd({ rotateDeg: v })} />
        <span className="text-white/40">{t('convert.clockwise_positive', 'Clockwise is positive')}</span>
      </Row>
      <Row label={t('convert.vector_per_copy', 'Vector/copy')}>
        <DraftNum value={params.dx} testid="dx" min={-512} max={512} set={v => upd({ dx: v })} />
        <DraftNum value={params.dy} testid="dy" min={-512} max={512} set={v => upd({ dy: v })} />
        <span className="text-white/40">{t('convert.dup_vector_hint', 'dx, dy px · drag arrow on canvas when non-zero')}</span>
      </Row>
      <Row label={t('convert.dup_copy_green', 'Copy Inherited Timing Points')}>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={params.copyGreenLines} data-conv="copyGreenLines"
            onChange={e => upd({ copyGreenLines: e.target.checked })} />
          {t('convert.dup_copy_green_lines', 'Also copy Inherited Timing Points within object range')}
          {timing.length > 0 && <span className="text-white/40">{t('convert.will_generate_count', '({n} will be generated)', { n: timing.length })}</span>}
        </label>
      </Row>
      {/* v116: 每份递增缩放 — 第 i 份 = 1 + i×缩放/份; 勾选后滑条参与缩放并加补偿绿线 (头 SV×s / 尾还原, 时长不变) */}
      <Row label={t('convert.scale_per_copy', 'Scale/copy')}>
        <DraftNum value={params.scalePerCopy} testid="scalePerCopy" min={-0.99} max={5} step={0.005} digits={3}
          set={v => upd({ scalePerCopy: v })} />
        <span className="text-white/40">{t('convert.scale_formula', 'copy i = 1 + i×this')}</span>
      </Row>
      <Row label={t('convert.dup_green_scale', 'Scale with Inherited Timing Points')}>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={params.scaleSlidersGreenLines} data-conv="scaleSlidersGreenLines"
            onChange={e => upd({ scaleSlidersGreenLines: e.target.checked })} />
          {t('convert.dup_add_scale_lines', 'Add Inherited Timing Points to scale sliders')}
          {scaleTiming.length > 0 && <span className="text-white/40">{t('convert.will_generate_count', '({n} will be generated)', { n: scaleTiming.length })}</span>}
        </label>
      </Row>
      <Row label={t('convert.dup_anchor', 'Rotation anchor')}>
        {([['selection', t('convert.origin_selection', 'Selection center')], ['playfield', t('convert.origin_playfield', 'Playfield center')], ['custom', t('convert.custom', 'Custom')]] as const).map(([m, label]) => (
          <label key={m} className="flex items-center gap-0.5">
            <input type="radio" name="dup-origin" checked={originMode === m} data-conv={`origin-${m}`}
              onChange={() => store.setDupOriginMode(m)} />
            {label}
          </label>
        ))}
      </Row>
      {originMode === 'custom' && (
        <Row label={t('convert.anchor_coords', 'Anchor coordinates')}>
          <DraftNum value={store.dupCustomOrigin.x} testid="originX" set={v => store.setDupCustomOrigin({ x: v, y: store.dupCustomOrigin.y })} />
          <DraftNum value={store.dupCustomOrigin.y} testid="originY" set={v => store.setDupCustomOrigin({ x: store.dupCustomOrigin.x, y: v })} />
          <span className="text-white/40">{t('convert.draggable_on_canvas', 'Draggable on canvas')}</span>
        </Row>
      )}
      <div className="text-white/40">
        {t('convert.dup_summary', 'Will create {a} × {b} = {n} copies (originals kept, shown in preview)', { a: objs.length, b: params.count, n: result.length })}
      </div>
      {noAnchor && <div className="text-red-300">{t('convert.dup_spinner_no_anchor', 'No selection anchor when only Spinners are selected (Spinner position is fixed)')}</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { saveParams('duplicate', params); store.applyConversion([], result, allTiming); }}
          disabled={!result.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          {t('convert.apply', 'Apply')}
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('convert.cancel', 'Cancel')}</button>
      </div>
    </DraggableDialog>
  );
}

// v486: 批量插入锚点 (弹簧滑条) 浮窗 — 沿主滑条按节拍间隔批量盖章子滑条模板 (computeAnchorStamp 纯函数,
//   本文件只管规则参数面板 + 预览/应用接线)。
// 主滑条在开窗时固定 (mainId) — 之后用户可在游玩区改选其他滑条用于「捕获」模板, 不像 SymSlider 那样跟踪选区。
// 预览期联动: 模板规则记 srcId 活链接, 游玩区拖源滑条锚点 (就地改对象) → sig 签名变 → 重算 → 预览实时更新
//   (SymSliderDialog :41 同款防死循环技巧 — sig 不变则 result 引用稳定)。
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams, useSaveParamsOnClose } from '../DraggableDialog';
import {
  captureTemplate, computeAnchorStamp, DEFAULT_ANCHOR_STAMP_PARAMS, newRule, STAMP_DENOMINATORS,
  type AnchorStampParams,
} from '@/osu/convert/anchorStamp';
import { useT } from '@/i18n';

/** a×1/b 拍 (分子 DraftNum + 分母 select, 到 1/128; DuplicateDialog 同款模式) */
const BeatFrac = ({ num, den, setNum, setDen, idNum, idDen }: {
  num: number; den: number; setNum: (v: number) => void; setDen: (v: number) => void; idNum: string; idDen: string;
}) => (
  <span className="flex items-center gap-1">
    <DraftNum value={num} testid={idNum} min={1} max={99} set={v => setNum(Math.round(v))} />
    <span className="text-white/40">×1/</span>
    <select value={den} data-conv={idDen} onChange={e => setDen(parseInt(e.target.value))}
      className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
      {STAMP_DENOMINATORS.map(d => <option key={d} value={d}>{d}</option>)}
      {!STAMP_DENOMINATORS.includes(den) && <option value={den}>{den}</option>}
    </select>
  </span>
);

export function AnchorStampDialog() {
  useEditor();
  const t = useT();
  // v488: 旧存档的规则无 rotate 字段 → 载入时补默认 90° (垂直)
  const [params, setParams] = useState<AnchorStampParams>(() => {
    const p = loadParams('anchorStamp', DEFAULT_ANCHOR_STAMP_PARAMS);
    return { ...p, rules: (p.rules ?? []).map(r => ({ ...r, rotate: Number.isFinite(r.rotate) ? r.rotate : 90 })) };
  });
  useSaveParamsOnClose('anchorStamp', params);
  const bm = store.beatmap;
  // 开窗时固定主滑条 (之后选区让给模板捕获); 物件被删/undo 后提示
  const [mainId] = useState<number | null>(() => {
    const b = store.beatmap;
    if (!b || store.selected.size !== 1) return null;
    const o = b.hitObjects.find(x => store.selected.has(x.id));
    return o && o.type === 'slider' ? o.id : null;
  });
  const main = useMemo(() => {
    const o = bm && mainId !== null ? bm.hitObjects.find(x => x.id === mainId) : null;
    return o && o.type === 'slider' ? o : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, mainId, store.historySeq]); // v476: historySeq — undo/redo 后 bm 引用不变
  // sig: 主滑条 + 所有活链接源滑条的几何签名 (节点就地拖拽后签名变 → 预览重算)
  const sig = useMemo(() => {
    if (!bm) return '';
    const parts: (string | number)[] = [];
    const push = (o: { x: number; y: number; curveType?: string; length?: number; curvePoints?: { x: number; y: number }[] }) =>
      parts.push(o.x, o.y, o.curveType ?? '', o.length ?? 0, ...(o.curvePoints ?? []).map(p => `${p.x},${p.y}`));
    if (main) push(main);
    for (const r of params.rules) {
      const s = r.srcId !== null ? bm.hitObjects.find(o => o.id === r.srcId) : null;
      if (s) { parts.push(s.id); push(s); }
    }
    return parts.join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, main, params.rules, store.historySeq, store.getVersion()]); // getVersion: 节点拖拽 commitDragFrame 只 bump version
  const result = useMemo(
    () => (bm && main ? computeAnchorStamp(bm, main, params) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, main, params, sig],
  );
  useEffect(() => {
    store.setConversionPreview(main && result?.object
      ? { hideIds: [main.id], objects: [result.object], timingPoints: result.svLines }
      : null);
    return () => store.setConversionPreview(null);
  }, [result, main]);

  if (!bm) return null;
  const upd = (patch: Partial<AnchorStampParams>) => setParams(p => ({ ...p, ...patch }));
  const updRule = (i: number, patch: Partial<AnchorStampParams['rules'][number]>) =>
    setParams(p => ({ ...p, rules: p.rules.map((r, k) => k === i ? { ...r, ...patch } : r) }));
  // 捕获: 当前选中的第一根非主滑条 (都没有则允许主滑条自身) → 快照 + srcId 活链接
  const capture = (i: number) => {
    const sels = bm.hitObjects.filter(o => store.selected.has(o.id) && o.type === 'slider');
    const sel = sels.find(o => o.id !== mainId) ?? sels[0];
    if (!sel) return;
    updRule(i, { srcId: sel.id, template: captureTemplate(sel) });
  };

  return (
    <DraggableDialog title={t('convert.stamp_title', 'Insert Anchors (Spring)')} testid="anchorStamp" width={430} onClose={() => store.closeConversion()}>
      {!main && <div className="text-red-300">{t('convert.stamp_need_main', 'No main slider (re-select 1 slider and reopen)')}</div>}
      {params.rules.map((r, i) => {
        const live = r.srcId !== null && bm.hitObjects.some(o => o.id === r.srcId && o.type === 'slider');
        const tplLabel = r.template ? `${r.template.curveType}/${r.template.points.length}` : null;
        return (
          <div key={i} className="rounded border border-white/10 p-2 space-y-1.5" data-conv={`rule-${i}`}>
            <div className="flex items-center gap-2">
              <span className="text-white/50">{t('convert.stamp_priority', 'Priority')}</span>
              <DraftNum value={r.priority} testid={`priority-${i}`} min={1} max={99} set={v => updRule(i, { priority: Math.round(v) })} />
              <button data-conv={`capture-${i}`} onClick={() => capture(i)}
                className="px-2 py-0.5 rounded bg-cyan-600/70 hover:bg-cyan-500 text-white">
                {tplLabel ? `${tplLabel}${live ? ` (${t('convert.stamp_live', 'live')})` : ''}` : t('convert.stamp_capture', 'Capture selected slider')}
              </button>
              <button data-conv={`del-${i}`} onClick={() => setParams(p => ({ ...p, rules: p.rules.filter((_, k) => k !== i) }))}
                className="ml-auto px-1.5 rounded hover:bg-white/15 text-white/60">✕</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/50">{t('convert.stamp_interval', 'Interval')}</span>
              <BeatFrac num={r.intervalNum} den={r.intervalDen} idNum={`interval-num-${i}`} idDen={`interval-den-${i}`}
                setNum={v => updRule(i, { intervalNum: v })} setDen={v => updRule(i, { intervalDen: v })} />
              <span className="text-white/50">{t('convert.stamp_erase', 'Erase')}</span>
              <BeatFrac num={r.eraseNum} den={r.eraseDen} idNum={`erase-num-${i}`} idDen={`erase-den-${i}`}
                setNum={v => updRule(i, { eraseNum: v })} setDen={v => updRule(i, { eraseDen: v })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/50">{t('convert.stamp_rotate', 'Rotate')}</span>
              <DraftNum value={r.rotate} testid={`rotate-${i}`} min={-360} max={360} step={1} set={v => updRule(i, { rotate: v })} />
              <span className="text-white/40">°</span>
              <span className="text-white/30 text-xs">{t('convert.stamp_rotate_hint', '(90 = perpendicular to main slider, 0 = along tangent)')}</span>
            </div>
          </div>
        );
      })}
      <div>
        <button data-conv="add-rule" onClick={() => setParams(p => ({ ...p, rules: [...p.rules, newRule(p.rules.length + 1)] }))}
          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">{t('convert.stamp_add_rule', '+ Add rule')}</button>
      </div>
      <label className="flex items-center gap-2 text-white/70">
        <input type="checkbox" checked={params.keepDuration} data-conv="keep-duration" onChange={e => upd({ keepDuration: e.target.checked })} />
        {t('convert.stamp_keep_duration', 'Keep main slider duration (adjust SV)')}
      </label>
      {params.keepDuration && result?.svPreview && (
        <div className="text-white/60" data-conv="sv-preview">
          {t('convert.stamp_sv_preview', 'SV: {from} → {to}', { from: result.svPreview.from.toFixed(2), to: result.svPreview.to.toFixed(2) })}
        </div>
      )}
      {result && result.stamps > 0 && (
        <div className="text-white/40">{t('convert.stamp_summary', 'Will insert {n} template(s) (preview shown in playfield)', { n: result.stamps })}</div>
      )}
      {result?.warnings.map((w, i) => <div key={i} className="text-amber-300/90">{w}</div>)}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => {
            if (!main || !result?.object) return;
            saveParams('anchorStamp', params);
            store.applyConversion([main.id], [result.object], [], result.applyTiming);
          }}
          disabled={!main || !result?.object}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          {t('convert.apply', 'Apply')}
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('convert.cancel', 'Cancel')}</button>
      </div>
    </DraggableDialog>
  );
}

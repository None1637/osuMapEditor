// F2 参数窗口: 滑条等时间拆分 (实时预览 + 参数持久化, 照 StreamDialog 模式)
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams, useSaveParamsOnClose } from '../DraggableDialog';
import { computeSplit, DEFAULT_SPLIT_PARAMS, type SplitParams } from '@/osu/convert/split';
import { useT } from '@/i18n';

// v41 修复: Row 提升到模块级 (组件内定义 = 每次渲染新组件类型 -> 子树重挂载 -> 输入框击键即失焦)
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 text-white/50">{label}</span>
    {children}
  </div>
);

export function SplitDialog() {
  useEditor();
  const t = useT();
  const [params, setParams] = useState<SplitParams>(() => loadParams('split', DEFAULT_SPLIT_PARAMS));
  useSaveParamsOnClose('split', params); // v242: 关窗 (含取消/X) 也保存
  const bm = store.beatmap;
  // 仅单选滑条时可用 (Inspector 只在单选滑条时给入口; 这里兜底校验)
  const slider = useMemo(() => {
    if (!bm) return null;
    const sel = bm.hitObjects.filter(o => store.selected.has(o.id) && o.type === 'slider');
    return sel.length === 1 ? sel[0] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, store.selected, store.conversionDialog]);

  // 实时预览: 参数/选区变化即重算; 非法参数不生成预览
  // v346: 「未选滑条」提示在渲染期 t() (语言切换即时生效), 不塞进 useMemo 缓存
  const result = useMemo(
    () => (bm && slider ? computeSplit(bm, slider, params) : { objects: [], error: undefined }),
    [bm, slider, params],
  );
  const error = result.error ?? (slider ? undefined : t('convert.split_select_one', 'Please select a single slider'));
  useEffect(() => {
    store.setConversionPreview(slider && result.objects.length ? { hideIds: [slider.id], objects: result.objects } : null);
    return () => store.setConversionPreview(null);
  }, [result, slider]);

  if (!bm) return null;
  const upd = (patch: Partial<SplitParams>) => setParams(p => ({ ...p, ...patch }));

  return (
    <DraggableDialog title={t('convert.split_title', 'Split Slider (equal time)')} testid="split" onClose={() => store.closeConversion()}>
      <Row label={t('convert.split_count', 'Split count')}>
        <DraftNum value={params.count} set={v => upd({ count: Math.round(v) })} testid="count" min={2} max={64} />
        <span className="text-white/40">{t('convert.split_count_hint', '2–64 segments, equal path length')}</span>
      </Row>
      <Row label={t('convert.split_time_gap', 'Time gap ms')}>
        <DraftNum value={params.timeGap} set={v => upd({ timeGap: Math.max(0, v) })} testid="time-gap" min={0} />
        <span className="text-white/40">{t('convert.split_time_gap_hint', '0 = end-to-start')}</span>
      </Row>
      <Row label={t('convert.split_dist_gap', 'Distance gap px')}>
        <DraftNum value={params.distGap} set={v => upd({ distGap: Math.max(0, v) })} testid="dist-gap" min={0} />
        <span className="text-white/40">{t('convert.split_dist_gap_hint', '0 = no gap on path')}</span>
      </Row>
      {error
        ? <div className="text-red-300" data-conv="error">{error}</div>
        : <div className="text-white/40">{t('convert.split_summary', 'Will create {n} slider segments (preview shown on Playfield)', { n: result.objects.length })}</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { if (!slider) return; saveParams('split', params); store.applyConversion([slider.id], result.objects); }}
          disabled={!slider || !result.objects.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          {t('convert.apply', 'Apply')}
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('convert.cancel', 'Cancel')}</button>
      </div>
    </DraggableDialog>
  );
}

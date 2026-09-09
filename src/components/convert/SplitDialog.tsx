// F2 参数窗口: 滑条等时间拆分 (实时预览 + 参数持久化, 照 StreamDialog 模式)
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams, useSaveParamsOnClose } from '../DraggableDialog';
import { computeSplit, DEFAULT_SPLIT_PARAMS, type SplitParams } from '@/osu/convert/split';

// v41 修复: Row 提升到模块级 (组件内定义 = 每次渲染新组件类型 -> 子树重挂载 -> 输入框击键即失焦)
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 text-white/50">{label}</span>
    {children}
  </div>
);

export function SplitDialog() {
  useEditor();
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
  const result = useMemo(
    () => (bm && slider ? computeSplit(bm, slider, params) : { objects: [], error: slider ? undefined : '请选中单个滑条' }),
    [bm, slider, params],
  );
  useEffect(() => {
    store.setConversionPreview(slider && result.objects.length ? { hideIds: [slider.id], objects: result.objects } : null);
    return () => store.setConversionPreview(null);
  }, [result, slider]);

  if (!bm) return null;
  const upd = (patch: Partial<SplitParams>) => setParams(p => ({ ...p, ...patch }));

  return (
    <DraggableDialog title="拆分滑条 (等时间)" testid="split" onClose={() => store.closeConversion()}>
      <Row label="拆分数">
        <DraftNum value={params.count} set={v => upd({ count: Math.round(v) })} testid="count" min={2} max={64} />
        <span className="text-white/40">2~64 段, 路径等长</span>
      </Row>
      <Row label="时间间隙 ms">
        <DraftNum value={params.timeGap} set={v => upd({ timeGap: Math.max(0, v) })} testid="time-gap" min={0} />
        <span className="text-white/40">0 = 首尾相接</span>
      </Row>
      <Row label="距离间隙 px">
        <DraftNum value={params.distGap} set={v => upd({ distGap: Math.max(0, v) })} testid="dist-gap" min={0} />
        <span className="text-white/40">0 = 路径无间隔</span>
      </Row>
      {result.error
        ? <div className="text-red-300" data-conv="error">{result.error}</div>
        : <div className="text-white/40">将生成 {result.objects.length} 段滑条 (预览已显示在游玩区)</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { if (!slider) return; saveParams('split', params); store.applyConversion([slider.id], result.objects); }}
          disabled={!slider || !result.objects.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          应用
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">取消</button>
      </div>
    </DraggableDialog>
  );
}

// F1 参数窗口: 滑条转连打 (实时预览 + 参数持久化)
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams, useSaveParamsOnClose } from '../DraggableDialog';
import { computeStream, DEFAULT_STREAM_PARAMS, type StreamCurve, type StreamParams } from '@/osu/convert/stream';
import { useT } from '@/i18n';

// v40: 曲线简化 — 等距/线性变化/先加后减/先减后加; v222: + 指数变化 (带指数参数)
// v346: i18n — 元组为 [曲线值, t() 键后缀, 英文原文], 渲染时 t(`convert.${key}`, en)
const CURVES: [StreamCurve, string, string][] = [
  ['equal', 'curve_equal', 'Constant'],
  ['linear', 'curve_linear', 'Linear'],
  ['bell', 'curve_bell', 'Up then down'],
  ['bellInv', 'curve_bell_inv', 'Down then up'],
  ['expo', 'curve_expo', 'Exponential'],
];

// v41: 间距改节拍下拉框 (与节拍吸附同一组分母)
const SPACINGS: [number, string][] = [1, 2, 3, 4, 6, 8, 12, 16].map(n => [1 / n, `1/${n}`]);

// v41 修复: Row 必须在模块级 — 组件内定义每次渲染都是新组件类型, 整棵子树重挂载,
// 击键 -> params 变化 -> 输入框被替换 -> 失焦, 全选重打「100」只能进第一位
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-white/50">{label}</span>
    {children}
  </div>
);

/** 载入参数: 遗留曲线值 (v36 加速/减速) 映射到线性 */
function loadStreamParams(): StreamParams {
  const p = loadParams('stream', DEFAULT_STREAM_PARAMS);
  if (p.curve === 'accel' || p.curve === 'decel') p.curve = 'linear';
  return p;
}

export function StreamDialog() {
  useEditor();
  const t = useT();
  const [params, setParams] = useState<StreamParams>(loadStreamParams);
  useSaveParamsOnClose('stream', params); // v242: 关窗 (含取消/X) 也保存
  const bm = store.beatmap;
  const sliders = useMemo(
    () => (bm ? bm.hitObjects.filter(o => store.selected.has(o.id) && o.type === 'slider') : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, store.selected, store.conversionDialog],
  );

  // 实时预览: 参数/选区变化即重算 (预览物件 id 每次重算会变, 没关系 — 渲染层不按 id 缓存圆)
  const result = useMemo(
    () => (bm && sliders.length ? computeStream(bm, sliders, params) : []),
    [bm, sliders, params],
  );
  useEffect(() => {
    store.setConversionPreview(result.length ? { hideIds: sliders.map(s => s.id), objects: result } : null);
    return () => store.setConversionPreview(null);
  }, [result, sliders]);

  if (!bm) return null;
  const upd = (patch: Partial<StreamParams>) => setParams(p => ({ ...p, ...patch }));
  const variable = params.curve !== 'equal';

  return (
    <DraggableDialog title={t('convert.stream_title', 'Slider to Stream ({n} sliders)', { n: sliders.length })} testid="stream" onClose={() => store.closeConversion()}>
      <Row label={t('convert.stream_method', 'Method')}>
        {([['spacing', t('convert.stream_mode_spacing', 'By spacing')], ['count', t('convert.stream_mode_count', 'By count')]] as const).map(([m, label]) => (
          <label key={m} className="flex items-center gap-0.5">
            <input type="radio" name="stream-mode" checked={params.mode === m} data-conv={`mode-${m}`} onChange={() => upd({ mode: m })} />
            {label}
          </label>
        ))}
      </Row>
      {params.mode === 'count' && (
        <Row label={t('convert.stream_count', 'Count')}><DraftNum value={params.count} set={v => upd({ count: Math.max(1, Math.round(v)) })} testid="count" min={1} /></Row>
      )}
      {/* v42: 两种模式都有间距 (拍) — 按间距 = 生成间隔; 按数量 = 时间吸附到此节拍网格 */}
      <Row label={t('convert.stream_spacing', 'Spacing (beats)')}>
        <select value={String(params.spacingBeats)} data-conv="spacing"
          onChange={e => upd({ spacingBeats: parseFloat(e.target.value) })}
          className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
          {SPACINGS.map(([v, label]) => <option key={label} value={String(v)}>{label}</option>)}
          {/* 遗留持久化值不在列表时兜底显示, 避免 select 显示错位 */}
          {!SPACINGS.some(([v]) => Math.abs(v - params.spacingBeats) < 1e-9) &&
            <option value={String(params.spacingBeats)}>{params.spacingBeats}</option>}
        </select>
        {params.mode === 'count' && <span className="text-white/40">{t('convert.stream_snap_hint', 'Time snaps to grid')}</span>}
      </Row>
      <Row label={t('convert.stream_curve', 'Spacing curve')}>
        <select value={params.curve} data-conv="curve" onChange={e => upd({ curve: e.target.value as StreamCurve })}
          className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
          {CURVES.map(([c, k, en]) => <option key={c} value={c}>{t(`convert.${k}`, en)}</option>)}
        </select>
      </Row>
      {variable && (
        <Row label={t('convert.stream_end_percent', 'Ramp to %')}>
          <DraftNum value={params.endPercent} set={v => upd({ endPercent: Math.max(0, Math.min(400, v)) })} testid="end-percent" min={0} max={400} />
          <span className="text-white/40">100→{params.endPercent}% ({params.endPercent < 100 ? t('convert.stream_denser', 'denser') : params.endPercent > 100 ? t('convert.stream_sparser', 'sparser') : t('convert.stream_unchanged', 'unchanged')})</span>
        </Row>
      )}
      {/* v222: 指数参数 (两位小数) — 仅指数变化曲线时显示; 1=同线性, >1 前慢后快, <1 前快后慢 */}
      {params.curve === 'expo' && (
        <Row label={t('convert.stream_exponent', 'Exponent')}>
          <DraftNum value={params.exponent} set={v => upd({ exponent: Math.round(Math.max(0.01, Math.min(10, v)) * 100) / 100 })} testid="exponent" min={0.01} max={10} step={0.01} />
          <span className="text-white/40">{params.exponent === 1 ? t('convert.stream_expo_linear', 'Same as linear') : params.exponent > 1 ? t('convert.stream_expo_slow_fast', 'Slow then fast') : t('convert.stream_expo_fast_slow', 'Fast then slow')}</span>
        </Row>
      )}
      <div className="text-white/40">{t('convert.stream_summary', 'Will create {n} Hit Circles (preview shown on Playfield)', { n: result.length })}</div>
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => { saveParams('stream', params); store.applyConversion(sliders.map(s => s.id), result); }}
          disabled={!result.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          {t('convert.apply', 'Apply')}
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('convert.cancel', 'Cancel')}</button>
      </div>
    </DraggableDialog>
  );
}

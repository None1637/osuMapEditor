import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react'; // v181: ✕ → lucide
import { store, useEditor, usePlaybackFrame } from '@/osu/store';
import type { TimingPoint } from '@/osu/parser';
import { defaultNewPoint, setEffectBit, EFFECT_KIAI, EFFECT_OMIT_BARLINE, formatMsTime, activeGreenAt, scrollTargetIndex } from '@/osu/timingEdit';
import { hotkeyLabel } from '@/osu/hotkeys'; // v321 (F21): 快捷键提示随改键同步
import { useT } from '@/i18n';

// Timing 面板: 增删改红线(BPM)/绿线(SV), 以及难度参数 CS/AR/OD/HP
// v70: full 模式改为紧凑独立窗口 (w-fit 居中, 行高紧凑, 属性连续排版并居中);
//   时间输入框后带 h:mm:ss.mmm 显示; 鼠标悬停时间轴红/绿线 -> 对应行高亮 (store.timelineHoverTp);
//   当前时间生效绿线行实时高亮 (随 currentTime 变化, v245 起播放中走 emitPlaybackFrame 逐帧通道驱动重渲染)
// v71: 滚动条收进窗口内部 (表格区 max-h + overflow), 顶部控制栏固定不滚;
//   切到 timing 页签时自动滚动到当前生效绿线行 (无生效绿线则最近一条 <= currentTime 的点)
export function TimingPanel({ full = false }: { full?: boolean }) {
  useEditor();
  usePlaybackFrame(); // v245: 播放中逐帧更新 (生效绿线行高亮/时间显示), 独立通道不再依赖全量重渲
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  // v157: All/红线/绿线 页签过滤 (仅 full 窗口; 过滤不影响全局索引 i, updateTp/滚动定位不变)
  const [filter, setFilter] = useState<'all' | 'red' | 'green'>('all');

  // v71: 页签切换 => 组件重挂载, 挂载后滚到生效绿线行 (居中)
  useEffect(() => {
    if (!full) return;
    const bm0 = store.beatmap;
    if (!bm0 || !bm0.timingPoints.length) return;
    const raf = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const idx = scrollTargetIndex(bm0.timingPoints, store.currentTime);
      if (idx < 0) return;
      const row = container.querySelector<HTMLElement>(`[data-tp-row="${idx}"]`);
      if (!row) return;
      const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += delta - container.clientHeight / 2 + row.clientHeight / 2;
    });
    return () => cancelAnimationFrame(raf);
  }, [full]);

  const bm = store.beatmap;
  if (!bm) return null;

  const addTimingPoint = (uninherited: boolean) => {
    store.pushUndo();
    const time = Math.round(store.currentTime);
    // v62 (lazer ControlPointList.addNew): 克隆当前生效同类点的全部字段 (含音效集/序号/音量/kiai)
    bm.timingPoints.push(defaultNewPoint(bm.timingPoints, time, uninherited));
    bm.timingPoints.sort((a, b) => a.time - b.time);
    store.emit();
  };

  const updateTp = (i: number, patch: Partial<TimingPoint>) => {
    store.pushUndo();
    Object.assign(bm.timingPoints[i], patch);
    bm.timingPoints.sort((a, b) => a.time - b.time);
    store.emit();
  };

  const removeTp = (i: number) => {
    store.pushUndo();
    bm.timingPoints.splice(i, 1);
    store.emit();
  };

  const updateDiff = (k: 'cs' | 'ar' | 'od' | 'hp', v: number) => {
    store.pushUndo();
    bm.difficulty[k] = v;
    store.emit();
  };

  // 当前时间生效的绿线 (红线后 SV 复位; 随 currentTime 实时变化)
  const activeGreen = activeGreenAt(bm.timingPoints, store.currentTime);

  // v157: 批量编辑栏 — 已选中的绿线 (与上时间轴药丸选区共享 store.selectedGreenLines)
  const selGreens = bm.timingPoints.filter(tp => !tp.uninherited && store.selectedGreenLines.has(tp.time));
  const batchFirst = selGreens[0];
  const batchApply = (patch: Partial<TimingPoint>) => store.updateGreenLinesAt(selGreens.map(g => g.time), patch);

  const inp = 'bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white text-center';
  const th = 'px-2 py-1 text-white/50 text-center whitespace-nowrap font-normal';
  const td = 'px-2 py-1 text-center whitespace-nowrap';

  return (
    <div className={`bg-[#16161d] text-sm text-white/80 ${full
      ? 'w-fit max-w-[96%] mx-auto my-4 border border-white/15 rounded-lg shadow-xl overflow-hidden'
      : 'border-t border-white/10'}`}>
      {!full && <div className="px-3 py-1.5 font-bold text-white/90">{t('timing.panel_title', 'Timing Settings (BPM / SV / Difficulty)')}</div>}
      {/* v71: 顶部控制栏固定在窗口内, 不随表格滚动 */}
      <div className="px-3 pt-2">
        <div className="flex gap-3 py-2 flex-wrap items-center justify-center">
          {(['cs', 'ar', 'od', 'hp'] as const).map(k => (
            <label key={k} className="flex items-center gap-1">
              <span className="uppercase text-white/60">{k}</span>
              <input type="number" step="0.1" min="0" max="10" value={bm.difficulty[k]}
                onChange={e => updateDiff(k, parseFloat(e.target.value) || 0)}
                className={`w-14 ${inp}`} />
            </label>
          ))}
          <button onClick={() => addTimingPoint(true)} className="px-2 py-0.5 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40">{t('timing.add_red', '+ Timing Point (BPM)')}</button>
          <button onClick={() => addTimingPoint(false)} className="px-2 py-0.5 rounded bg-green-500/30 hover:bg-green-500/50 border border-green-400/40">{t('timing.add_green', '+ Inherited Timing Point (SV)')}</button>
        </div>
      </div>
      {/* v157: All/红线/绿线 页签 (仅 full 窗口) */}
      {full && (
        <div data-tp-tabs className="flex justify-center gap-1 px-3 pb-1">
          {([['all', t('timing.tab_all', 'All')], ['red', t('timing.red_line', 'Timing Point')], ['green', t('timing.green_line', 'Inherited Timing Point')]] as const).map(([k, label]) => (
            <button key={k} data-tp-tab={k} onClick={() => setFilter(k)}
              className={`px-3 py-0.5 rounded-t border border-b-0 border-white/15 ${filter === k ? 'bg-white/15 text-white' : 'bg-black/30 text-white/50 hover:text-white/80'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {/* v157: 绿线多选批量编辑栏 (勾选行首 checkbox 后出现; 修改即时应用到所有选中绿线, 一次 undo) */}
      {full && selGreens.length > 0 && batchFirst && (
        <div data-tp-batch className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 border-y border-emerald-400/30 bg-emerald-500/10">
          <span className="text-emerald-300">{t('timing.green_selected', '{n} inherited lines selected', { n: selGreens.length })}</span>
          <label className="flex items-center gap-1">SV
            <input type="number" step="0.05" value={+(-100 / batchFirst.beatLength).toFixed(2)} data-tp-batch-input="sv"
              onChange={e => batchApply({ beatLength: -100 / (parseFloat(e.target.value) || 1) })}
              className={`w-16 ${inp}`} />x
          </label>
          <label className="flex items-center gap-1">{t('timing.sample_set', 'Sample Set')}
            <select value={batchFirst.sampleSet} data-tp-batch-input="sampleSet"
              onChange={e => batchApply({ sampleSet: parseInt(e.target.value) })}
              className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
              <option value={1}>Normal</option><option value={2}>Soft</option><option value={3}>Drum</option>
            </select>
          </label>
          <label className="flex items-center gap-1">{t('timing.sample_index', 'Index')}
            <input type="number" min="0" max="99" value={batchFirst.sampleIndex} data-tp-batch-input="sampleIndex"
              onChange={e => batchApply({ sampleIndex: parseInt(e.target.value) || 0 })}
              className={`w-12 ${inp}`} />
          </label>
          <label className="flex items-center gap-1">{t('timing.volume', 'Volume')}
            <input type="number" min="0" max="100" value={batchFirst.volume} data-tp-batch-input="volume"
              onChange={e => batchApply({ volume: parseInt(e.target.value) || 0 })}
              className={`w-12 ${inp}`} />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={(batchFirst.effects & EFFECT_KIAI) !== 0} data-tp-batch-input="kiai"
              onChange={e => batchApply({ effects: setEffectBit(batchFirst.effects, EFFECT_KIAI, e.target.checked) })} />
            kiai
          </label>
          <button data-tp-batch-delete
            onClick={() => store.deleteGreenLinesAt(selGreens.map(g => g.time))}
            className="px-2 py-0.5 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40">{t('timing.delete_selected', 'Delete Selected')}</button>
        </div>
      )}
      {/* v71: 滚动条在窗口内部 (表格区独立滚动) */}
      <div ref={scrollRef} data-tp-scroll className={`px-3 pb-2 overflow-auto ${full ? 'max-h-[65vh]' : 'max-h-44'}`}>
        <table className="border-collapse mx-auto">
          {/* v72: 表头固定在窗口内不随表格滚动 (sticky + 底色遮挡) */}
          <thead className="sticky top-0 z-10" data-tp-thead>
            <tr className="border-b border-white/10">
              {/* v157: 最左选择列 (绿线可多选, 用于批量编辑/删除) */}
              <th className={`${th} bg-[#16161d]`}></th>
              <th className={`${th} bg-[#16161d]`}>{t('timing.col_type', 'Type')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.time_ms', 'Time (ms)')}</th><th className={`${th} bg-[#16161d]`}>BPM/SV</th><th className={`${th} bg-[#16161d]`}>{t('timing.meter', 'Meter')}</th>
              <th className={`${th} bg-[#16161d]`}>{t('timing.sample_set', 'Sample Set')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.sample_index', 'Index')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.volume', 'Volume')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.effects', 'Effects')}</th><th className={`${th} bg-[#16161d]`}></th>
            </tr>
          </thead>
          <tbody>
            {/* v157: 页签过滤 — i 保持全局索引, updateTp/removeTp/滚动定位不受影响 */}
            {bm.timingPoints.map((tp, i) => ({ tp, i }))
              .filter(({ tp }) => filter === 'all' || (filter === 'red') === tp.uninherited)
              .map(({ tp, i }) => {
              const isHover = tp === store.timelineHoverTp;   // v70-3: 鼠标下时间轴红/绿线对应行
              const isActive = tp === activeGreen;            // v70-4: 当前时间生效绿线 (实时)
              const isSel = !tp.uninherited && store.selectedGreenLines.has(tp.time); // v157
              return (
                <tr key={i} data-tp-row={i}
                  data-hover-tp={isHover || undefined}
                  data-active-green={isActive || undefined}
                  className={`border-t border-white/5 transition-colors hover:bg-white/10${isHover ? ' bg-sky-500/25 hover:bg-sky-500/30' : ''}${isActive ? ' bg-emerald-500/20 hover:bg-emerald-500/25' : ''}${isSel ? ' bg-emerald-500/10' : ''}`}>
                  <td className={td}>
                    {!tp.uninherited && (
                      <input type="checkbox" checked={isSel} data-tp-select="green"
                        onChange={() => store.toggleGreenLineSelected(tp.time)} />
                    )}
                  </td>
                  <td className={td}>{tp.uninherited ? <span className="text-red-400">{t('timing.red_line', 'Timing Point')}</span> : <span className="text-green-400">{t('timing.green_line', 'Inherited Timing Point')}</span>}</td>
                  <td className={td}>
                    <input type="number" value={Math.round(tp.time)} data-tp-input="time"
                      onChange={e => updateTp(i, { time: parseFloat(e.target.value) || 0 })}
                      className={`w-20 ${inp}`} />
                    {/* v70-1: 时分秒格式 */}
                    <span className="ml-1 text-white/40 tabular-nums" data-tp-fmt>{formatMsTime(tp.time)}</span>
                  </td>
                  <td className={td}>
                    {tp.uninherited ? (
                      <input type="number" step="0.01" value={+(60000 / tp.beatLength).toFixed(2)}
                        onChange={e => updateTp(i, { beatLength: 60000 / (parseFloat(e.target.value) || 120) })}
                        className={`w-16 ${inp}`} />
                    ) : (
                      <input type="number" step="0.05" value={+(-100 / tp.beatLength).toFixed(2)}
                        onChange={e => updateTp(i, { beatLength: -100 / (parseFloat(e.target.value) || 1) })}
                        className={`w-16 ${inp}`} />
                    )}
                    <span className="ml-1 text-white/40">{tp.uninherited ? 'BPM' : 'x'}</span>
                  </td>
                  <td className={td}>
                    <input type="number" min="1" max="8" value={tp.meter} onChange={e => updateTp(i, { meter: parseInt(e.target.value) || 4 })}
                      className={`w-10 ${inp}`} />
                  </td>
                  {/* v62: 绿行音效集/自定义序号 (.osu 绿行本就携带, lazer LegacySampleControlPoint) */}
                  <td className={td}>
                    <select value={tp.sampleSet} data-tp-input="sampleSet"
                      onChange={e => updateTp(i, { sampleSet: parseInt(e.target.value) })}
                      className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
                      <option value={1}>Normal</option>
                      <option value={2}>Soft</option>
                      <option value={3}>Drum</option>
                    </select>
                  </td>
                  <td className={td}>
                    <input type="number" min="0" max="99" value={tp.sampleIndex} data-tp-input="sampleIndex"
                      onChange={e => updateTp(i, { sampleIndex: parseInt(e.target.value) || 0 })}
                      className={`w-10 ${inp}`} />
                  </td>
                  <td className={td}>
                    <input type="number" min="0" max="100" value={tp.volume} onChange={e => updateTp(i, { volume: parseInt(e.target.value) || 0 })}
                      className={`w-12 ${inp}`} />
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2">
                      <label className="flex items-center gap-1" title="kiai (effects bit0)">
                        <input type="checkbox" checked={(tp.effects & EFFECT_KIAI) !== 0} data-tp-input="kiai"
                          onChange={e => updateTp(i, { effects: setEffectBit(tp.effects, EFFECT_KIAI, e.target.checked) })} />
                        kiai
                      </label>
                      {tp.uninherited && (
                        <label className="flex items-center gap-1" title={t('timing.omit_barline_title', 'Omit first bar line (effects bit3, lazer OmitFirstBarLine)')}>
                          <input type="checkbox" checked={(tp.effects & EFFECT_OMIT_BARLINE) !== 0} data-tp-input="omitBar"
                            onChange={e => updateTp(i, { effects: setEffectBit(tp.effects, EFFECT_OMIT_BARLINE, e.target.checked) })} />
                          {t('timing.omit_barline', 'Omit Bar Line')}
                        </label>
                      )}
                    </span>
                  </td>
                  <td className={td}>
                    <button onClick={() => removeTp(i)} className="text-red-400 hover:text-red-300 px-1 flex items-center"><X className="w-3.5 h-3.5" /></button>
                    <button onClick={() => store.seek(tp.time)} className="text-sky-400 hover:text-sky-300 px-1">→</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TimingPage() {
  const t = useT();
  return (
    <div className="flex-1 flex min-h-0 bg-[#101016] overflow-auto">
      {/* v70: 原本内容改为居中独立窗口 (原全宽表格每排隔得太远) */}
      <div className="flex-1 min-w-0">
        <TimingPanel full />
      </div>
      <div className="w-72 shrink-0 border-l border-white/10 p-4 text-sm text-white/50 space-y-2"> {/* v321 (F23): xs→sm */}
        <div className="font-bold text-white/70 text-base">{t('timing.help_title', 'Notes')}</div> {/* v321 (F23): sm→base */}
        <div><span className="text-red-400">{t('timing.red_line', 'Timing Point')}</span>: {t('timing.help_red', 'uninherited timing point; defines BPM and meter. BPM = 60000 / beatLength.')}</div>
        <div><span className="text-green-400">{t('timing.green_line', 'Inherited Timing Point')}</span>: {t('timing.help_green', 'inherited timing point; defines the slider velocity multiplier (SV). 1.0x = base speed. Inherited lines also carry sample set (Normal/Soft/Drum) / custom index / volume / kiai (full .osu inherited line fields).')}</div>
        <div>{t('timing.help_clone', 'Adding a timing/inherited point clones all fields of the currently active point of the same kind (lazer ControlPointList.addNew).')}</div>
        <div>{t('timing.help_hover', 'Hovering a timing/inherited point on the timeline above highlights its row; the inherited line active at the current time is highlighted live in green. Switching to this tab auto-scrolls to the active inherited line.')}</div>
        <div>{t('timing.help_filter', 'The All/Timing Point/Inherited tabs filter by type; tick the checkbox at the start of inherited rows to multi-select, then batch-edit SV/sample set/index/volume/kiai or batch-delete (Del key also works).')}</div>
        <div>{t('timing.help_difficulty', 'Difficulty settings CS (circle size) / AR (approach rate) apply to playfield rendering immediately.')}</div>
        <div>{t('timing.help_undo', 'All changes can be undone with {undo} and saved with {save}.', { undo: hotkeyLabel('undo'), save: hotkeyLabel('save') })}</div>
      </div>
    </div>
  );
}

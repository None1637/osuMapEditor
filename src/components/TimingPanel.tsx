import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react'; // v181: ✕ → lucide
import { store, useEditor, usePlaybackFrame } from '@/osu/store';
import type { TimingPoint } from '@/osu/parser';
import { defaultNewPoint, setEffectBit, EFFECT_KIAI, EFFECT_OMIT_BARLINE, formatMsTime, activeGreenAt, scrollTargetIndex, sampleSetCode, fmtTpPrec } from '@/osu/timingEdit';
import { hotkeyLabel } from '@/osu/hotkeys'; // v321 (F21): 快捷键提示随改键同步
import { useT } from '@/i18n';

/** v372: 高精度数值输入 (BPM/SV) — 聚焦期间保留用户原文 ( controlled 值重算会吞掉输入中的 "." ),
 *  失焦后回到规范显示 (最多 13 位有效小数, stable 同精度); 输入过程中每次合法值即时提交 */
function PreciseInput({ value, onCommit, className, dataAttr, dataValue }: { value: number; onCommit: (v: number) => void; className: string; dataAttr?: string; dataValue?: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <input type="number" step="any" className={className}
      {...(dataAttr ? { [dataAttr]: dataValue ?? true } : {})}
      value={raw ?? fmtTpPrec(value)}
      onFocus={() => setRaw(fmtTpPrec(value))}
      onChange={e => {
        setRaw(e.target.value);
        const v = parseFloat(e.target.value);
        if (isFinite(v)) onCommit(v);
      }}
      onBlur={() => setRaw(null)} />
  );
}

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

  // v359: 滚动定位复用 (挂载自动滚到生效绿线 / 加新线后滚到新行 — soulten: 加新線不在畫面中要自己滾下去)
  const scrollRowToCenter = (idx: number) => {
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const row = container.querySelector<HTMLElement>(`[data-tp-row="${idx}"]`);
      if (!row) return;
      const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += delta - container.clientHeight / 2 + row.clientHeight / 2;
    });
  };

  // v71: 页签切换 => 组件重挂载, 挂载后滚到生效绿线行 (居中)
  useEffect(() => {
    if (!full) return;
    const bm0 = store.beatmap;
    if (!bm0 || !bm0.timingPoints.length) return;
    const idx = scrollTargetIndex(bm0.timingPoints, store.currentTime);
    if (idx >= 0) scrollRowToCenter(idx);
  }, [full]);

  const bm = store.beatmap;
  if (!bm) return null;

  const addTimingPoint = (uninherited: boolean) => {
    store.pushUndo();
    const time = Math.round(store.currentTime);
    // v62 (lazer ControlPointList.addNew): 克隆当前生效同类点的全部字段 (含音效集/序号/音量/kiai)
    const np = defaultNewPoint(bm.timingPoints, time, uninherited);
    bm.timingPoints.push(np);
    bm.timingPoints.sort((a, b) => a.time - b.time);
    // v359: 新线可能被页签过滤隐藏 — 切到能显示它的页签, 并滚动定位到当前新行
    if (full && filter !== 'all' && (filter === 'red') !== uninherited) setFilter(uninherited ? 'red' : 'green');
    store.emit();
    if (full) scrollRowToCenter(bm.timingPoints.indexOf(np));
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
  // v372: 已选中的红线 (行点击多选; 批量编辑/删除, 与绿线栏并列)
  const selReds = bm.timingPoints.filter(tp => tp.uninherited && store.selectedGreenLines.has(tp.time));
  const batchRedFirst = selReds[0];
  const batchRedApply = (patch: Partial<TimingPoint>) => store.updateTimingPointsAt(selReds.map(g => g.time), patch);
  // v372: 当前页签可见行 time 序 (Shift 范围选择的区间基准)
  const visibleTimes = bm.timingPoints.filter(tp => filter === 'all' || (filter === 'red') === tp.uninherited).map(tp => tp.time);

  const inp = 'bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white text-center';
  const th = 'px-2 py-1 text-white/50 text-center whitespace-nowrap font-normal';
  const td = 'px-2 py-1 text-center whitespace-nowrap';

  return (
    <div className={`bg-[#16161d] text-sm text-white/80 ${full
      ? 'w-fit max-w-[96%] mx-auto my-2 border border-white/15 rounded-lg shadow-xl overflow-hidden flex-1 min-h-0 flex flex-col' // v359: 垂直满版 (撑满页签高度, 表格区内滚)
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
            <PreciseInput value={-100 / batchFirst.beatLength} dataAttr="data-tp-batch-input" dataValue="sv"
              onCommit={v => batchApply({ beatLength: -100 / (v || 1) })}
              className={`w-24 ${inp}`} />x
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
              className={`w-12 ${inp}`} />{/* v372 */}%
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
      {/* v372: 红线多选批量编辑栏 (行点击 Ctrl/Shift 多选; 批量音效集/序号/音量/kiai/删除) */}
      {full && selReds.length > 0 && batchRedFirst && (
        <div data-tp-batch-red className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 border-y border-red-400/30 bg-red-500/10">
          <span className="text-red-300">{t('timing.red_selected', '{n} timing points selected', { n: selReds.length })}</span>
          <label className="flex items-center gap-1">{t('timing.sample_set', 'Sample Set')}
            <select value={batchRedFirst.sampleSet} data-tp-batch-red-input="sampleSet"
              onChange={e => batchRedApply({ sampleSet: parseInt(e.target.value) })}
              className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
              <option value={1}>Normal</option><option value={2}>Soft</option><option value={3}>Drum</option>
            </select>
          </label>
          <label className="flex items-center gap-1">{t('timing.sample_index', 'Index')}
            <input type="number" min="0" max="99" value={batchRedFirst.sampleIndex} data-tp-batch-red-input="sampleIndex"
              onChange={e => batchRedApply({ sampleIndex: parseInt(e.target.value) || 0 })}
              className={`w-12 ${inp}`} />
          </label>
          <label className="flex items-center gap-1">{t('timing.volume', 'Volume')}
            <input type="number" min="0" max="100" value={batchRedFirst.volume} data-tp-batch-red-input="volume"
              onChange={e => batchRedApply({ volume: parseInt(e.target.value) || 0 })}
              className={`w-12 ${inp}`} />%
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={(batchRedFirst.effects & EFFECT_KIAI) !== 0} data-tp-batch-red-input="kiai"
              onChange={e => batchRedApply({ effects: setEffectBit(batchRedFirst.effects, EFFECT_KIAI, e.target.checked) })} />
            kiai
          </label>
          <button data-tp-batch-red-delete
            onClick={() => store.deleteTimingPointsAt(selReds.map(g => g.time))}
            className="px-2 py-0.5 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40">{t('timing.delete_selected', 'Delete Selected')}</button>
        </div>
      )}
      {/* v71: 滚动条在窗口内部 (表格区独立滚动); v359: full 模式 flex-1 撑满垂直空间 */}
      <div ref={scrollRef} data-tp-scroll className={`px-3 pb-2 overflow-auto ${full ? 'flex-1 min-h-0' : 'max-h-44'}`}>
        <table className="border-collapse mx-auto">
          {/* v72: 表头固定在窗口内不随表格滚动 (sticky + 底色遮挡) */}
          <thead className="sticky top-0 z-10" data-tp-thead>
            <tr className="border-b border-white/10">
              {/* v157: 最左选择列 (绿线可多选, 用于批量编辑/删除) */}
              <th className={`${th} bg-[#16161d]`}></th>
              <th className={`${th} bg-[#16161d]`}>{t('timing.col_type', 'Type')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.time_ms', 'Time (ms)')}</th><th className={`${th} bg-[#16161d]`}>BPM/SV</th><th className={`${th} bg-[#16161d]`}>{t('timing.meter', 'Meter')}</th>
              <th className={`${th} bg-[#16161d]`}>{t('timing.sample', 'Sample')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.volume', 'Volume')}</th><th className={`${th} bg-[#16161d]`}>{t('timing.effects', 'Effects')}</th><th className={`${th} bg-[#16161d]`}></th>
            </tr>
          </thead>
          <tbody>
            {/* v157: 页签过滤 — i 保持全局索引, updateTp/removeTp/滚动定位不受影响 */}
            {bm.timingPoints.map((tp, i) => ({ tp, i }))
              .filter(({ tp }) => filter === 'all' || (filter === 'red') === tp.uninherited)
              .map(({ tp, i }) => {
              const isHover = tp === store.timelineHoverTp;   // v70-3: 鼠标下时间轴红/绿线对应行
              const isActive = tp === activeGreen;            // v70-4: 当前时间生效绿线 (实时)
              const isSel = store.selectedGreenLines.has(tp.time); // v157; v372: 红绿线均可选中
              return (
                <tr key={i} data-tp-row={i}
                  data-hover-tp={isHover || undefined}
                  data-active-green={isActive || undefined}
                  onClick={(e) => { // v372: 文件管理器式多选 (点在输入控件上不触发)
                    if ((e.target as HTMLElement).closest('input,select,button,label')) return;
                    store.clickTimingLine(tp.time, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, visibleTimes);
                  }}
                  className={`border-t border-white/5 transition-colors hover:bg-white/10 cursor-pointer${isHover ? ' bg-sky-500/25 hover:bg-sky-500/30' : ''}${isActive ? ' bg-emerald-500/20 hover:bg-emerald-500/25' : ''}${isSel ? ' bg-emerald-500/10' : ''}`}>
                  <td className={td}>
                    {!tp.uninherited && (
                      <input type="checkbox" checked={isSel} data-tp-select="green"
                        onChange={() => store.toggleGreenLineSelected(tp.time)} />
                    )}
                  </td>
                  {/* v372: 红/绿小点区分线型 (stable F6 样式), 不再用文字 */}
                  <td className={td}>
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${tp.uninherited ? 'bg-[#eb4747]' : 'bg-[#b2ff66]'}`}
                      data-tp-dot={tp.uninherited ? 'red' : 'green'}
                      title={tp.uninherited ? t('timing.red_line', 'Timing Point') : t('timing.green_line', 'Inherited Timing Point')} />
                  </td>
                  <td className={td}>
                    <input type="number" value={Math.round(tp.time)} data-tp-input="time"
                      onChange={e => updateTp(i, { time: parseFloat(e.target.value) || 0 })}
                      className={`w-20 ${inp}`} />
                    {/* v70-1: 时分秒格式 */}
                    <span className="ml-1 text-white/40 tabular-nums" data-tp-fmt>{formatMsTime(tp.time)}</span>
                  </td>
                  <td className={td}>
                    {/* v372: 高精度输入 (最多 13 位有效小数, stable 同精度; 聚焦保留原文) */}
                    {tp.uninherited ? (
                      <PreciseInput value={60000 / tp.beatLength} dataAttr="data-tp-input" dataValue="bpm"
                        onCommit={v => updateTp(i, { beatLength: 60000 / (v || 120) })}
                        className={`w-24 ${inp}`} />
                    ) : (
                      <PreciseInput value={-100 / tp.beatLength} dataAttr="data-tp-input" dataValue="sv"
                        onCommit={v => updateTp(i, { beatLength: -100 / (v || 1) })}
                        className={`w-24 ${inp}`} />
                    )}
                    <span className="ml-1 text-white/40">{tp.uninherited ? 'BPM' : 'x'}</span>
                  </td>
                  {/* v372: 拍号显示为 n/4; 绿线不显示拍号 */}
                  <td className={td}>
                    {tp.uninherited ? (
                      <span className="inline-flex items-center gap-0.5">
                        <input type="number" min="1" max="8" value={tp.meter} onChange={e => updateTp(i, { meter: parseInt(e.target.value) || 4 })}
                          className={`w-10 ${inp}`} data-tp-input="meter" />
                        <span className="text-white/40">/4</span>
                      </span>
                    ) : null}
                  </td>
                  {/* v372: 音效集+序号合并显示 (S / S:C1 / S:C2), 编辑控件同列保留 */}
                  <td className={td}>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-white/70 tabular-nums min-w-8" data-tp-sample-code>{sampleSetCode(tp.sampleSet, tp.sampleIndex)}</span>
                      <select value={tp.sampleSet} data-tp-input="sampleSet"
                        onChange={e => updateTp(i, { sampleSet: parseInt(e.target.value) })}
                        className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
                        <option value={1}>Normal</option>
                        <option value={2}>Soft</option>
                        <option value={3}>Drum</option>
                      </select>
                      <input type="number" min="0" max="99" value={tp.sampleIndex} data-tp-input="sampleIndex"
                        onChange={e => updateTp(i, { sampleIndex: parseInt(e.target.value) || 0 })}
                        className={`w-10 ${inp}`} />
                    </span>
                  </td>
                  <td className={td}>
                    {/* v372: 音量显示为 n% */}
                    <input type="number" min="0" max="100" value={tp.volume} onChange={e => updateTp(i, { volume: parseInt(e.target.value) || 0 })}
                      className={`w-12 ${inp}`} />
                    <span className="ml-0.5 text-white/40">%</span>
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
                    {/* v359: 按钮放大并排 (soulten/None1637: 这两个按钮太小了; 转到时间轴与删除横向分开) */}
                    <span className="inline-flex items-center gap-1.5">
                      <button onClick={() => store.seek(tp.time)} title={t('timing.seek_title', 'Jump to this point on the timeline')}
                        className="px-2 py-1 rounded text-base leading-none text-sky-400 hover:text-sky-300 hover:bg-white/10">→</button>
                      <button onClick={() => removeTp(i)} title={t('timing.delete_title', 'Delete this point')}
                        className="px-2 py-1 rounded text-red-400 hover:text-red-300 hover:bg-white/10 flex items-center"><X className="w-4 h-4" /></button>
                    </span>
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
      {/* v70: 原本内容改为居中独立窗口 (原全宽表格每排隔得太远); v359: flex-col 让窗口垂直满版 */}
      <div className="flex-1 min-w-0 flex flex-col">
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

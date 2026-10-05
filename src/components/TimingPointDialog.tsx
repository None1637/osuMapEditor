// v63: 红线/绿线编辑弹窗 — 上时间轴 +红/+绿 插入 与 双击 BPM/SV 胶囊编辑共用, 显示 .osu 行全部参数
// (时间/BPM或SV/拍号/音效集/自定义序号/音量/kiai/省略小节线)
import { useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum } from './DraggableDialog';
import { setEffectBit, EFFECT_KIAI, EFFECT_OMIT_BARLINE } from '@/osu/timingEdit';
import { useT } from '@/i18n';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 text-white/50">{label}</span>
    {children}
  </div>
);

export function TimingPointDialog() {
  useEditor();
  const t = useT();
  const dlg = store.timingPointDialog!;
  const [draft, setDraft] = useState(() => ({ ...dlg.draft }));
  const patch = (p: Partial<typeof draft>) => setDraft(d => ({ ...d, ...p }));
  const red = draft.uninherited;

  return (
    <DraggableDialog title={t('timing.dlg_title', '{action} {type}', {
        action: dlg.mode === 'add' ? t('timing.insert', 'Insert') : t('timing.edit', 'Edit'),
        type: red ? t('timing.red_line_bpm', 'Timing Point (BPM)') : t('timing.green_line_sv', 'Inherited Timing Point (SV)'),
      })}
      onClose={() => store.closeTimingPointDialog()} width={300} testid="tpdlg">
      <div className="flex flex-col gap-2 text-xs text-white/80">
        <Row label={t('timing.time_ms', 'Time (ms)')}>
          <DraftNum value={Math.round(draft.time)} set={v => patch({ time: Math.round(v) })} min={0} testid="time" />
        </Row>
        {red ? (
          <Row label="BPM">
            <DraftNum value={+(60000 / draft.beatLength).toFixed(2)} set={v => patch({ beatLength: 60000 / (v || 120) })} min={1} step={0.01} testid="bpmOrSv" />
          </Row>
        ) : (
          <Row label={t('timing.sv_multiplier', 'SV Multiplier')}>
            <DraftNum value={+(-100 / draft.beatLength).toFixed(2)} set={v => patch({ beatLength: -100 / (v || 1) })} min={0.01} step={0.01} testid="bpmOrSv" />
          </Row>
        )}
        <Row label={t('timing.meter', 'Meter')}>
          <DraftNum value={draft.meter} set={v => patch({ meter: Math.round(v) })} min={1} max={8} testid="meter" />
        </Row>
        <Row label={t('timing.sample_set', 'Sample Set')}>
          <select value={draft.sampleSet} data-tpdlg="sampleSet"
            onChange={e => patch({ sampleSet: parseInt(e.target.value) })}
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            <option value={1}>Normal</option>
            <option value={2}>Soft</option>
            <option value={3}>Drum</option>
          </select>
        </Row>
        <Row label={t('timing.custom_index', 'Custom Index')}>
          <DraftNum value={draft.sampleIndex} set={v => patch({ sampleIndex: Math.round(v) })} min={0} max={99} testid="sampleIndex" />
        </Row>
        <Row label={t('timing.volume', 'Volume')}>
          <DraftNum value={draft.volume} set={v => patch({ volume: Math.round(v) })} min={0} max={100} testid="volume" />
        </Row>
        <Row label={t('timing.effects', 'Effects')}>
          <label className="flex items-center gap-1" title="kiai (effects bit0)">
            <input type="checkbox" checked={(draft.effects & EFFECT_KIAI) !== 0} data-tpdlg="kiai"
              onChange={e => patch({ effects: setEffectBit(draft.effects, EFFECT_KIAI, e.target.checked) })} />
            kiai
          </label>
          {red && (
            <label className="flex items-center gap-1" title={t('timing.omit_barline_title', 'Omit first bar line (effects bit3, lazer OmitFirstBarLine)')}>
              <input type="checkbox" checked={(draft.effects & EFFECT_OMIT_BARLINE) !== 0} data-tpdlg="omitBar"
                onChange={e => patch({ effects: setEffectBit(draft.effects, EFFECT_OMIT_BARLINE, e.target.checked) })} />
              {t('timing.omit_barline', 'Omit Bar Line')}
            </label>
          )}
        </Row>
        <div className="flex gap-2 pt-1">
          <button onClick={() => store.applyTimingPointDialog(draft)} data-tpdlg="ok"
            className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 text-white font-bold">
            {dlg.mode === 'add' ? t('timing.insert', 'Insert') : t('timing.apply', 'Apply')}
          </button>
          <button onClick={() => store.closeTimingPointDialog()} data-tpdlg="cancel"
            className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">{t('timing.cancel', 'Cancel')}</button>
          {dlg.mode === 'edit' && (
            <button onClick={() => store.removeTimingPointAt(dlg.index)} data-tpdlg="delete"
              className="px-3 py-1 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40 ml-auto">{t('timing.delete', 'Delete')}</button>
          )}
        </div>
      </div>
    </DraggableDialog>
  );
}

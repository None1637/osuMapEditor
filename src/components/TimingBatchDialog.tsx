// v522: Timing 多选批量编辑弹窗 — 开窗冻结选区, 应用时一次 undo 写入全部选中红/绿线
import { useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DialogButton, DraggableDialog, DraftNum } from './DraggableDialog';
import { UiAutoControl, UiAutoText } from './uiLayout/UiControl'; // v535
import { setEffectBit, EFFECT_KIAI, EFFECT_OMIT_BARLINE } from '@/osu/timingEdit';
import type { TimingPoint } from '@/osu/parser';
import { useT } from '@/i18n';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 text-white/50">{label}</span>
    {children}
  </div>
);

export function TimingBatchDialog({ kind, times, onClose }: {
  kind: 'red' | 'green';
  times: number[];
  onClose: () => void;
}) {
  useEditor();
  const t = useT();
  const red = kind === 'red';
  const [selectedTimes] = useState(() => [...times]);
  const [draft, setDraft] = useState<TimingPoint | null>(() => {
    const bm = store.beatmap;
    const first = bm?.timingPoints.find(tp => tp.time === selectedTimes[0] && tp.uninherited === red);
    return first ? { ...first } : null;
  });
  if (!draft) return null;
  const patch = (p: Partial<TimingPoint>) => setDraft(d => d ? { ...d, ...p } : d);
  const input = (name: string) => red ? { 'data-tp-batch-red-input': name } : { 'data-tp-batch-input': name };

  return (
    <DraggableDialog title={t('timing.batch_title', 'Batch Edit {type} ({n})', {
      type: red ? t('timing.red_line_bpm', 'Timing Point (BPM)') : t('timing.green_line_sv', 'Inherited Timing Point (SV)'),
      n: selectedTimes.length,
    })} onClose={onClose} width={360} testid={`batch-${kind}`}>
      <div className="flex flex-col gap-2 text-xs text-white/80">
        {red ? (
          <Row label="BPM">
            <DraftNum value={+(60000 / draft.beatLength).toFixed(2)} set={v => patch({ beatLength: Number.isNaN(v) ? NaN : 60000 / (v || 120) })}
              min={1} step={0.01} testid="batch-bpm" allowNaN />
          </Row>
        ) : (
          <Row label={t('timing.sv_multiplier', 'SV Multiplier')}>
            <DraftNum value={+(-100 / draft.beatLength).toFixed(2)} set={v => patch({ beatLength: Number.isNaN(v) ? NaN : -100 / (v || 1) })}
              min={0.01} step={0.01} testid="batch-sv" allowNaN />
          </Row>
        )}
        {red && (
          <Row label={t('timing.meter', 'Meter')}>
            <DraftNum value={draft.meter} set={v => patch({ meter: Math.round(v) })} min={1} max={99} testid="batch-meter" />
          </Row>
        )}
        <Row label={t('timing.sample_set', 'Sample Set')}>
          <UiAutoControl localId="sample-set"><select value={draft.sampleSet} {...input('sampleSet')} onChange={e => patch({ sampleSet: parseInt(e.target.value) })}
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            <option value={1}>Normal</option><option value={2}>Soft</option><option value={3}>Drum</option>
          </select></UiAutoControl>
        </Row>
        <Row label={t('timing.custom_index', 'Custom Index')}>
          <DraftNum value={draft.sampleIndex} set={v => patch({ sampleIndex: Math.round(v) })} min={0} max={99} testid="batch-index" />
        </Row>
        <Row label={t('timing.volume', 'Volume')}>
          <DraftNum value={draft.volume} set={v => patch({ volume: Math.round(v) })} min={0} max={100} testid="batch-volume" />
        </Row>
        <Row label={t('timing.effects', 'Effects')}>
          <label className="flex items-center gap-1">
            <UiAutoControl localId="kiai"><input type="checkbox" checked={(draft.effects & EFFECT_KIAI) !== 0} {...input('kiai')}
              onChange={e => patch({ effects: setEffectBit(draft.effects, EFFECT_KIAI, e.target.checked) })} /></UiAutoControl>
            <UiAutoText localId="kiai">kiai</UiAutoText>
          </label>
          {red && (
            <label className="flex items-center gap-1">
              <UiAutoControl localId="omit-bar"><input type="checkbox" checked={(draft.effects & EFFECT_OMIT_BARLINE) !== 0} {...input('omitBar')}
                onChange={e => patch({ effects: setEffectBit(draft.effects, EFFECT_OMIT_BARLINE, e.target.checked) })} /></UiAutoControl>
              <UiAutoText localId="omit-bar" textKey="timing.omit_barline">Omit Bar Line</UiAutoText>
            </label>
          )}
        </Row>
        <div className="flex gap-2 pt-1">
          <DialogButton uiId="apply" textKey="timing.apply" data-tp-batch-dlg="ok" onClick={() => {
            const p = { ...draft };
            delete (p as Partial<TimingPoint>).time;
            delete (p as Partial<TimingPoint>).uninherited;
            if (red) store.updateTimingPointsAt(selectedTimes, p);
            else store.updateGreenLinesAt(selectedTimes, p);
            onClose();
          }} className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 text-white font-bold">Apply</DialogButton>
          <DialogButton uiId="cancel" textKey="timing.cancel" data-tp-batch-dlg="cancel" onClick={onClose} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Cancel</DialogButton>
        </div>
      </div>
    </DraggableDialog>
  );
}

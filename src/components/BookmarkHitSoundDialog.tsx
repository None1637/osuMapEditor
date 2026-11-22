// v585: 当前 bookmark 区间物件的整体 hitsound 编辑
import { useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { parseHitSample } from '@/osu/clock/hitSounds';
import { DialogButton, DraggableDialog, DraftNum } from './DraggableDialog';
import { UiAutoControl, UiAutoText } from './uiLayout/UiControl';
import { useT } from '@/i18n';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 text-white/50">{label}</span>
    {children}
  </div>
);

export function BookmarkHitSoundDialog() {
  useEditor();
  const t = useT();
  const [objects] = useState(() => store.bookmarkHitSoundObjects());
  const [enabled, setEnabled] = useState<number[]>(() => [2, 4, 8].filter(bit => objects.every(o => ((o.hitSound ?? 0) & bit) !== 0)));
  const first = parseHitSample(objects[0]?.hitSampleRaw);
  const [normalSet, setNormalSet] = useState(first.normalSet);
  const [additionSet, setAdditionSet] = useState(first.additionSet);
  const [customIndex, setCustomIndex] = useState(first.customIndex);
  const [volume, setVolume] = useState(first.volume);
  const toggle = (bit: number, on: boolean) => setEnabled(prev => on ? [...new Set([...prev, bit])] : prev.filter(x => x !== bit));

  return (
    <DraggableDialog title={t('bookmark_hs.title', 'Bookmark Section Hitsound ({n} objects)', { n: objects.length })} testid="bookmark-hitsound" width={360} onClose={() => store.closeBookmarkHitSound()}>
      <div className="flex flex-col gap-2 text-xs text-white/80">
        <Row label="Hitsound">
          {[2, 4, 8].map(bit => (
            <label key={bit} className="flex items-center gap-1">
              <UiAutoControl localId={`bit-${bit}`}><input type="checkbox" checked={enabled.includes(bit)} data-bookmark-hs-bit={bit}
                onChange={e => toggle(bit, e.target.checked)} /></UiAutoControl>
              <UiAutoText localId={`bit-${bit}`} textKey={bit === 2 ? 'app.hs_whistle' : bit === 4 ? 'app.hs_finish' : 'app.hs_clap'}>{bit === 2 ? 'Whistle' : bit === 4 ? 'Finish' : 'Clap'}</UiAutoText>
            </label>
          ))}
        </Row>
        {([['NormalSet', normalSet, setNormalSet, 'normal-set'], ['AddSet', additionSet, setAdditionSet, 'addition-set']] as const).map(([label, value, setValue, id]) => (
          <Row key={label} label={label}>
            <UiAutoControl localId={id}><select value={value} data-bookmark-hs={id} onChange={e => setValue(parseInt(e.target.value))}
              className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
              <option value={0}>{t('inspector.auto_inherit', 'Auto / Inherit')}</option>
              <option value={1}>Normal</option><option value={2}>Soft</option><option value={3}>Drum</option>
            </select></UiAutoControl>
          </Row>
        ))}
        <Row label={t('inspector.sample_index', 'Sample Index')}>
          <DraftNum value={customIndex} testid="custom-index" min={0} set={v => setCustomIndex(Math.max(0, Math.round(v)))} />
        </Row>
        <Row label={t('inspector.volume', 'Volume')}>
          <DraftNum value={volume} testid="volume" min={0} max={100} set={v => setVolume(v <= 0 ? 0 : Math.min(100, Math.max(5, Math.round(v))))} />
        </Row>
        {!objects.length && <div className="text-red-300">{t('bookmark_hs.empty', 'No bookmark section or no objects in this section')}</div>}
        <div className="flex gap-2 pt-1">
          <DialogButton uiId="apply" textKey="convert.apply" data-bookmark-hs-apply disabled={!objects.length}
            onClick={() => { store.applyBookmarkHitSound(enabled, { normalSet, additionSet, customIndex, volume }); store.closeBookmarkHitSound(); }}
            className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">Apply</DialogButton>
          <DialogButton uiId="cancel" textKey="convert.cancel" onClick={() => store.closeBookmarkHitSound()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Cancel</DialogButton>
        </div>
      </div>
    </DraggableDialog>
  );
}

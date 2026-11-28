// v612: 文件菜单「另存为新难度...」— 独立 Song Setup 草稿, 确认后写入新文件并询问是否清空物件
import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { store, useEditor } from '@/osu/store';
import { mapFileName } from '@/osu/saveMap';
import type { Beatmap } from '@/osu/parser';
import { useCounterZoom } from '@/osu/uiZoom';
import { useT } from '@/i18n';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="bg-black/20 rounded border border-white/10 p-3 space-y-2">
    <div className="font-bold text-pink-300 text-sm mb-1">{title}</div>
    {children}
  </section>;
}

function TextField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return <label className="flex items-center gap-2 text-sm text-white/70">
    <span className="w-40 shrink-0">{label}</span>
    <input type="text" value={value} data-save-as={id} onChange={e => onChange(e.target.value)}
      className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
  </label>;
}

function NumField({ id, label, value, onChange, step = 1 }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <label className="flex items-center gap-2 text-sm text-white/70">
    <span className="w-40 shrink-0">{label}</span>
    <input type="number" value={value} step={step} data-save-as={id} onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-28 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
  </label>;
}

function CheckField({ id, label, value, onChange }: { id: string; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-white/70">
    <span className="w-40 shrink-0">{label}</span>
    <input type="checkbox" checked={value} data-save-as={id} onChange={e => onChange(e.target.checked)} />
  </label>;
}

export function SaveAsDifficultyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useEditor();
  const t = useT();
  const cz = useCounterZoom();
  const originalVersion = useRef(store.beatmap?.metadata.version ?? '');
  const [draft] = useState<Beatmap>(() => structuredClone(store.beatmap!));
  const [, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upd = (fn: () => void) => { fn(); setRevision(v => v + 1); };

  const submit = async () => {
    const version = draft.metadata.version.trim();
    if (!version) { setError(t('setup.save_as_version_required', 'Please enter a difficulty name.')); return; }
    if (version === originalVersion.current.trim()) { setError(t('setup.save_as_version_same', 'The new difficulty name must be different from the current one.')); return; }
    draft.metadata.version = version;
    if (mapFileName(draft) === store.mapSource?.fileName) { setError(t('setup.save_as_file_same', 'The new file name would overwrite the current difficulty; please use another difficulty name.')); return; }
    setError(null);
    // v612: stable 风格确认 — 「否」保留物件; 两种选择都另存并跳到 0:00:000
    const clearObjects = window.confirm(t('setup.save_as_clear_confirm', 'Clear all objects and start over?'));
    setBusy(true);
    const ok = await store.saveAsDifficulty(draft, clearObjects);
    setBusy(false);
    if (ok) onSaved();
    else setError(store.saveMessage ?? t('setup.save_as_failed', 'Failed to save the new difficulty.'));
  };

  return <div className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center" data-dialog="save-as-difficulty">
    <div ref={cz.ref} style={cz.style} className="w-[920px] max-w-[94vw] max-h-[90vh] bg-[#16161d] border border-white/15 rounded-lg shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="font-semibold">{t('setup.save_as_title', 'Song Setup - Save as New Difficulty')}</div>
        <button onClick={onClose} disabled={busy} aria-label={t('app.cancel', 'Cancel')} className="p-1 rounded hover:bg-white/10 disabled:opacity-40"><X className="w-4 h-4" /></button>
      </div>
      <div className="overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-3 text-white/85">
        <Section title={t('setup.section_general', '[General] General')}>
          <TextField id="audio-filename" label={t('setup.audio_filename', 'AudioFilename Audio File')} value={draft.general.audioFilename} onChange={v => upd(() => draft.general.audioFilename = v)} />
          <NumField id="audio-lead-in" label={t('setup.audio_lead_in', 'AudioLeadIn Audio Lead-In')} value={draft.general.audioLeadIn} onChange={v => upd(() => draft.general.audioLeadIn = v)} />
          <NumField id="preview-time" label={t('setup.preview_time', 'PreviewTime Preview Time')} value={draft.general.previewTime} onChange={v => upd(() => draft.general.previewTime = v)} />
          <NumField id="countdown" label={t('setup.countdown', 'Countdown')} value={draft.general.countdown} onChange={v => upd(() => draft.general.countdown = Math.round(v))} />
          <TextField id="sample-set" label={t('setup.sample_set', 'SampleSet Sample Set')} value={draft.general.sampleSet} onChange={v => upd(() => draft.general.sampleSet = v)} />
          <NumField id="stack-leniency" label={t('setup.stack_leniency', 'StackLeniency Stack Leniency')} value={draft.general.stackLeniency} step={0.1} onChange={v => upd(() => draft.general.stackLeniency = v)} />
          <NumField id="mode" label={t('setup.mode', 'Mode')} value={draft.general.mode} onChange={v => upd(() => draft.general.mode = Math.round(v))} />
          <CheckField id="letterbox-breaks" label="LetterboxInBreaks" value={!!draft.general.letterboxInBreaks} onChange={v => upd(() => draft.general.letterboxInBreaks = v ? 1 : 0)} />
          <CheckField id="widescreen-storyboard" label="WidescreenStoryboard" value={!!draft.general.widescreenStoryboard} onChange={v => upd(() => draft.general.widescreenStoryboard = v ? 1 : 0)} />
        </Section>
        <Section title={t('setup.section_editor', '[Editor] Editor Behavior')}>
          <NumField id="distance-spacing" label={t('setup.distance_spacing', 'DistanceSpacing Distance Snap')} value={draft.editor.distanceSpacing} step={0.1} onChange={v => upd(() => draft.editor.distanceSpacing = v)} />
          <NumField id="beat-divisor" label={t('setup.beat_divisor', 'BeatDivisor Beat Snap Divisor')} value={draft.editor.beatDivisor} onChange={v => upd(() => draft.editor.beatDivisor = Math.max(1, Math.round(v)))} />
          <NumField id="grid-size" label={t('setup.grid_size', 'GridSize Grid Size')} value={draft.editor.gridSize} onChange={v => upd(() => draft.editor.gridSize = Math.max(0, Math.round(v)))} />
          <NumField id="timeline-zoom" label={t('setup.timeline_zoom', 'TimelineZoom Timeline Zoom')} value={draft.editor.timelineZoom} step={0.25} onChange={v => upd(() => draft.editor.timelineZoom = Math.max(0.25, v))} />
        </Section>
        <Section title={t('setup.section_metadata', '[Metadata] Metadata')}>
          <TextField id="artist" label={t('setup.artist', 'Artist')} value={draft.metadata.artist} onChange={v => upd(() => draft.metadata.artist = v)} />
          <TextField id="artist-unicode" label="ArtistUnicode" value={draft.metadata.artistUnicode} onChange={v => upd(() => draft.metadata.artistUnicode = v)} />
          <TextField id="title" label={t('setup.title', 'Title')} value={draft.metadata.title} onChange={v => upd(() => draft.metadata.title = v)} />
          <TextField id="title-unicode" label="TitleUnicode" value={draft.metadata.titleUnicode} onChange={v => upd(() => draft.metadata.titleUnicode = v)} />
          <TextField id="creator" label={t('setup.creator', 'Creator')} value={draft.metadata.creator} onChange={v => upd(() => draft.metadata.creator = v)} />
          <TextField id="version" label={t('setup.version', 'Version')} value={draft.metadata.version} onChange={v => upd(() => draft.metadata.version = v)} />
          <TextField id="source" label={t('setup.source', 'Source')} value={draft.metadata.source} onChange={v => upd(() => draft.metadata.source = v)} />
          <TextField id="tags" label={t('setup.tags', 'Tags')} value={draft.metadata.tags} onChange={v => upd(() => draft.metadata.tags = v)} />
          <TextField id="beatmap-id" label="BeatmapID" value={draft.metadata.beatmapID} onChange={v => upd(() => draft.metadata.beatmapID = v)} />
          <TextField id="beatmap-set-id" label="BeatmapSetID" value={draft.metadata.beatmapSetID} onChange={v => upd(() => draft.metadata.beatmapSetID = v)} />
        </Section>
        <Section title={t('setup.section_difficulty', '[Difficulty] Difficulty')}>
          <NumField id="hp" label="HPDrainRate HP" value={draft.difficulty.hp} step={0.1} onChange={v => upd(() => draft.difficulty.hp = v)} />
          <NumField id="cs" label="CircleSize CS" value={draft.difficulty.cs} step={0.1} onChange={v => upd(() => draft.difficulty.cs = v)} />
          <NumField id="od" label="OverallDifficulty OD" value={draft.difficulty.od} step={0.1} onChange={v => upd(() => draft.difficulty.od = v)} />
          <NumField id="ar" label="ApproachRate AR" value={draft.difficulty.ar} step={0.1} onChange={v => upd(() => draft.difficulty.ar = v)} />
          <NumField id="slider-multiplier" label={t('setup.slider_multiplier', 'SliderMultiplier Slider Velocity')} value={draft.difficulty.sliderMultiplier} step={0.1} onChange={v => upd(() => draft.difficulty.sliderMultiplier = v)} />
          <NumField id="slider-tick-rate" label={t('setup.slider_tick_rate', 'SliderTickRate Slider Tick Rate')} value={draft.difficulty.sliderTickRate} step={0.5} onChange={v => upd(() => draft.difficulty.sliderTickRate = v)} />
        </Section>
      </div>
      <div className="px-4 pb-4">
        {error && <div className="mb-2 text-sm text-red-300" data-save-as="error">{error}</div>}
        <div className="text-xs text-white/40 mb-3">{t('setup.save_as_hint', 'The current file is left unchanged. After saving, choose whether to clear all objects; the editor seeks to 0:00:000 either way.')}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40">{t('app.cancel', 'Cancel')}</button>
          <button onClick={() => void submit()} disabled={busy} data-save-as="ok" className="px-5 py-1.5 rounded bg-pink-500 hover:bg-pink-400 font-bold disabled:opacity-40">
            {busy ? t('setup.save_as_saving', 'Saving…') : 'OK'}
          </button>
        </div>
      </div>
    </div>
  </div>;
}

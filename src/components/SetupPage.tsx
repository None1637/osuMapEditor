import { useRef, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { planSvCompensation, applySvCompensation, type SvCompensationPlan } from '@/osu/timingSv'; // v480
import { useT } from '@/i18n';

// 基础数据页签: [General] / [Editor] / [Metadata] / [Difficulty]
export function SetupPage() {
  useEditor();
  const t = useT();
  const bm = store.beatmap;
  // v480: 滑条速度 SV 补偿弹窗 (用户: 在song setup中调整滑条速度后需要弹出一个提示框窗,
  //   显示是否同步调整所有绿线的sv, 无绿线覆盖的位置会加上绿线以保证滑条速度不变,
  //   超出 0.1~10 额外提醒, 不插红线) — 连改防抖 500ms 出窗, 基线 = 本轮首改前的倍率
  const [svComp, setSvComp] = useState<{ from: number; to: number; plan: SvCompensationPlan } | null>(null);
  const [svDraft, setSvDraft] = useState<string | null>(null); // 输入框草稿 (聚焦期间)
  const svCompTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svBaseRef = useRef<number | null>(null);
  if (!bm) return null;

  const upd = (fn: () => void) => { store.pushUndo(); fn(); store.emit(); };

  const commitSliderMultiplier = (v: number) => {
    if (!(v > 0)) return;
    const prev = bm.difficulty.sliderMultiplier;
    if (v === prev) return;
    if (!svComp && !svCompTimer.current) svBaseRef.current = prev; // 连改基线 = 首改前倍率
    upd(() => { bm.difficulty.sliderMultiplier = v; });
    if (svCompTimer.current) clearTimeout(svCompTimer.current);
    svCompTimer.current = setTimeout(() => {
      svCompTimer.current = null;
      const base = svBaseRef.current, cur = bm.difficulty.sliderMultiplier;
      svBaseRef.current = null;
      if (base !== null && base !== cur)
        setSvComp(p => p ?? { from: base, to: cur, plan: planSvCompensation(bm.timingPoints, base / cur) });
    }, 500);
  };
  const closeSvComp = () => { setSvComp(null); svBaseRef.current = null; };
  const applySvComp = () => {
    if (!svComp) return;
    upd(() => { bm.timingPoints = applySvCompensation(bm.timingPoints, svComp.plan); });
    closeSvComp();
  };

  const Text = ({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) => (
    <label className="flex items-center gap-2 text-sm text-white/70"> {/* v321 (F23): 基础字号 xs→sm */}
      <span className="w-44 shrink-0">{label}</span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
      {hint && <span className="text-white/35 w-56">{hint}</span>}
    </label>
  );
  const Num = ({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) => (
    <label className="flex items-center gap-2 text-sm text-white/70"> {/* v321 (F23): 基础字号 xs→sm */}
      <span className="w-44 shrink-0">{label}</span>
      <input type="number" step={step} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-32 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
      {hint && <span className="text-white/35">{hint}</span>}
    </label>
  );
  const Check = ({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <label className="flex items-center gap-2 text-sm text-white/70"> {/* v321 (F23): 基础字号 xs→sm */}
      <span className="w-44 shrink-0">{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      {hint && <span className="text-white/35">{hint}</span>}
    </label>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-[#16161d] rounded border border-white/10 p-4 space-y-2">
      <div className="font-bold text-pink-300 text-base mb-1">{title}</div> {/* v321 (F23): sm→base */}
      {children}
    </div>
  );

  return (
    <div className="flex-1 overflow-auto bg-[#101016] p-4">
      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={t('setup.section_general', '[General] General')}>
          <Text label={t('setup.audio_filename', 'AudioFilename Audio File')} value={bm.general.audioFilename} onChange={v => upd(() => bm.general.audioFilename = v)} />
          <Num label={t('setup.audio_lead_in', 'AudioLeadIn Audio Lead-In')} value={bm.general.audioLeadIn} onChange={v => upd(() => bm.general.audioLeadIn = v)} hint={t('setup.audio_lead_in_hint', 'Reserved ms before music starts')} />
          <Num label={t('setup.preview_time', 'PreviewTime Preview Time')} value={bm.general.previewTime} onChange={v => upd(() => bm.general.previewTime = v)} hint={t('setup.preview_time_hint', '-1 = automatic')} />
          <Num label={t('setup.countdown', 'Countdown')} value={bm.general.countdown} onChange={v => upd(() => bm.general.countdown = Math.round(v))} hint={t('setup.countdown_hint', '0=None 1=Normal 2=Half 3=Double')} />
          <Text label={t('setup.sample_set', 'SampleSet Sample Set')} value={bm.general.sampleSet} onChange={v => upd(() => bm.general.sampleSet = v)} hint="Normal / Soft / Drum" />
          <Num label={t('setup.stack_leniency', 'StackLeniency Stack Leniency')} value={bm.general.stackLeniency} step={0.1} onChange={v => upd(() => bm.general.stackLeniency = v)} />
          <Num label={t('setup.mode', 'Mode')} value={bm.general.mode} onChange={v => upd(() => bm.general.mode = Math.round(v))} hint="0=std 1=taiko 2=catch 3=mania" />
          <Check label="LetterboxInBreaks" value={!!bm.general.letterboxInBreaks} onChange={v => upd(() => bm.general.letterboxInBreaks = v ? 1 : 0)} hint={t('setup.letterbox_in_breaks_hint', 'Letterbox during breaks')} />
          <Check label="WidescreenStoryboard" value={!!bm.general.widescreenStoryboard} onChange={v => upd(() => bm.general.widescreenStoryboard = v ? 1 : 0)} hint={t('setup.widescreen_storyboard_hint', 'Widescreen storyboard')} />
        </Section>

        <Section title={t('setup.section_editor', '[Editor] Editor Behavior')}>
          <Num label={t('setup.distance_spacing', 'DistanceSpacing Distance Snap')} value={bm.editor.distanceSpacing} step={0.1} onChange={v => upd(() => bm.editor.distanceSpacing = v)}
            hint={t('setup.distance_spacing_hint', 'New note distance from previous = multiplier × 100 × beat interval')} />
          <Check label={t('setup.distance_lock_enable', 'Enable Distance Snap')} value={store.distanceLock} onChange={v => { store.distanceLock = v; store.emit(); }}
            hint={t('setup.distance_lock_enable_hint', 'Automatically keep fixed spacing when placing objects')} />
          <Num label={t('setup.beat_divisor', 'BeatDivisor Beat Snap Divisor')} value={bm.editor.beatDivisor} onChange={v => upd(() => bm.editor.beatDivisor = Math.max(1, Math.round(v)))}
            hint={t('setup.beat_divisor_hint', 'Timeline snapping and beat lines: 1/n')} />
          <Num label={t('setup.grid_size', 'GridSize Grid Size')} value={bm.editor.gridSize} onChange={v => upd(() => bm.editor.gridSize = Math.max(0, Math.round(v)))}
            hint={t('setup.grid_size_hint', 'Playfield guide grid px, 0 = off')} />
          <Num label={t('setup.timeline_zoom', 'TimelineZoom Timeline Zoom')} value={bm.editor.timelineZoom} step={0.25} onChange={v => upd(() => bm.editor.timelineZoom = Math.max(0.25, v))}
            hint={t('setup.timeline_zoom_hint', 'Zoom factor of the upper timeline')} />
        </Section>

        <Section title={t('setup.section_metadata', '[Metadata] Metadata')}>
          <Text label={t('setup.title', 'Title')} value={bm.metadata.title} onChange={v => upd(() => bm.metadata.title = v)} />
          <Text label="TitleUnicode" value={bm.metadata.titleUnicode} onChange={v => upd(() => bm.metadata.titleUnicode = v)} />
          <Text label={t('setup.artist', 'Artist')} value={bm.metadata.artist} onChange={v => upd(() => bm.metadata.artist = v)} />
          <Text label="ArtistUnicode" value={bm.metadata.artistUnicode} onChange={v => upd(() => bm.metadata.artistUnicode = v)} />
          <Text label={t('setup.creator', 'Creator')} value={bm.metadata.creator} onChange={v => upd(() => bm.metadata.creator = v)} />
          <Text label={t('setup.version', 'Version')} value={bm.metadata.version} onChange={v => upd(() => bm.metadata.version = v)} />
          <Text label={t('setup.source', 'Source')} value={bm.metadata.source} onChange={v => upd(() => bm.metadata.source = v)} />
          <Text label={t('setup.tags', 'Tags')} value={bm.metadata.tags} onChange={v => upd(() => bm.metadata.tags = v)} />
          <Text label="BeatmapID" value={bm.metadata.beatmapID} onChange={v => upd(() => bm.metadata.beatmapID = v)} />
          <Text label="BeatmapSetID" value={bm.metadata.beatmapSetID} onChange={v => upd(() => bm.metadata.beatmapSetID = v)} />
        </Section>

        <Section title={t('setup.section_difficulty', '[Difficulty] Difficulty')}>
          <Num label="HPDrainRate HP" value={bm.difficulty.hp} step={0.1} onChange={v => upd(() => bm.difficulty.hp = v)} />
          <Num label="CircleSize CS" value={bm.difficulty.cs} step={0.1} onChange={v => upd(() => bm.difficulty.cs = v)} hint={t('setup.circle_size_hint', 'Hit circle size, takes effect immediately')} />
          <Num label="OverallDifficulty OD" value={bm.difficulty.od} step={0.1} onChange={v => upd(() => bm.difficulty.od = v)} />
          <Num label="ApproachRate AR" value={bm.difficulty.ar} step={0.1} onChange={v => upd(() => bm.difficulty.ar = v)} hint={t('setup.approach_rate_hint', 'Approach circle speed, takes effect immediately')} />
          {/* v480: 滑条速度改草稿提交 (聚焦输入 blur/Enter 才落值; 滚轮等未聚焦改动即时落值),
              落值后防抖 500ms 弹绿线 SV 补偿窗 — 避免逐击键弹窗 */}
          <label className="flex items-center gap-2 text-sm text-white/70">
            <span className="w-44 shrink-0">{t('setup.slider_multiplier', 'SliderMultiplier Slider Velocity')}</span>
            <input type="number" step={0.1} value={svDraft ?? bm.difficulty.sliderMultiplier} data-setup="slider-multiplier"
              onChange={e => {
                setSvDraft(e.target.value);
                if (document.activeElement !== e.target) { commitSliderMultiplier(parseFloat(e.target.value)); setSvDraft(null); }
              }}
              onBlur={() => { if (svDraft !== null) { commitSliderMultiplier(parseFloat(svDraft)); setSvDraft(null); } }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-32 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
          </label>
          <Num label={t('setup.slider_tick_rate', 'SliderTickRate Slider Tick Rate')} value={bm.difficulty.sliderTickRate} step={0.5} onChange={v => upd(() => bm.difficulty.sliderTickRate = v)} />
        </Section>
      </div>
      {/* v480: 绿线 SV 补偿弹窗 */}
      {svComp && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center" data-dialog="sv-comp">
          <div className="bg-[#1b1b24] border border-white/15 rounded-lg p-4 w-[26rem] space-y-3 text-sm text-white/85">
            <div className="font-bold text-white/90 text-base">{t('setup.sv_comp_title', 'Adjust green line SVs to match?')}</div>
            <div>{t('setup.sv_comp_body', 'Base slider velocity {from} → {to}. Multiply every green line SV by {f} to keep slider speeds unchanged?', { from: svComp.from, to: svComp.to, f: Math.round(svComp.plan.f * 10000) / 10000 })}</div>
            {svComp.plan.inserts.length > 0 && (
              <div className="text-white/60">{t('setup.sv_comp_insert', '{n} green line(s) will be inserted where no green line covers (SV = {f}).', { n: svComp.plan.inserts.length, f: Math.round(svComp.plan.f * 10000) / 10000 })}</div>
            )}
            {svComp.plan.outOfRange > 0 && (
              <div className="text-yellow-300">{t('setup.sv_comp_clamp_warn', 'Note: {n} compensated SV(s) exceed 0.1~10 and will be clamped (slider speed will still change there); no red lines will be inserted.', { n: svComp.plan.outOfRange })}</div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button data-sv-comp="apply" onClick={applySvComp}
                className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 text-white font-bold">
                {t('setup.sv_comp_apply', 'Adjust SVs')}
              </button>
              <button data-sv-comp="skip" onClick={closeSvComp}
                className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">
                {t('setup.sv_comp_skip', 'Leave as is')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

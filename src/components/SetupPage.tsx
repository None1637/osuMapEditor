import { store, useEditor } from '@/osu/store';

// 基础数据页签: [General] / [Editor] / [Metadata] / [Difficulty]
export function SetupPage() {
  useEditor();
  const bm = store.beatmap;
  if (!bm) return null;

  const upd = (fn: () => void) => { store.pushUndo(); fn(); store.emit(); };

  const Text = ({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) => (
    <label className="flex items-center gap-2 text-xs text-white/70">
      <span className="w-44 shrink-0">{label}</span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
      {hint && <span className="text-white/35 w-56">{hint}</span>}
    </label>
  );
  const Num = ({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) => (
    <label className="flex items-center gap-2 text-xs text-white/70">
      <span className="w-44 shrink-0">{label}</span>
      <input type="number" step={step} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-32 bg-black/40 border border-white/15 rounded px-2 py-1 text-white" />
      {hint && <span className="text-white/35">{hint}</span>}
    </label>
  );
  const Check = ({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <label className="flex items-center gap-2 text-xs text-white/70">
      <span className="w-44 shrink-0">{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      {hint && <span className="text-white/35">{hint}</span>}
    </label>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-[#16161d] rounded border border-white/10 p-4 space-y-2">
      <div className="font-bold text-pink-300 text-sm mb-1">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="flex-1 overflow-auto bg-[#101016] p-4">
      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="[General] 常规">
          <Text label="AudioFilename 音频文件" value={bm.general.audioFilename} onChange={v => upd(() => bm.general.audioFilename = v)} />
          <Num label="AudioLeadIn 提前量" value={bm.general.audioLeadIn} onChange={v => upd(() => bm.general.audioLeadIn = v)} hint="音乐开始前预留 ms" />
          <Num label="PreviewTime 预览时间" value={bm.general.previewTime} onChange={v => upd(() => bm.general.previewTime = v)} hint="-1 = 自动" />
          <Num label="Countdown 倒计时" value={bm.general.countdown} onChange={v => upd(() => bm.general.countdown = Math.round(v))} hint="0=无 1=正常 2=半速 3=倍速" />
          <Text label="SampleSet 音效组" value={bm.general.sampleSet} onChange={v => upd(() => bm.general.sampleSet = v)} hint="Normal / Soft / Drum" />
          <Num label="StackLeniency 堆叠容差" value={bm.general.stackLeniency} step={0.1} onChange={v => upd(() => bm.general.stackLeniency = v)} />
          <Num label="Mode 模式" value={bm.general.mode} onChange={v => upd(() => bm.general.mode = Math.round(v))} hint="0=std 1=taiko 2=catch 3=mania" />
          <Check label="LetterboxInBreaks" value={!!bm.general.letterboxInBreaks} onChange={v => upd(() => bm.general.letterboxInBreaks = v ? 1 : 0)} hint="休息段黑边" />
          <Check label="WidescreenStoryboard" value={!!bm.general.widescreenStoryboard} onChange={v => upd(() => bm.general.widescreenStoryboard = v ? 1 : 0)} hint="宽屏故事板" />
        </Section>

        <Section title="[Editor] 编辑器行为">
          <Num label="DistanceSpacing 锁定间距" value={bm.editor.distanceSpacing} step={0.1} onChange={v => upd(() => bm.editor.distanceSpacing = v)}
            hint="新note与上个note的距离 = 倍率×100×间隔拍数" />
          <Check label="启用锁定间距" value={store.distanceLock} onChange={v => { store.distanceLock = v; store.emit(); }}
            hint="放置物件时自动保持固定间距" />
          <Num label="BeatDivisor 节拍细分" value={bm.editor.beatDivisor} onChange={v => upd(() => bm.editor.beatDivisor = Math.max(1, Math.round(v)))}
            hint="时间轴吸附与节拍线: 1/n" />
          <Num label="GridSize 网格大小" value={bm.editor.gridSize} onChange={v => upd(() => bm.editor.gridSize = Math.max(0, Math.round(v)))}
            hint="游玩区辅助线网格 px, 0=关闭" />
          <Num label="TimelineZoom 时间轴缩放" value={bm.editor.timelineZoom} step={0.25} onChange={v => upd(() => bm.editor.timelineZoom = Math.max(0.25, v))}
            hint="上方时间轴缩放倍率" />
        </Section>

        <Section title="[Metadata] 元数据">
          <Text label="Title 标题" value={bm.metadata.title} onChange={v => upd(() => bm.metadata.title = v)} />
          <Text label="TitleUnicode" value={bm.metadata.titleUnicode} onChange={v => upd(() => bm.metadata.titleUnicode = v)} />
          <Text label="Artist 艺术家" value={bm.metadata.artist} onChange={v => upd(() => bm.metadata.artist = v)} />
          <Text label="ArtistUnicode" value={bm.metadata.artistUnicode} onChange={v => upd(() => bm.metadata.artistUnicode = v)} />
          <Text label="Creator 作图者" value={bm.metadata.creator} onChange={v => upd(() => bm.metadata.creator = v)} />
          <Text label="Version 难度名" value={bm.metadata.version} onChange={v => upd(() => bm.metadata.version = v)} />
          <Text label="Source 来源" value={bm.metadata.source} onChange={v => upd(() => bm.metadata.source = v)} />
          <Text label="Tags 标签" value={bm.metadata.tags} onChange={v => upd(() => bm.metadata.tags = v)} />
          <Text label="BeatmapID" value={bm.metadata.beatmapID} onChange={v => upd(() => bm.metadata.beatmapID = v)} />
          <Text label="BeatmapSetID" value={bm.metadata.beatmapSetID} onChange={v => upd(() => bm.metadata.beatmapSetID = v)} />
        </Section>

        <Section title="[Difficulty] 难度">
          <Num label="HPDrainRate HP" value={bm.difficulty.hp} step={0.1} onChange={v => upd(() => bm.difficulty.hp = v)} />
          <Num label="CircleSize CS" value={bm.difficulty.cs} step={0.1} onChange={v => upd(() => bm.difficulty.cs = v)} hint="圆圈大小, 实时生效" />
          <Num label="OverallDifficulty OD" value={bm.difficulty.od} step={0.1} onChange={v => upd(() => bm.difficulty.od = v)} />
          <Num label="ApproachRate AR" value={bm.difficulty.ar} step={0.1} onChange={v => upd(() => bm.difficulty.ar = v)} hint="缩圈速度, 实时生效" />
          <Num label="SliderMultiplier 滑条速度" value={bm.difficulty.sliderMultiplier} step={0.1} onChange={v => upd(() => bm.difficulty.sliderMultiplier = v)} />
          <Num label="SliderTickRate 滑条点率" value={bm.difficulty.sliderTickRate} step={0.5} onChange={v => upd(() => bm.difficulty.sliderTickRate = v)} />
        </Section>
      </div>
    </div>
  );
}

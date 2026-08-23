// v144: 音量设置面板 (显示设置左侧「音量」按钮) — 主/歌曲/音效三级滑条, 样式仿 DisplayPanel
import { store, useEditor } from '@/osu/store';
import { volumeSettings, type VolumeSettings } from '@/osu/volumeSettings';
import { DraggableDialog } from './DraggableDialog';

const ROWS: { key: keyof VolumeSettings; name: string; desc: string }[] = [
  { key: 'master', name: '主音量 (Master)', desc: '对歌曲与音效同时生效' },
  { key: 'music', name: '歌曲音量 (Music)', desc: '只影响歌曲播放' },
  { key: 'effects', name: '音效音量 (Effects)', desc: '只影响 hitsound 与滑条循环音' },
];

export function VolumePanel() {
  useEditor();
  return (
    <DraggableDialog title="音量设置" testid="volume-panel" width={360} onClose={() => store.setVolumePanelOpen(false)}>
      <div className="space-y-3">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-volume-row={r.key}>
            <div className="w-24 shrink-0">
              <div className="text-xs text-white/90">{r.name}</div>
              <div className="text-[10px] text-white/40 leading-4">{r.desc}</div>
            </div>
            <input type="range" min={0} max={100} step={1} value={volumeSettings[r.key]}
              data-volume-slider={r.key}
              onChange={e => store.setVolume(r.key, parseInt(e.target.value))}
              className="flex-1 accent-sky-500" />
            <div className="w-10 text-right text-xs text-white/70 tabular-nums" data-volume-value={r.key}>
              {volumeSettings[r.key]}%
            </div>
          </div>
        ))}
        <div className="text-[10px] text-white/35 pt-1 border-t border-white/10">
          调整即时生效并自动记忆; 最终音量 = 主音量 × 歌曲/音效音量。
        </div>
      </div>
    </DraggableDialog>
  );
}

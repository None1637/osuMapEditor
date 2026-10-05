// v144: 音量设置面板 (显示设置左侧「音量」按钮) — 主/歌曲/音效三级滑条, 样式仿 DisplayPanel
import { store, useEditor } from '@/osu/store';
import { volumeSettings, type VolumeSettings } from '@/osu/volumeSettings';
import { useT } from '@/i18n';
import { DraggableDialog } from './DraggableDialog';

const ROWS: { key: keyof VolumeSettings; i18n: string; name: string; desc: string }[] = [
  { key: 'master', i18n: 'master', name: 'Master', desc: 'Affects both music and effects' },
  { key: 'music', i18n: 'music', name: 'Music', desc: 'Affects music playback only' },
  { key: 'effects', i18n: 'effects', name: 'Effects', desc: 'Affects hitsounds and slider loops only' },
];

export function VolumePanel() {
  useEditor();
  const t = useT();
  return (
    <DraggableDialog title={t('volume.title', 'Volume Settings')} testid="volume-panel" width={360} onClose={() => store.setVolumePanelOpen(false)}>
      <div className="space-y-3">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-volume-row={r.key}>
            <div className="w-24 shrink-0">
              <div className="text-xs text-white/90">{t(`volume.${r.i18n}`, r.name)}</div>
              <div className="text-[10px] text-white/40 leading-4">{t(`volume.${r.i18n}_desc`, r.desc)}</div>
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
          {t('volume.note', 'Changes apply instantly and are remembered; final volume = Master × Music/Effects volume.')}
        </div>
      </div>
    </DraggableDialog>
  );
}

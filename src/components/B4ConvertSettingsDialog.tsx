// v589: B4 转贝塞尔参数设置 (拟合容差与最高阶数)
import { store, useEditor } from '@/osu/store';
import { b4ConvertSettings, setB4ConvertFitTolerance, setB4ConvertMaxDegree } from '@/osu/convert/convertB4';
import { DraggableDialog, DraftNum } from './DraggableDialog';
import { useT } from '@/i18n';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-24 text-white/50">{label}</span>
    {children}
  </div>
);

export function B4ConvertSettingsDialog() {
  useEditor();
  const t = useT();
  return (
    <DraggableDialog title={t('b4_settings.title', 'B4 to Bezier Settings')} testid="b4-convert-settings" width={360} onClose={() => store.closeB4ConvertSettings()}>
      <div className="flex flex-col gap-2 text-xs text-white/80">
        <Row label={t('b4_settings.tolerance', 'Fit tolerance (px)')}>
          <DraftNum value={b4ConvertSettings.fitTolerance} testid="fit-tolerance" min={0.25} max={20} step={0.25}
            set={v => { setB4ConvertFitTolerance(v); store.emitSelection(); }} />
        </Row>
        <Row label={t('b4_settings.max_degree', 'Max Bezier degree')}>
          <DraftNum value={b4ConvertSettings.maxDegree} testid="max-degree" min={3} max={24} step={1}
            set={v => { setB4ConvertMaxDegree(v); store.emitSelection(); }} />
        </Row>
        <div className="text-white/40">{t('b4_settings.hint', 'Larger tolerance usually means fewer anchors but more deviation. Higher degrees allow smoother single-segment fitting with more ordinary anchors.')}</div>
      </div>
    </DraggableDialog>
  );
}

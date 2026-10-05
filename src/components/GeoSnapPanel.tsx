// v84: 几何辅助面板 (Mapping Tools Geometry Dashboard 风格, 仅三种): 开关行 = 切换钮 + 名称 + 说明
import { store, useEditor } from '@/osu/store';
import { DraggableDialog } from './DraggableDialog';
import { useT } from '@/i18n';

const ROWS: { key: 'geoCenter' | 'geoCircle' | 'geoLines'; nameKey: string; name: string; descKey: string; desc: string }[] = [
  { key: 'geoCenter', nameKey: 'geo.center_name', name: 'Points on Blanket Centers', descKey: 'geo.center_desc', desc: 'Selected 3-point arc slider: shows the arc center (cyan point), snappable' },
  { key: 'geoCircle', nameKey: 'geo.circle_name', name: 'Circles on 3-Point Sliders', descKey: 'geo.circle_desc', desc: 'Selected 3-point arc slider: shows the full circumscribed circle (red dashed), circumference snappable' },
  { key: 'geoLines', nameKey: 'geo.lines_name', name: 'Lines on Linear Sliders', descKey: 'geo.lines_desc', desc: 'Selected linear slider or a slider starting/ending with a linear segment: shows head/tail extension lines (red dashed), snappable' },
];

export function GeoSnapPanel() {
  useEditor();
  const t = useT();
  return (
    <DraggableDialog title={t('geo.title', 'Geometry Helpers')} testid="geo-snap" width={380} onClose={() => store.setGeoPanelOpen(false)}>
      <div className="space-y-2.5">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-geo-row={r.key}>
            <button onClick={() => store.setGeoFlag(r.key, !store[r.key])}
              data-geo-toggle={r.key}
              className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${store[r.key] ? 'bg-sky-500' : 'bg-white/15'}`}
              title={store[r.key] ? t('geo.toggle_off', 'Click to disable') : t('geo.toggle_on', 'Click to enable')}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${store[r.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${store[r.key] ? 'text-white/90' : 'text-white/45'}`}>{t(r.nameKey, r.name)}</div>
              <div className="text-[10px] text-white/40 leading-4">{t(r.descKey, r.desc)}</div>
            </div>
          </div>
        ))}
        {/* v126: 视觉间距辅助线 — 开关行 + 距离输入 (物件边缘外扩 px) */}
        <div className="flex items-center gap-2.5" data-geo-row="geoDist">
          <button onClick={() => store.setGeoFlag('geoDist', !store.geoDist)}
            data-geo-toggle="geoDist"
            className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${store.geoDist ? 'bg-sky-500' : 'bg-white/15'}`}
            title={store.geoDist ? t('geo.toggle_off', 'Click to disable') : t('geo.toggle_on', 'Click to enable')}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${store.geoDist ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div className="min-w-0 flex-1">
            <div className={`text-xs ${store.geoDist ? 'text-white/90' : 'text-white/45'}`}>{t('geo.dist_name', 'Distance Guides')}</div>
            <div className="text-[10px] text-white/40 leading-4">{t('geo.dist_desc', 'Equidistant outlines expanding from object edges (Hit Circle = ring, Slider = band outline, gold); when placing/dragging an object, its center snaps to the band lines (same threshold as object snap: 6.4px)')}</div>
          </div>
          <label className={`flex items-center gap-1 shrink-0 text-[10px] ${store.geoDist ? 'text-white/70' : 'text-white/35'}`}>
            <input type="number" min={0} max={500} step={5} value={store.geoDistValue}
              data-geo-dist-input
              disabled={!store.geoDist}
              onChange={e => store.setGeoDistValue(parseFloat(e.target.value))}
              className="w-14 bg-white/10 rounded px-1 py-0.5 text-right text-xs text-white/90 outline-none disabled:opacity-40" />
            px
          </label>
        </div>
        <div className="text-[10px] text-white/35 pt-1 border-t border-white/10">
          {t('geo.hint', 'Guide shapes only apply to selected sliders; objects and control points snap automatically within 6.4px while placing/dragging (same as the object snap threshold). Distance Guides apply to Hit Circles + Sliders and also support snapping (v139: object centers snap directly to the visible band lines).')}
        </div>
        {/* v88: 显示范围 (互斥); v90: none 撤销, 显示/隐藏改工具栏「辅助线」按钮 */}
        <div className="space-y-1.5 pt-1 border-t border-white/10">
          {([
            { v: 'all' as const, key: 'geo.scope_all', label: 'Show guides/points for all currently displayed objects' },
            { v: 'selection' as const, key: 'geo.scope_selection', label: 'Only for the current selection, plus guides/points from the last time other objects were selected' },
          ]).map(o => (
            <label key={o.v} className="flex items-center gap-1.5 cursor-pointer select-none text-white/70">
              <input type="checkbox" checked={store.geoScope === o.v} data-geo-scope={o.v}
                onChange={() => store.setGeoScope(o.v)} />
              {t(o.key, o.label)}
            </label>
          ))}
        </div>
      </div>
    </DraggableDialog>
  );
}

// v84: 几何辅助面板 (Mapping Tools Geometry Dashboard 风格, 仅三种): 开关行 = 切换钮 + 名称 + 说明
import { store, useEditor } from '@/osu/store';
import { DraggableDialog } from './DraggableDialog';

const ROWS: { key: 'geoCenter' | 'geoCircle' | 'geoLines'; name: string; desc: string }[] = [
  { key: 'geoCenter', name: '圆心辅助点 (Points on Blanket Centers)', desc: '选中的三点圆弧滑条: 显示圆心 (青色点), 可吸附' },
  { key: 'geoCircle', name: '三点圆 (Circles on 3-Point Sliders)', desc: '选中的三点圆弧滑条: 显示完整外接圆 (红色虚线), 圆周可吸附' },
  { key: 'geoLines', name: '直线延伸线 (Lines on Linear Sliders)', desc: '选中的直线滑条或以直线开头/结尾的滑条: 显示头尾延伸线 (红色虚线), 可吸附' },
];

export function GeoSnapPanel() {
  useEditor();
  return (
    <DraggableDialog title="几何辅助 (Geometry)" testid="geo-snap" width={380} onClose={() => store.setGeoPanelOpen(false)}>
      <div className="space-y-2.5">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-geo-row={r.key}>
            <button onClick={() => store.setGeoFlag(r.key, !store[r.key])}
              data-geo-toggle={r.key}
              className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${store[r.key] ? 'bg-sky-500' : 'bg-white/15'}`}
              title={store[r.key] ? '点击关闭' : '点击开启'}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${store[r.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${store[r.key] ? 'text-white/90' : 'text-white/45'}`}>{r.name}</div>
              <div className="text-[10px] text-white/40 leading-4">{r.desc}</div>
            </div>
          </div>
        ))}
        {/* v126: 视觉间距辅助线 — 开关行 + 距离输入 (物件边缘外扩 px) */}
        <div className="flex items-center gap-2.5" data-geo-row="geoDist">
          <button onClick={() => store.setGeoFlag('geoDist', !store.geoDist)}
            data-geo-toggle="geoDist"
            className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${store.geoDist ? 'bg-sky-500' : 'bg-white/15'}`}
            title={store.geoDist ? '点击关闭' : '点击开启'}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${store.geoDist ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div className="min-w-0 flex-1">
            <div className={`text-xs ${store.geoDist ? 'text-white/90' : 'text-white/45'}`}>视觉间距辅助线 (Distance Guides)</div>
            <div className="text-[10px] text-white/40 leading-4">物件边缘外扩等距轮廓 (单点=圆环, 滑条=环带轮廓, 金色); 放置/拖动物件时物件中心吸附到环带线上 (阈值同物件吸附 6.4px)</div>
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
          辅助图形仅作用于选中的滑条; 放置/拖动物件与控制点时在 6.4px 内自动吸附 (同物件吸附阈值)。间距辅助线作用于单点+滑条, 同样支持吸附 (v139: 物件中心直接吸到可见环带线)。
        </div>
        {/* v88: 显示范围 (互斥); v90: none 撤销, 显示/隐藏改工具栏「辅助线」按钮 */}
        <div className="space-y-1.5 pt-1 border-t border-white/10">
          {([
            { v: 'all' as const, label: '当前显示的所有物件都显示辅助线/点' },
            { v: 'selection' as const, label: '仅当前选中物件, 与上次选中其他物件时的辅助线/点' },
          ]).map(o => (
            <label key={o.v} className="flex items-center gap-1.5 cursor-pointer select-none text-white/70">
              <input type="checkbox" checked={store.geoScope === o.v} data-geo-scope={o.v}
                onChange={() => store.setGeoScope(o.v)} />
              {o.label}
            </label>
          ))}
        </div>
      </div>
    </DraggableDialog>
  );
}

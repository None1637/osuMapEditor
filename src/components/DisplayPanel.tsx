// v132: 显示设置面板 (页签栏右侧「显示设置」按钮) — 开关行样式仿 GeoSnapPanel
import { useEffect, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { displaySettings, type BoolDisplayKey, type StrDisplayKey } from '@/osu/displaySettings';
import { getElectronAPI, isElectron } from '@/osu/electronBridge'; // v263: 窗口条隐藏开关 (Electron 专属)
import { DraggableDialog } from './DraggableDialog';
import { useT } from '@/i18n';

const ROWS: { key: BoolDisplayKey; nameKey: string; nameEn: string; descKey: string; descEn: string }[] = [
  { key: 'skinColors', nameKey: 'display.skin_colours_name', nameEn: 'Skin Colours', descKey: 'display.skin_colours_desc', descEn: "Prefer the skin's skin.ini [Colours] over the beatmap's own object/slider colours (on: skin first, off: beatmap first; undefined entries fall back to the other side, then defaults)" },
  { key: 'sliderPathLine', nameKey: 'display.slider_path_line_name', nameEn: 'Slider Path Line', descKey: 'display.slider_path_line_desc', descEn: 'Draw a thin solid line along the centre of slider bodies, making the slider path easy to confirm' },
  // v353
  { key: 'sliderGradientTrack', nameKey: 'display.slider_gradient_track_name', nameEn: 'Gradient Slider Track', descKey: 'display.slider_gradient_track_desc', descEn: 'Slider track with a radial gradient (bright centre fading to dark edges, same as lazer LegacySliderBody); when off, a flat black track (stable-style experimental look since v19)' },
  { key: 'approachCircle', nameKey: 'display.approach_circle_name', nameEn: 'Approach Circles', descKey: 'display.approach_circle_desc', descEn: 'Approach circle animation that shrinks from 4x size when objects appear' },
  { key: 'sliderFadeOut', nameKey: 'display.slider_fade_out_name', nameEn: 'Slider Fade Out', descKey: 'display.slider_fade_out_desc', descEn: 'Fades out over 240ms after the slider ends; when off, it disappears immediately at the end' },
  { key: 'hitExplosion', nameKey: 'display.hit_explosion_name', nameEn: 'Hit Explosion', descKey: 'display.hit_explosion_desc', descEn: 'Hit circles linger briefly and scale-fade after being hit; when off, they disappear immediately on hit' },
  // v147
  { key: 'hitAnimation', nameKey: 'display.hit_animation_name', nameEn: 'Hit Animation', descKey: 'display.hit_animation_desc', descEn: 'Plays a 240ms scale-fade animation on hit; when off, no scaling, the object lingers at its original size for 800ms then fades, and the approach circle bounces back out slightly after reaching the circle edge (same as the osu!stable editor; requires Hit Explosion)' },
  // v253/v254
  { key: 'showFps', nameKey: 'display.show_fps_name', nameEn: 'FPS Counter', descKey: 'display.show_fps_desc', descEn: 'Floating real-time FPS counter in the bottom-right corner; when off, it is not mounted at all' },
  { key: 'selectionBounds', nameKey: 'display.selection_bounds_name', nameEn: 'Selection Bounds', descKey: 'display.selection_bounds_desc', descEn: 'Yellow bounding box and scale/rotate handles for selected objects; when off, only the object selection effect is shown' },
  // v284: 时间轴半透明开关移除 — 半透明为唯一行为 (用户要求: 默认就是半透明, 不要开关)
];

// v231/v232: stable/lazer 二选下拉行 (布局仿下方 bgBrightness 的 custom 行)
const SELECT_ROWS: { key: StrDisplayKey; nameKey: string; nameEn: string; descKey: string; descEn: string; options: ['stable' | 'lazer', string, string][] }[] = [
  // v231
  { key: 'sliderPointStyle', nameKey: 'display.slider_point_style_name', nameEn: 'Slider Point Style', descKey: 'display.slider_point_style_desc', descEn: 'Appearance of control point handles in slider select/place preview: stable = small solid red/white squares (same as the osu!stable editor)', options: [['stable', 'display.slider_point_style_option_stable', 'stable squares'], ['lazer', 'display.slider_point_style_option_lazer', 'lazer dots']] },
  // v232
  { key: 'selectionStyle', nameKey: 'display.selection_style_name', nameEn: 'Selection Style', descKey: 'display.selection_style_desc', descEn: 'stable = orange-yellow rings (one ring each at slider head/tail + blue border highlight; blue ring on hover, aligned with the stable client since v305); lazer = slider highlight outline ring + cyan dashed ring', options: [['stable', 'display.selection_style_option_stable', 'stable rings'], ['lazer', 'display.selection_style_option_lazer', 'lazer outline']] },
];

export function DisplayPanel() {
  useEditor();
  const t = useT();
  // v263: 窗口条隐藏 (Electron 专属; 写 settings.json, 重启后生效)
  const [hideTitleBar, setHideTitleBar] = useState<boolean | null>(null);
  useEffect(() => {
    getElectronAPI()?.getSettings().then(s => setHideTitleBar(!!s.hideTitleBar)).catch(() => { });
  }, []);
  return (
    <DraggableDialog title={t('display.title', 'Display Settings')} testid="display-panel" width={380} onClose={() => store.setDisplayPanelOpen(false)}>
      <div className="space-y-2.5">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-display-row={r.key}>
            <button onClick={() => store.setDisplayFlag(r.key, !displaySettings[r.key])}
              data-display-toggle={r.key}
              className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${displaySettings[r.key] ? 'bg-sky-500' : 'bg-white/15'}`}
              title={displaySettings[r.key] ? t('display.click_to_disable', 'Click to disable') : t('display.click_to_enable', 'Click to enable')}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${displaySettings[r.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${displaySettings[r.key] ? 'text-white/90' : 'text-white/45'}`}>{t(r.nameKey, r.nameEn)}</div>
              <div className="text-[10px] text-white/40 leading-4">{t(r.descKey, r.descEn)}</div>
            </div>
          </div>
        ))}
        {/* v231/v232: stable/lazer 下拉行 */}
        {SELECT_ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-display-row={r.key}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-white/90">{t(r.nameKey, r.nameEn)}</div>
              <div className="text-[10px] text-white/40 leading-4">{t(r.descKey, r.descEn)}</div>
            </div>
            <select value={displaySettings[r.key]} data-display-select={r.key}
              onChange={e => store.setDisplayString(r.key, e.target.value as 'stable' | 'lazer')}
              className="shrink-0 bg-white/10 rounded px-1.5 py-1 text-xs text-white/90 outline-none">
              {r.options.map(([v, labelKey, labelEn]) => <option key={v} value={v} className="bg-neutral-800">{t(labelKey, labelEn)}</option>)}
            </select>
          </div>
        ))}
        {/* v168: 背景图亮度滑条 (默认 35% = 旧固定 alpha 0.35; 样式仿 VolumePanel) */}
        <div className="flex items-center gap-2.5" data-display-row="bgBrightness">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/90">{t('display.bg_brightness_name', 'Background Brightness')}</div>
            <div className="text-[10px] text-white/40 leading-4">{t('display.bg_brightness_desc', 'Opacity of the playfield background image; 0% fully hidden, 100% full brightness')}</div>
          </div>
          <input type="range" min={0} max={100} step={1} value={displaySettings.bgBrightness}
            data-display-slider="bgBrightness"
            onChange={e => store.setDisplayNumber('bgBrightness', parseInt(e.target.value))}
            className="w-28 accent-sky-500" />
          <div className="w-10 text-right text-xs text-white/70 tabular-nums" data-display-value="bgBrightness">
            {displaySettings.bgBrightness}%
          </div>
        </div>
        {/* v263: 窗口条隐藏 (Electron 专属; 重启后生效; 页签栏兼作拖拽区) */}
        {isElectron() && hideTitleBar !== null && (
          <div className="flex items-center gap-2.5" data-display-row="hideTitleBar">
            <button onClick={() => { const v = !hideTitleBar; setHideTitleBar(v); getElectronAPI()?.setHideTitleBar(v).catch(() => { }); }}
              data-display-toggle="hideTitleBar"
              className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${hideTitleBar ? 'bg-sky-500' : 'bg-white/15'}`}
              title={hideTitleBar ? t('display.click_to_disable', 'Click to disable') : t('display.click_to_enable', 'Click to enable')}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hideTitleBar ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${hideTitleBar ? 'text-white/90' : 'text-white/45'}`}>{t('display.hide_title_bar_name', 'Hide Title Bar')}</div>
              <div className="text-[10px] text-white/40 leading-4">{t('display.hide_title_bar_desc', 'Removes the system title bar while keeping the top-right minimize/maximize/close buttons; blank areas of the tab bar can drag the window; takes effect after restart')}</div>
            </div>
          </div>
        )}
        <div className="text-[10px] text-white/35 pt-1 border-t border-white/10">
          {t('display.footer_note', 'Settings take effect immediately and are remembered automatically; they only affect in-editor display and are not written to beatmap files.')}
        </div>
      </div>
    </DraggableDialog>
  );
}

// v132: 显示设置面板 (页签栏右侧「显示设置」按钮) — 开关行样式仿 GeoSnapPanel
import { useEffect, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { displaySettings, type BoolDisplayKey, type StrDisplayKey } from '@/osu/displaySettings';
import { getElectronAPI, isElectron } from '@/osu/electronBridge'; // v263: 窗口条隐藏开关 (Electron 专属)
import { DraggableDialog } from './DraggableDialog';

const ROWS: { key: BoolDisplayKey; name: string; desc: string }[] = [
  { key: 'skinColors', name: '使用皮肤颜色 (Skin Colours)', desc: '用皮肤 skin.ini [Colours] 的物件/滑条颜色替代谱面自带颜色 (皮肤未定义的项回退谱面颜色)' },
  { key: 'sliderPathLine', name: '滑条轨迹线 (Slider Path Line)', desc: '滑条身正中画一条细实线, 方便确认滑条轨迹' },
  { key: 'approachCircle', name: '缩圈 (Approach Circles)', desc: '物件出现时从 4 倍大小收缩的缩圈动画' },
  { key: 'sliderFadeOut', name: '滑条渐出 (Slider Fade Out)', desc: '滑条结束后 240ms 淡出; 关闭则结束立即消失' },
  { key: 'hitExplosion', name: 'note 点击特效 (Hit Explosion)', desc: '单点命中后暂留并放大淡出; 关闭则命中立即消失' },
  // v147
  { key: 'hitAnimation', name: 'note 打击动画 (Hit Animation)', desc: '命中后播放 240ms 放大淡出动画; 关闭则不放大, 命中后原大小残留 800ms 渐隐, 缩圈缩到圈边后向外反弹一点再停住 (osu!stable 编辑器同款; 需点击特效开启)' },
  // v253/v254
  { key: 'showFps', name: '帧数显示 (FPS Counter)', desc: '右下角悬浮的实时帧数; 关闭则完全不挂载' },
  { key: 'selectionBounds', name: '选中包围框 (Selection Bounds)', desc: '选中物件的黄色包围框与缩放/旋转手柄; 关闭则只显示物件选中效果' },
  // v284: 时间轴半透明开关移除 — 半透明为唯一行为 (用户要求: 默认就是半透明, 不要开关)
];

// v231/v232: stable/lazer 二选下拉行 (布局仿下方 bgBrightness 的 custom 行)
const SELECT_ROWS: { key: StrDisplayKey; name: string; desc: string; options: ['stable' | 'lazer', string][] }[] = [
  // v231
  { key: 'sliderPointStyle', name: '滑条控制点样式 (Slider Point Style)', desc: '滑条选中/放置预览的控制点手柄外观: stable = 红/白实心小方格 (osu!stable 编辑器同款)', options: [['stable', 'stable 方格'], ['lazer', 'lazer 圆点']] },
  // v232
  { key: 'selectionStyle', name: '物件选中效果 (Selection Style)', desc: 'stable = 皮肤 hitcircleselect 圆角选框 (滑条头/尾各一张); lazer = 滑条高亮描边环 + 青色虚线环', options: [['stable', 'stable 选框'], ['lazer', 'lazer 描边']] },
];

export function DisplayPanel() {
  useEditor();
  // v263: 窗口条隐藏 (Electron 专属; 写 settings.json, 重启后生效)
  const [hideTitleBar, setHideTitleBar] = useState<boolean | null>(null);
  useEffect(() => {
    getElectronAPI()?.getSettings().then(s => setHideTitleBar(!!s.hideTitleBar)).catch(() => { });
  }, []);
  return (
    <DraggableDialog title="显示设置" testid="display-panel" width={380} onClose={() => store.setDisplayPanelOpen(false)}>
      <div className="space-y-2.5">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-display-row={r.key}>
            <button onClick={() => store.setDisplayFlag(r.key, !displaySettings[r.key])}
              data-display-toggle={r.key}
              className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${displaySettings[r.key] ? 'bg-sky-500' : 'bg-white/15'}`}
              title={displaySettings[r.key] ? '点击关闭' : '点击开启'}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${displaySettings[r.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${displaySettings[r.key] ? 'text-white/90' : 'text-white/45'}`}>{r.name}</div>
              <div className="text-[10px] text-white/40 leading-4">{r.desc}</div>
            </div>
          </div>
        ))}
        {/* v231/v232: stable/lazer 下拉行 */}
        {SELECT_ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-2.5" data-display-row={r.key}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-white/90">{r.name}</div>
              <div className="text-[10px] text-white/40 leading-4">{r.desc}</div>
            </div>
            <select value={displaySettings[r.key]} data-display-select={r.key}
              onChange={e => store.setDisplayString(r.key, e.target.value as 'stable' | 'lazer')}
              className="shrink-0 bg-white/10 rounded px-1.5 py-1 text-xs text-white/90 outline-none">
              {r.options.map(([v, label]) => <option key={v} value={v} className="bg-neutral-800">{label}</option>)}
            </select>
          </div>
        ))}
        {/* v168: 背景图亮度滑条 (默认 35% = 旧固定 alpha 0.35; 样式仿 VolumePanel) */}
        <div className="flex items-center gap-2.5" data-display-row="bgBrightness">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/90">背景图亮度 (Background Brightness)</div>
            <div className="text-[10px] text-white/40 leading-4">游玩区背景图的不透明度; 0% 完全隐藏, 100% 全亮</div>
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
              title={hideTitleBar ? '点击关闭' : '点击开启'}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hideTitleBar ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="min-w-0">
              <div className={`text-xs ${hideTitleBar ? 'text-white/90' : 'text-white/45'}`}>隐藏窗口标题栏 (Hide Title Bar)</div>
              <div className="text-[10px] text-white/40 leading-4">去掉系统标题栏, 保留右上角最小/最大/关闭; 页签栏空白处可拖动窗口; 重启后生效</div>
            </div>
          </div>
        )}
        <div className="text-[10px] text-white/35 pt-1 border-t border-white/10">
          设置即时生效并自动记忆; 仅影响编辑器内显示, 不写入谱面文件。
        </div>
      </div>
    </DraggableDialog>
  );
}

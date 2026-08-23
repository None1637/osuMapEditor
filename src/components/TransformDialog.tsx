// v209: 旋转/缩放独立窗口 (编辑菜单「旋转...」Ctrl+Shift+R /「缩放...」Ctrl+Shift+S)
// 功能复制自左侧栏 Inspector 变换面板 (左侧栏保留): 同一 store.originMode/customOrigin 原点设置,
// 同一 rotateSelected/scaleSelected 变换入口 (一次应用一次 undo)。窗口间角度/倍率各自独立记忆。
// v210: 新增对称模式 (编辑菜单「对称...」, 无快捷键) — 对称轴: 选区/中心(竖直或水平线)/自定义(两点决定直线,
// 画布上可拖拽两端点, 两点最小间距 4px 无法重合); 应用 = store.reflectSelected (一次 undo)。
import { useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { store, useEditor, type TransformOrigin } from '@/osu/store';
import { DraggableDialog, DraftNum } from './DraggableDialog';

export function TransformDialog({ mode }: { mode: 'rotate' | 'scale' | 'symmetry' }) {
  useEditor();
  const [angle, setAngle] = useState(90);
  const [factor, setFactor] = useState(1.1);
  const originMode = store.originMode;
  const origin: TransformOrigin = store.currentOrigin();
  const selCount = store.selected.size;
  const title = mode === 'rotate' ? '旋转' : mode === 'scale' ? '缩放' : '对称';

  return (
    <DraggableDialog title={`${title} (${selCount} 个选中)`}
      testid={mode === 'rotate' ? 'rotate-dlg' : mode === 'scale' ? 'scale-dlg' : 'symmetry-dlg'} width={340}
      onClose={() => store.closeTransformDialog()}>
      {mode !== 'symmetry' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/50">原点</span>
          {([['selection', '选区'], ['playfield', '中心'], ['custom', '自定义']] as const).map(([m, label]) => (
            <label key={m} className="flex items-center gap-0.5 text-white/70">
              <input type="radio" name="tfdlg-origin" checked={originMode === m} data-tf={`origin-${m}`}
                onChange={() => store.setOriginMode(m)} />
              {label}
            </label>
          ))}
          {originMode === 'custom' && (
            <span className="flex items-center gap-1">
              <DraftNum value={store.customOrigin.x} set={v => store.setCustomOrigin({ x: v, y: store.customOrigin.y })} testid="custom-x" />
              <DraftNum value={store.customOrigin.y} set={v => store.setCustomOrigin({ x: store.customOrigin.x, y: v })} testid="custom-y" />
            </span>
          )}
        </div>
      )}
      {mode === 'rotate' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-white/50">角度</span>
          <DraftNum value={angle} set={setAngle} testid="angle" />
          <button onClick={() => store.rotateSelected(-Math.abs(angle), origin)} title="按输入角度逆时针旋转"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCcw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />逆时针
          </button>
          <button onClick={() => store.rotateSelected(Math.abs(angle), origin)} title="按输入角度顺时针旋转"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />顺时针
          </button>
        </div>
      )}
      {mode === 'scale' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-white/50">倍率</span>
          <DraftNum value={factor} set={setFactor} testid="factor" min={0.01} step={0.05} />
          <button onClick={() => store.scaleSelected(factor, origin)} title="按输入倍率缩放 (滑条长度同步)"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            应用倍率
          </button>
        </div>
      )}
      {mode === 'symmetry' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/50">对称轴</span>
            {([['selection', '选区'], ['center', '中心'], ['custom', '自定义']] as const).map(([m, label]) => (
              <label key={m} className="flex items-center gap-0.5 text-white/70">
                <input type="radio" name="tfdlg-sym" checked={store.symAxisMode === m} data-sym={`axis-${m}`}
                  onChange={() => store.setSymAxisMode(m)} />
                {label}
              </label>
            ))}
          </div>
          {store.symAxisMode !== 'custom' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/50">轴向</span>
              {([['v', '竖直线 (左右镜像)'], ['h', '水平线 (上下镜像)']] as const).map(([d, label]) => (
                <label key={d} className="flex items-center gap-0.5 text-white/70">
                  <input type="radio" name="tfdlg-symdir" checked={store.symAxisDir === d} data-sym={`dir-${d}`}
                    onChange={() => store.setSymAxisDir(d)} />
                  {label}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-white/50 w-8">点 1</span>
                <DraftNum value={store.symP1.x} set={v => store.setSymPoint(1, { x: v, y: store.symP1.y })} testid="sym-p1x" />
                <DraftNum value={store.symP1.y} set={v => store.setSymPoint(1, { x: store.symP1.x, y: v })} testid="sym-p1y" />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-white/50 w-8">点 2</span>
                <DraftNum value={store.symP2.x} set={v => store.setSymPoint(2, { x: v, y: store.symP2.y })} testid="sym-p2x" />
                <DraftNum value={store.symP2.y} set={v => store.setSymPoint(2, { x: store.symP2.x, y: v })} testid="sym-p2y" />
              </div>
              <div className="text-white/35">对称轴 = 两点决定的直线; 可直接在游玩区拖拽两个紫色端点 (两点不会重合)</div>
            </div>
          )}
          <div>
            <button onClick={() => store.reflectSelected()} title="选区关于对称轴镜像"
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
              应用对称
            </button>
          </div>
        </>
      )}
      <div className="text-white/35">{mode === 'symmetry' ? '画布虚线 = 当前对称轴预览; 每次应用一次撤销, 窗口保持打开可连续应用' : '与左侧栏变换面板同源 (共用原点设置), 每次应用一次撤销; 窗口保持打开可连续应用'}</div>
    </DraggableDialog>
  );
}

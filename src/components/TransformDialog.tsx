// v209: 旋转/缩放独立窗口 (编辑菜单「旋转...」Ctrl+Shift+R /「缩放...」Ctrl+Shift+S)
// 功能复制自左侧栏 Inspector 变换面板 (左侧栏保留): 同一 store.originMode/customOrigin 原点设置,
// 同一 rotateSelected/scaleSelected 变换入口 (一次应用一次 undo)。窗口间角度/倍率各自独立记忆。
// v210: 新增对称模式 (编辑菜单「对称...」, 无快捷键) — 对称轴: 选区/中心(竖直或水平线)/自定义(两点决定直线,
// 画布上可拖拽两端点, 两点最小间距 4px 无法重合); 应用 = store.reflectSelected (一次 undo)。
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { store, useEditor, type TransformOrigin } from '@/osu/store';
import { rotateObjects, scaleObjects } from '@/osu/transform';
import { DraggableDialog, DraftNum, loadParams, useSaveParamsOnClose } from './DraggableDialog';

export function TransformDialog({ mode }: { mode: 'rotate' | 'scale' | 'symmetry' }) {
  useEditor();
  const [angle, setAngle] = useState(0); // v315: F17a — 默认角度 0 (原 90)
  const [factor, setFactor] = useState(1); // v315: F16 — 默认倍率 1 (原 1.1)
  const [factorY, setFactorY] = useState(1); // v282: 缩放支持仅X/仅Y (另一轴填 1)
  // v315: F16 — xy固定 重开窗口保持上次状态 (localStorage 持久化, 关窗落盘)
  const [lockRatio, setLockRatio] = useState(() => loadParams('tf-scale', { lockRatio: false }).lockRatio);
  useSaveParamsOnClose('tf-scale', { lockRatio });
  const originMode = store.originMode;
  const origin: TransformOrigin = store.currentOrigin();
  const selCount = store.selected.size;
  const title = mode === 'rotate' ? '旋转' : mode === 'scale' ? '缩放' : '对称';
  // v301: 实时预览 (F05a) — 首次改值后画布实时预览变换结果; 提交后回到已提交态, 关窗回滚到最后提交
  const previewOn = useRef(false);

  useEffect(() => {
    if (mode === 'symmetry') return;
    store.beginTransformPreview();
    return () => store.endTransformPreview();
  }, [mode]);

  // v315: F17c — 窗口开着时切换选区: 回滚旧选区未提交的预览, 以新选区为基准重开预览会话
  //   (否则新选物件不在 tfBackup 里, 预览会在其当前态上叠加变换 = "不能正確控制")
  //   v331: 回滚同步兜底已移 store.pushUndo (effect 运行前 beginDrag 会抢先快照预览态);
  //   此处 end 多为 no-op, 保留作双保险; 切换选区时角度/倍率归零 (用户反馈: 选其他物件角度不归零)
  const selKey = [...store.selected].sort((a, b) => a - b).join(',');
  const prevSelKey = useRef(selKey);
  useEffect(() => {
    if (mode === 'symmetry' || prevSelKey.current === selKey) return;
    prevSelKey.current = selKey;
    store.endTransformPreview();
    store.beginTransformPreview();
    previewOn.current = false;
    setAngle(0); setFactor(1); setFactorY(1); // v331
  }, [selKey, mode]);

  // 值/原点变化时刷新预览 (仅用户已改过值后; 开窗不自动变换)
  useEffect(() => {
    if (!previewOn.current || mode === 'symmetry') return;
    if (mode === 'rotate') store.previewTransform((objs, c) => rotateObjects(objs, c, angle), origin);
    else store.previewTransform((objs, c) => scaleObjects(objs, c, factor, factorY), origin);
  }, [angle, factor, factorY, originMode, mode, store.customOrigin.x, store.customOrigin.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeAngle = (v: number) => { previewOn.current = true; setAngle(v); };
  // v307: 比例固定时按改动前的 factor:factorY 联动另一轴 (x=y 时即等比缩放); 保留 4 位小数防长浮点尾
  const round4 = (v: number) => Math.round(v * 10000) / 10000;
  const changeFactor = (v: number) => {
    previewOn.current = true;
    if (lockRatio && factor !== 0) setFactorY(round4(v * factorY / factor));
    setFactor(v);
  };
  const changeFactorY = (v: number) => {
    previewOn.current = true;
    if (lockRatio && factorY !== 0) setFactor(round4(v * factor / factorY));
    setFactorY(v);
  };
  const commit = (fn: Parameters<typeof store.commitTransformPreview>[0]) => {
    store.commitTransformPreview(fn, origin);
    previewOn.current = false; // 提交后显示已提交态, 下次改值重新预览
  };

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
          <DraftNum value={angle} set={changeAngle} testid="angle" />
          <button onClick={() => commit((objs, c) => rotateObjects(objs, c, angle))} title="按输入角度旋转 (正=顺时针, 负=逆时针)" data-tf="apply-rotate"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            应用旋转
          </button>
          <button onClick={() => commit((objs, c) => rotateObjects(objs, c, -Math.abs(angle)))} title="按输入角度逆时针旋转"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCcw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />逆时针
          </button>
          <button onClick={() => commit((objs, c) => rotateObjects(objs, c, Math.abs(angle)))} title="按输入角度顺时针旋转"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />顺时针
          </button>
        </div>
      )}
      {mode === 'scale' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-white/50">倍率</span>
          <span className="text-white/40">x</span>
          <DraftNum value={factor} set={changeFactor} testid="factor" min={0.01} step={0.05} />
          <span className="text-white/40">y</span>
          <DraftNum value={factorY} set={changeFactorY} testid="factor-y" min={0.01} step={0.05} />
          <label className="flex items-center gap-0.5 text-white/70" title="固定 x:y 比例 — 改任一轴, 另一轴按当前比例联动">
            <input type="checkbox" checked={lockRatio} data-tf="lock-ratio" onChange={e => setLockRatio(e.target.checked)} />
            x:y 固定
          </label>
          <button onClick={() => commit((objs, c) => scaleObjects(objs, c, factor, factorY))} title="按输入倍率缩放 (仅X: y 填 1; 仅Y: x 填 1; 滑条长度同步)"
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
      <div className="text-white/35">{mode === 'symmetry' ? '画布虚线 = 当前对称轴预览; 每次应用一次撤销, 窗口保持打开可连续应用' : '改数值即时预览 (相对上次提交); 应用后窗口保持打开可连续应用, 每次应用一次撤销; 直接关窗回滚到最后提交'}</div>
    </DraggableDialog>
  );
}

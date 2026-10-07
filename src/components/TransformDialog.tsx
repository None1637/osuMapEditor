// v209: 旋转/缩放独立窗口 (编辑菜单「旋转...」Ctrl+Shift+R /「缩放...」Ctrl+Shift+S)
// 功能复制自左侧栏 Inspector 变换面板 (左侧栏保留): 同一 store.originMode/customOrigin 原点设置,
// 同一 rotateSelected/scaleSelected 变换入口 (一次应用一次 undo)。窗口间角度/倍率各自独立记忆。
// v210: 新增对称模式 (编辑菜单「对称...」, 无快捷键) — 对称轴: 选区/中心(竖直或水平线)/自定义(两点决定直线,
// 画布上可拖拽两端点, 两点最小间距 4px 无法重合); 应用 = store.reflectSelected (一次 undo)。
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { store, useEditor, type TransformOrigin } from '@/osu/store';
import { useT } from '@/i18n';
import { rotateObjects, scaleObjects } from '@/osu/transform';
import { DraggableDialog, DraftNum, loadParams, useSaveParamsOnClose } from './DraggableDialog';

export function TransformDialog({ mode }: { mode: 'rotate' | 'scale' | 'symmetry' }) {
  useEditor();
  const t = useT();
  const [angle, setAngle] = useState(0); // v315: F17a — 默认角度 0 (原 90)
  const [factor, setFactor] = useState(1); // v315: F16 — 默认倍率 1 (原 1.1)
  const [factorY, setFactorY] = useState(1); // v282: 缩放支持仅X/仅Y (另一轴填 1)
  // v315: F16 — xy固定 重开窗口保持上次状态 (localStorage 持久化, 关窗落盘)
  const [lockRatio, setLockRatio] = useState(() => loadParams('tf-scale', { lockRatio: false }).lockRatio);
  useSaveParamsOnClose('tf-scale', { lockRatio });
  const originMode = store.originMode;
  const origin: TransformOrigin = store.currentOrigin();
  // v360: 节点模式 (soulten: 多個滑條點也能快捷鍵縮放旋轉) — 有选中滑条锚点时窗口作用于锚点,
  //   原点恒 = 锚点包围盒中心 (F08 语义), 走 store 节点预览会话 (与物件版 v301 同构)
  const nodeMode = mode !== 'symmetry' && store.nodeSelectionCount > 0;
  const selCount = nodeMode ? store.nodeSelectionCount : store.selected.size;
  const title = mode === 'rotate' ? t('transform.rotate', 'Rotate') : mode === 'scale' ? t('transform.scale', 'Scale') : t('transform.symmetry', 'Symmetry');
  // v301: 实时预览 (F05a) — 首次改值后画布实时预览变换结果; 提交后回到已提交态, 关窗回滚到最后提交
  const previewOn = useRef(false);

  useEffect(() => {
    if (mode === 'symmetry') return;
    if (nodeMode) store.beginNodeTransformPreview(); else store.beginTransformPreview();
    return () => { if (nodeMode) store.endNodeTransformPreview(); else store.endTransformPreview(); };
  }, [mode, nodeMode]);

  // v315: F17c — 窗口开着时切换选区: 回滚旧选区未提交的预览, 以新选区为基准重开预览会话
  //   (否则新选物件不在 tfBackup 里, 预览会在其当前态上叠加变换 = "不能正確控制")
  //   v331: 回滚同步兜底已移 store.pushUndo (effect 运行前 beginDrag 会抢先快照预览态);
  //   此处 end 多为 no-op, 保留作双保险; 切换选区时角度/倍率归零 (用户反馈: 选其他物件角度不归零)
  //   v360: 节点模式监听节点选区 key
  const selKey = nodeMode
    ? [...store.selectedNodes].map(([id, s]) => id + ':' + [...s].sort((a, b) => a - b).join('.')).join(',')
    : [...store.selected].sort((a, b) => a - b).join(',');
  const prevSelKey = useRef(selKey);
  useEffect(() => {
    if (mode === 'symmetry' || prevSelKey.current === selKey) return;
    prevSelKey.current = selKey;
    if (nodeMode) { store.endNodeTransformPreview(); store.beginNodeTransformPreview(); }
    else { store.endTransformPreview(); store.beginTransformPreview(); }
    previewOn.current = false;
    setAngle(0); setFactor(1); setFactorY(1); // v331
  }, [selKey, mode, nodeMode]);

  // v360: 节点版变换公式 (与 store.rotateSelectedNodes 同款旋转; 缩放各轴独立)
  const rotatePt = (p: { x: number; y: number }, c: { x: number; y: number }, deg: number) => {
    const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
  };
  const scalePt = (p: { x: number; y: number }, c: { x: number; y: number }, sx: number, sy: number) =>
    ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy });

  // 值/原点变化时刷新预览 (仅用户已改过值后; 开窗不自动变换)
  useEffect(() => {
    if (!previewOn.current || mode === 'symmetry') return;
    if (nodeMode) {
      if (mode === 'rotate') store.previewNodeTransform((p, c) => rotatePt(p, c, angle));
      else store.previewNodeTransform((p, c) => scalePt(p, c, factor, factorY));
    } else if (mode === 'rotate') store.previewTransform((objs, c) => rotateObjects(objs, c, angle), origin);
    else store.previewTransform((objs, c) => scaleObjects(objs, c, factor, factorY), origin);
  }, [angle, factor, factorY, originMode, mode, nodeMode, store.customOrigin.x, store.customOrigin.y]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // v360: 节点版提交 (原点由 store 取锚点包围盒中心)
  const commitNode = (fn: (p: { x: number; y: number }, c: { x: number; y: number }) => { x: number; y: number }) => {
    store.commitNodeTransform(fn);
    previewOn.current = false;
  };

  return (
    <DraggableDialog title={t('transform.dialog_title', '{mode} ({n} selected)', { mode: title, n: selCount })}
      testid={mode === 'rotate' ? 'rotate-dlg' : mode === 'scale' ? 'scale-dlg' : 'symmetry-dlg'} width={340}
      onClose={() => store.closeTransformDialog()}>
      {mode !== 'symmetry' && !nodeMode && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/50">{t('transform.origin', 'Origin')}</span>
          {([['selection', t('transform.selection', 'Selection')], ['playfield', t('transform.center', 'Center')], ['custom', t('transform.custom', 'Custom')]] as const).map(([m, label]) => (
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
      {mode !== 'symmetry' && nodeMode && (
        <div className="text-white/45">{t('transform.node_mode_hint', 'Applying to selected slider anchors (origin = anchor bounding box center)')}</div>
      )}
      {mode === 'rotate' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-white/50">{t('transform.angle', 'Angle')}</span>
          <DraftNum value={angle} set={changeAngle} testid="angle" />
          <button onClick={() => nodeMode ? commitNode((p, c) => rotatePt(p, c, angle)) : commit((objs, c) => rotateObjects(objs, c, angle))} title={t('transform.apply_rotate_title', 'Rotate by the entered angle (positive = clockwise, negative = counter-clockwise)')} data-tf="apply-rotate"
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            {t('transform.apply_rotate', 'Apply Rotation')}
          </button>
          <button onClick={() => nodeMode ? commitNode((p, c) => rotatePt(p, c, -Math.abs(angle))) : commit((objs, c) => rotateObjects(objs, c, -Math.abs(angle)))} title={t('transform.ccw_title', 'Rotate counter-clockwise by the entered angle')}
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCcw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('transform.ccw', 'Counter-clockwise')}
          </button>
          <button onClick={() => nodeMode ? commitNode((p, c) => rotatePt(p, c, Math.abs(angle))) : commit((objs, c) => rotateObjects(objs, c, Math.abs(angle)))} title={t('transform.cw_title', 'Rotate clockwise by the entered angle')}
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            <RotateCw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('transform.cw', 'Clockwise')}
          </button>
        </div>
      )}
      {mode === 'scale' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-white/50">{t('transform.factor', 'Factor')}</span>
          <span className="text-white/40">x</span>
          <DraftNum value={factor} set={changeFactor} testid="factor" min={0.01} step={0.05} />
          <span className="text-white/40">y</span>
          <DraftNum value={factorY} set={changeFactorY} testid="factor-y" min={0.01} step={0.05} />
          <label className="flex items-center gap-0.5 text-white/70" title={t('transform.lock_ratio_title', 'Lock x:y ratio — changing one axis scales the other at the current ratio')}>
            <input type="checkbox" checked={lockRatio} data-tf="lock-ratio" onChange={e => setLockRatio(e.target.checked)} />
            {t('transform.lock_ratio', 'Lock x:y')}
          </label>
          <button onClick={() => nodeMode ? commitNode((p, c) => scalePt(p, c, factor, factorY)) : commit((objs, c) => scaleObjects(objs, c, factor, factorY))} title={t('transform.apply_scale_title', 'Scale by the entered factor (X only: set y to 1; Y only: set x to 1; slider length scales too)')}
            className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
            {t('transform.apply_scale', 'Apply Scale')}
          </button>
        </div>
      )}
      {mode === 'symmetry' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/50">{t('transform.sym_axis', 'Symmetry Axis')}</span>
            {([['selection', t('transform.selection', 'Selection')], ['center', t('transform.center', 'Center')], ['custom', t('transform.custom', 'Custom')]] as const).map(([m, label]) => (
              <label key={m} className="flex items-center gap-0.5 text-white/70">
                <input type="radio" name="tfdlg-sym" checked={store.symAxisMode === m} data-sym={`axis-${m}`}
                  onChange={() => store.setSymAxisMode(m)} />
                {label}
              </label>
            ))}
          </div>
          {store.symAxisMode !== 'custom' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/50">{t('transform.sym_direction', 'Direction')}</span>
              {([['v', t('transform.dir_vertical', 'Vertical line (mirror left-right)')], ['h', t('transform.dir_horizontal', 'Horizontal line (mirror up-down)')]] as const).map(([d, label]) => (
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
                <span className="text-white/50 w-8">{t('transform.point_1', 'Point 1')}</span>
                <DraftNum value={store.symP1.x} set={v => store.setSymPoint(1, { x: v, y: store.symP1.y })} testid="sym-p1x" />
                <DraftNum value={store.symP1.y} set={v => store.setSymPoint(1, { x: store.symP1.x, y: v })} testid="sym-p1y" />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-white/50 w-8">{t('transform.point_2', 'Point 2')}</span>
                <DraftNum value={store.symP2.x} set={v => store.setSymPoint(2, { x: v, y: store.symP2.y })} testid="sym-p2x" />
                <DraftNum value={store.symP2.y} set={v => store.setSymPoint(2, { x: store.symP2.x, y: v })} testid="sym-p2y" />
              </div>
              <div className="text-white/35">{t('transform.custom_axis_hint', 'Symmetry axis = the line through the two points; drag the two purple endpoints directly on the playfield (points cannot overlap)')}</div>
            </div>
          )}
          <div>
            <button onClick={() => store.reflectSelected()} title={t('transform.apply_symmetry_title', 'Mirror the selection across the symmetry axis')}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
              {t('transform.apply_symmetry', 'Apply Symmetry')}
            </button>
          </div>
        </>
      )}
      <div className="text-white/35">{mode === 'symmetry' ? t('transform.sym_footer_hint', 'Dashed canvas line = preview of the current symmetry axis; each apply is one undo step, the window stays open for repeated applies') : t('transform.footer_hint', 'Changing values previews instantly (relative to the last commit); the window stays open after apply for repeated applies, each apply is one undo step; closing directly rolls back to the last commit')}</div>
    </DraggableDialog>
  );
}

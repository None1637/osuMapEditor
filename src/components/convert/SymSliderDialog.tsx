// v236: 对称滑条弹窗 — 恰好选中 1 个滑条时, 把全部节点做 轴对称/中心对称/中心旋转 n 次/方向平移 n 次,
//   拼到原滑条头/尾或生成独立副本 (computeSymSlider 纯函数, 本文件只管参数面板 + 预览/应用接线)。
// 预览响应节点实时编辑: 节点拖拽是就地改对象 (commitDrag 只 emit 不换 bm/物件引用, store.ts:1112),
//   故 useMemo 依赖里加节点内容签名 sig — 签名不变则 result 引用稳定,
//   setConversionPreview 引发的 emitSelection 重渲染不会触发重算 (避免无限循环, DuplicateDialog 同款思路)。
// 二轮修正: 轴对称配置简化为一行三选 (axisDir: v = 过拼接锚点的竖直线 / h = 水平线 / custom = 自定义两点);
//   point 中心对称无额外参数行 (中心 = 拼接锚点); 锚点行只在 rotate/translate 显示。
// 修正3: rotate/translate 且 anchor='custom' 时, 画布显示可拖动的自定义锚点圈
//   (store.symSliderAnchorView/symSliderAnchorDragHandler, v68 dupVector 箭头同款接线; 拖拽回写 1 位小数)。
// 二轮修正: axis 且 axisDir='custom' 时, 画布显示可拖动的对称轴两点 + 紫色虚线
//   (store.symSliderAxisView/symSliderAxisDragHandler, v210 对称轴同款接线; 拖拽回写 1 位小数)。
import { useEffect, useMemo, useState } from 'react';
import { store, useEditor } from '@/osu/store';
import { DraggableDialog, DraftNum, loadParams, saveParams } from '../DraggableDialog';
import { computeSymSlider, DEFAULT_SYM_SLIDER_PARAMS, type SymSliderMode, type SymSliderParams } from '@/osu/convert/symSlider';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-white/50">{label}</span>
    {children}
  </div>
);

export function SymSliderDialog() {
  useEditor();
  // v236 二轮修正: 参数集换代 (轴配置简化为 axisDir 三选 v/h/custom); loadParams 浅合并,
  //   旧持久化数据缺新字段时回退默认值 (多余的旧键残留无害, 下次保存即清)
  const [params, setParams] = useState<SymSliderParams>(() => loadParams('symSlider', DEFAULT_SYM_SLIDER_PARAMS));
  const bm = store.beatmap;
  // 恰好选中 1 个滑条才有意义; 打开后选中漂移则提示并禁用应用 (不强制关窗)
  const obj = useMemo(() => {
    if (!bm || store.selected.size !== 1) return null;
    const o = bm.hitObjects.find(x => store.selected.has(x.id));
    return o && o.type === 'slider' ? o : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm, store.selected, store.conversionDialog]);
  // v236: 节点内容签名 (computeSymSlider 读取的全部字段) — 节点就地编辑后签名变 -> result 重算 -> 预览跟着变
  const sig = obj
    ? [obj.x, obj.y, obj.curveType, obj.length, obj.slides, obj.time, obj.endTime ?? '',
      ...(obj.curvePoints ?? []).map(p => `${p.x},${p.y}`)].join('|')
    : '';
  const result = useMemo(
    () => (bm && obj ? computeSymSlider(bm, obj, params) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bm, obj, params, sig],
  );
  useEffect(() => {
    // v236: 无论拼接还是副本模式都隐藏原滑条, 预览只显示结果
    store.setConversionPreview(obj && result.length ? { hideIds: [obj.id], objects: result } : null);
    return () => store.setConversionPreview(null);
  }, [result, obj]);
  // v236 修正3: 自定义锚点圈视图 — 仅 rotate/translate 且 anchor='custom' 时显示 (画布每帧读取, 非响应式)
  const anchorActive = (params.mode === 'rotate' || params.mode === 'translate') && params.anchor === 'custom';
  useEffect(() => {
    store.symSliderAnchorView = anchorActive ? { x: params.customX, y: params.customY } : null;
  }, [anchorActive, params.customX, params.customY]);
  useEffect(() => {
    store.symSliderAnchorDragHandler = (x, y) => setParams(p => ({
      ...p, customX: Math.round(x * 10) / 10, customY: Math.round(y * 10) / 10, // v236: 与 dup 向量拖拽同款 1 位小数
    }));
    return () => { store.symSliderAnchorDragHandler = null; store.symSliderAnchorView = null; };
  }, []);
  // v236 二轮修正: 自定义对称轴视图 — 仅 axis 且 axisDir='custom' 时显示 (v210 对称轴两点同款, 画布可拖拽)
  const axisActive = params.mode === 'axis' && params.axisDir === 'custom';
  useEffect(() => {
    store.symSliderAxisView = axisActive ? { p1: { ...params.axisP1 }, p2: { ...params.axisP2 } } : null;
  }, [axisActive, params.axisP1, params.axisP2]);
  useEffect(() => {
    store.symSliderAxisDragHandler = (which, x, y) => setParams(p => {
      const q = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }; // v236: 与锚点圈拖拽同款 1 位小数
      return which === 1 ? { ...p, axisP1: q } : { ...p, axisP2: q };
    });
    return () => { store.symSliderAxisDragHandler = null; store.symSliderAxisView = null; };
  }, []);

  if (!bm) return null;
  const upd = (patch: Partial<SymSliderParams>) => setParams(p => ({ ...p, ...patch }));
  const isAxisLike = params.mode === 'axis' || params.mode === 'point';
  const copyCount = isAxisLike ? 1 : params.count;
  const joinedNodes = params.join !== 'none' && result.length ? (result[0].curvePoints?.length ?? 0) + 1 : 0;

  return (
    <DraggableDialog title="对称滑条" testid="symSlider" width={340} onClose={() => store.closeConversion()}>
      <Row label="模式">
        {([['axis', '轴对称'], ['point', '中心对称'], ['rotate', '中心旋转'], ['translate', '方向平移']] as [SymSliderMode, string][]).map(([m, label]) => (
          <label key={m} className="flex items-center gap-0.5">
            <input type="radio" name="sym-mode" checked={params.mode === m} data-conv={`mode-${m}`}
              onChange={() => upd({ mode: m })} />
            {label}
          </label>
        ))}
      </Row>
      <Row label="拼接">
        {([['tail', '拼到尾部'], ['head', '拼到头部'], ['none', '独立副本']] as const).map(([j, label]) => (
          <label key={j} className="flex items-center gap-0.5">
            <input type="radio" name="sym-join" checked={params.join === j} data-conv={`join-${j}`}
              onChange={() => upd({ join: j })} />
            {label}
          </label>
        ))}
      </Row>
      {!isAxisLike && (
        <Row label="份数">
          <DraftNum value={params.count} testid="count" min={1} max={99} set={v => upd({ count: Math.round(v) })} />
          <span className="text-white/40">轴/中心对称恒 1 份</span>
        </Row>
      )}
      {/* v236 二轮修正: 轴对称配置一行三选 — v/h 轴过拼接锚点 (仅方向有效), custom = 两点直线 (画布可拖) */}
      {params.mode === 'axis' && <>
        <Row label="对称轴">
          {([['v', '竖直线'], ['h', '水平线'], ['custom', '自定义']] as const).map(([d, label]) => (
            <label key={d} className="flex items-center gap-0.5">
              <input type="radio" name="sym-axis-dir" checked={params.axisDir === d} data-conv={`dir-${d}`}
                onChange={() => upd({ axisDir: d })} />
              {label}
            </label>
          ))}
        </Row>
        {params.axisDir === 'custom' ? (<>
          <Row label="轴点 1">
            <DraftNum value={params.axisP1.x} testid="axisP1x" set={v => upd({ axisP1: { ...params.axisP1, x: v } })} />
            <DraftNum value={params.axisP1.y} testid="axisP1y" set={v => upd({ axisP1: { ...params.axisP1, y: v } })} />
          </Row>
          <Row label="轴点 2">
            <DraftNum value={params.axisP2.x} testid="axisP2x" set={v => upd({ axisP2: { ...params.axisP2, x: v } })} />
            <DraftNum value={params.axisP2.y} testid="axisP2y" set={v => upd({ axisP2: { ...params.axisP2, y: v } })} />
            <span className="text-white/40">两点决定的直线, 画布可拖拽</span>
          </Row>
        </>) : (
          <div className="text-white/40">轴过拼接点 (拼尾=滑条尾, 拼头=滑条头, 副本=滑条尾)</div>
        )}
      </>}
      {params.mode === 'rotate' && (
        <Row label="旋转 °/份">
          <DraftNum value={params.rotateDeg} testid="rotateDeg" min={-360} max={360}
            set={v => upd({ rotateDeg: v })} />
          <span className="text-white/40">顺时针为正</span>
        </Row>
      )}
      {params.mode === 'translate' && <>
        <Row label="向量/份">
          <DraftNum value={params.dx} testid="dx" min={-512} max={512} set={v => upd({ dx: v })} />
          <DraftNum value={params.dy} testid="dy" min={-512} max={512} set={v => upd({ dy: v })} />
          <span className="text-white/40">dx, dy px</span>
        </Row>
        <Row label="增量/份">
          <DraftNum value={params.ddx} testid="ddx" min={-512} max={512} set={v => upd({ ddx: v })} />
          <DraftNum value={params.ddy} testid="ddy" min={-512} max={512} set={v => upd({ ddy: v })} />
          <span className="text-white/40">第 i 份 = i×向量 + i(i-1)/2×增量</span>
        </Row>
      </>}
      {/* v236 二轮修正: 锚点行只在 rotate/translate 显示 (axis/point 恒用拼接锚点, 无参数行);
          point = 无锚点, rotate = 旋转中心, translate = 缩放锚点 */}
      {(params.mode === 'rotate' || params.mode === 'translate') && (
        <Row label="锚点">
          {([['tail', '滑条尾'], ['head', '滑条头'], ['custom', '自定义']] as const).map(([a, label]) => (
            <label key={a} className="flex items-center gap-0.5">
              <input type="radio" name="sym-anchor" checked={params.anchor === a} data-conv={`anchor-${a}`}
                onChange={() => upd({ anchor: a })} />
              {label}
            </label>
          ))}
        </Row>
      )}
      {anchorActive && (
        <Row label="锚点坐标">
          <DraftNum value={params.customX} testid="customX" min={-1024} max={1024} set={v => upd({ customX: v })} />
          <DraftNum value={params.customY} testid="customY" min={-1024} max={1024} set={v => upd({ customY: v })} />
          <span className="text-white/40">画布上可拖拽</span>
        </Row>
      )}
      {/* v236: 每份递增缩放 (v116 同款语义) — 第 i 份变换后绕缩放锚点 (axis/point = 拼接锚点) 再缩放 1 + i×此值 */}
      <Row label="缩放/份">
        <DraftNum value={params.scalePerCopy} testid="scalePerCopy" min={-0.99} max={5} step={0.05}
          set={v => upd({ scalePerCopy: v })} />
        <span className="text-white/40">第 i 份 = 1 + i×此值 (绕锚点)</span>
      </Row>
      <div className="text-white/40">
        {params.join === 'none'
          ? `将生成 ${copyCount} 个独立副本 (原滑条保留, 预览已隐藏)`
          : `将拼接为 1 条滑条 (${joinedNodes} 个节点, ${params.join === 'tail' ? '拼到尾部, endTime 延长' : '拼到头部, time 提前'}, 替换原滑条)`}
      </div>
      {!obj && <div className="text-red-300">需要恰好选中 1 个滑条 (当前选中变化, 请重新选择)</div>}
      {result.length === 0 && obj && params.mode === 'axis' && params.axisDir === 'custom'
        && <div className="text-red-300">自定义对称轴两点重合, 无法镜像</div>}
      <div className="flex gap-2 pt-1">
        <button data-conv="apply"
          onClick={() => {
            if (!obj || !result.length) return;
            saveParams('symSlider', params);
            // v236: 独立副本 = 保留原滑条纯新增; 拼接 = 替换原滑条 (均一次 undo)
            store.applyConversion(params.join === 'none' ? [] : [obj.id], result);
          }}
          disabled={!obj || !result.length}
          className="px-3 py-1 rounded bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white font-bold">
          应用
        </button>
        <button onClick={() => store.closeConversion()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">取消</button>
      </div>
    </DraggableDialog>
  );
}

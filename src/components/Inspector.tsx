import { useState } from 'react';
import { RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2 } from 'lucide-react'; // v181: ↺/↻/⇋/⇅ → lucide
import { store, useEditor, type TransformOrigin } from '@/osu/store';
import { invalidatePath } from '@/osu/renderer';
import { parseHitSample, hitSampleFilename } from '@/osu/clock/hitSounds';
import { computeMerge } from '@/osu/convert/merge';
import { sliderToBezierSegments, segmentsToPoints } from '@/osu/convert/bezierPath';
import { genId, type HitObject } from '@/osu/parser';
import { parseBSplineType } from '@/osu/sliderPath'; // v387: B<n> (B 样条) curveType 识别
import { hotkeyLabel } from '@/osu/hotkeys'; // v321 (F21): 快捷键提示随改键同步
import { useT } from '@/i18n';
import { Btn } from './Btn'; // v425: 统一按钮组件 (normal/primary/danger)
import { UiControl, UiIcon, UiText } from './uiLayout/UiControl'; // v530

// 选中物件属性编辑

// v146: NumIn 提升为模块顶层组件 — 原定义为 Inspector 内部组件, 每次重渲染生成新组件类型,
// React 卸载重建子树导致输入框失焦 ("全选输入一个数字就失焦"); 顶层组件类型稳定, DOM 保留
// v425: 手写 Btn 移到 ./Btn 组件 (同理模块级稳定); 本文件三处手写按钮样式 (模块级 Btn / 转换区 cls / 删除按钮) 全部统一
// v146: 局部文本态 (与 App.tsx GridSpacingInput 同款模式): 输入过程中不用数值覆盖文本
// (可全选重输/输小数点/负号), 合法值实时提交, 失焦还原为已提交值
// v426: 宽度默认 flex-1 min-w-0 — 容器 flex 时吸收剩余宽度 (原固定 w-16/w-14 在窄栏下把行顶爆)
const NUM_IN_IDS: Record<string, string> = {
  'custom-x': 'origin-x', 'custom-y': 'origin-y', angle: 'rotate-angle', factor: 'scale-x', 'factor-y': 'scale-y',
};
const NumIn = ({ value, set, w = 'flex-1 min-w-0', testid }: { value: number; set: (v: number) => void; w?: string; testid: string }) => {
  const [text, setText] = useState<string | null>(null);
  return (
    <UiControl id={`inspector.${NUM_IN_IDS[testid]}`}><input type="number" step="any" data-tf={testid}
      value={text ?? String(value)}
      onChange={e => { setText(e.target.value); const v = parseFloat(e.target.value); if (isFinite(v)) set(v); }}
      onBlur={() => setText(null)}
      className={`${w} h-7 bg-black/40 border border-white/15 rounded px-1 text-white`} /></UiControl> // v425: h-7 与 Btn 等高对齐 (原 py-0.5 矮一截)
  );
};

// v530: 模块级稳定组件, 避免每次 Inspector 重渲染都重建输入框
const Num = ({ id, label, value, onChange, step = 1 }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number }) => (
  <label className="flex items-center gap-1 text-xs text-white/70">
    <span className="w-14">{label}</span>
    <UiControl id={`inspector.${id}`}><input type="number" step={step} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" /></UiControl>
  </label>
);

export function Inspector() {
  useEditor();
  const t = useT();
  // v33: 变换面板状态 (任意角度/倍率 + 三种原点); v34: 原点模式/自定义点提升到 store (画布标记渲染+拖拽共用)
  const [angle, setAngle] = useState(90);
  const [factor, setFactor] = useState(1.1);
  const [factorY, setFactorY] = useState(1.1); // v282: 缩放支持仅X/仅Y (另一轴填 1)
  const originMode = store.originMode;
  const customX = store.customOrigin.x;
  const customY = store.customOrigin.y;
  const bm = store.beatmap;
  if (!bm) return null;
  const sel = bm.hitObjects.filter(o => store.selected.has(o.id));

  const origin: TransformOrigin = store.currentOrigin();

  // v234: 右侧栏提示区 — 原画布内的 Alt 滑条节点控制提示 (v117) 移到此处; 并附游玩区平移操作说明 (v227/v229)
  const hints: string[] = [];
  if (store.tool === 'select' && !store.playing && !store.nodeSelectionCount && sel.some(o => o.type === 'slider')) {
    hints.push(t('inspector.hint_slider_node_control', 'Slider node control: Alt+click/box select, Shift+Alt multi-select; while holding Alt you can drag / rotate / scale the whole selection (Esc to exit)'));
  }
  if (store.playfieldPanEnabled) {
    hints.push(t('inspector.hint_playfield_pan', 'Playfield panning enabled: hold the middle mouse button to drag the playfield, Alt+wheel to zoom the playfield'));
  }
  const HintsBlock = hints.length > 0 && (
    <div className="space-y-1 border-t border-white/10 pt-2 mt-2 text-white/40 leading-relaxed">
      {hints.map((h, i) => <div key={i}>{h}</div>)}
    </div>
  );

  // 选区几何变换 (任意角度旋转/任意倍率缩放/镜像; 原点: 选区/中心/自定义 — lazer origin 参数语义)
  // v146: 以普通函数调用渲染 ({TransformPanel()}), 不作为 JSX 组件 — 否则每次重渲染新组件类型, 子树重建失焦
  // v426: 旋转/缩放/镜像三行布局韧性 — label+输入框占一行 (输入框 flex-1), 按钮独占下一行
  // (旋转/镜像 grid grid-cols-2, 缩放单按钮 w-full), 不再 flex-wrap 混排互相挤压
  // v427: 旋转按钮文本只留 Rotate, 方向靠 RotateCcw/RotateCw 图标表达, 完整文案进 title tooltip;
  // 镜像按钮砍 ({key}) 修饰 (hotkey 挪进 tooltip, 仍随 v321 改键同步; 快捷键 hint 行也有), 半宽按钮不再溢出
  const TransformPanel = () => (
    <div className="space-y-1.5">
      <div className="font-bold text-white/60">{t('inspector.transform_title', 'Transform (Selection)')}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white/50 whitespace-nowrap">{t('inspector.origin', 'Origin')}</span>
        {([['selection', 'inspector.origin_selection', 'Selection'], ['playfield', 'inspector.origin_playfield', 'Center'], ['custom', 'inspector.origin_custom', 'Custom']] as const).map(([m, textKey, label]) => (
          <label key={m} className="flex items-center gap-0.5 text-white/70 whitespace-nowrap">
            <UiControl id={`inspector.origin-${m}`}><input type="radio" name="tf-origin" checked={originMode === m} data-tf={`origin-${m}`}
              onChange={() => store.setOriginMode(m)} /></UiControl>
            <UiText id={`inspector.origin-${m}`} textKey={textKey}>{label}</UiText>
          </label>
        ))}
        {originMode === 'custom' && (
          <span className="flex items-center gap-1 w-full">
            <NumIn value={customX} set={v => store.setCustomOrigin({ x: v, y: store.customOrigin.y })} testid="custom-x" />
            <NumIn value={customY} set={v => store.setCustomOrigin({ x: store.customOrigin.x, y: v })} testid="custom-y" />
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-white/50 whitespace-nowrap">{t('inspector.rotate', 'Rotate')}</span>
          <NumIn value={angle} set={setAngle} testid="angle" />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <UiControl id="inspector.rotate-ccw"><Btn className="w-full" title={t('inspector.rotate_ccw_tip', 'Rotate 90° counterclockwise')} onClick={() => store.rotateSelected(-Math.abs(angle), origin)}>
            <UiIcon id="inspector.rotate-ccw"><RotateCcw className="w-3.5 h-3.5" /></UiIcon><UiText id="inspector.rotate-ccw" textKey="inspector.rotate_ccw">Rotate</UiText>
          </Btn></UiControl>
          <UiControl id="inspector.rotate-cw"><Btn className="w-full" title={t('inspector.rotate_cw_tip', 'Rotate 90° clockwise')} onClick={() => store.rotateSelected(Math.abs(angle), origin)}>
            <UiIcon id="inspector.rotate-cw"><RotateCw className="w-3.5 h-3.5" /></UiIcon><UiText id="inspector.rotate-cw" textKey="inspector.rotate_cw">Rotate</UiText>
          </Btn></UiControl>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-white/50 whitespace-nowrap">{t('inspector.scale', 'Scale')}</span>
          <span className="text-white/40">x</span>
          <NumIn value={factor} set={setFactor} testid="factor" />
          <span className="text-white/40">y</span>
          <NumIn value={factorY} set={setFactorY} testid="factor-y" />
        </div>
        <UiControl id="inspector.scale-apply"><Btn className="w-full" title={t('inspector.apply_scale_tip', 'Scale by the entered factors (X only: set y to 1; Y only: set x to 1; slider length scales too)')} onClick={() => store.scaleSelected(factor, factorY, origin)}>
          <UiText id="inspector.scale-apply" textKey="inspector.apply_scale">Apply Factor</UiText>
        </Btn></UiControl>
      </div>
      <div className="space-y-1">
        <span className="text-white/50 whitespace-nowrap">{t('inspector.flip', 'Flip')}</span>
        <div className="grid grid-cols-2 gap-1">
          <UiControl id="inspector.flip-h"><Btn className="w-full" title={t('inspector.flip_h_tip', 'Flip horizontally ({key})', { key: hotkeyLabel('flip-h') })} onClick={() => store.flipSelected('h', origin)}>
            <UiIcon id="inspector.flip-h"><FlipHorizontal2 className="w-3.5 h-3.5" /></UiIcon><UiText id="inspector.flip-h" textKey="inspector.flip_h">Horizontal</UiText>
          </Btn></UiControl>
          <UiControl id="inspector.flip-v"><Btn className="w-full" title={t('inspector.flip_v_tip', 'Flip vertically ({key})', { key: hotkeyLabel('flip-v') })} onClick={() => store.flipSelected('v', origin)}>
            <UiIcon id="inspector.flip-v"><FlipVertical2 className="w-3.5 h-3.5" /></UiIcon><UiText id="inspector.flip-v" textKey="inspector.flip_v">Vertical</UiText>
          </Btn></UiControl>
        </div>
      </div>
      <div className="text-white/35">{t('inspector.transform_hotkeys_hint', 'Hotkeys {ccw}/{cw} rotate 90°, {flipH}/{flipV} flip around the playfield center (same as stable); the buttons above use the selected origin; {reverse} reverses (same as lazer)', { ccw: hotkeyLabel('rot-ccw'), cw: hotkeyLabel('rot-cw'), flipH: hotkeyLabel('flip-h'), flipV: hotkeyLabel('flip-v'), reverse: hotkeyLabel('reverse') })}</div>
    </div>
  );

  // hitsound 区块 (单选/多选批量; 多选值不同显示混合态, 修改统一应用到全部选中物件)
  const HitSoundPanel = ({ objs }: { objs: HitObject[] }) => {
    const hasBit = (bit: number) => objs.every(o => ((o.hitSound ?? 0) & bit) !== 0);
    const BitChk = ({ bit, label, title }: { bit: number; label: 'Whistle' | 'Finish' | 'Clap'; title: string }) => {
      const id = `inspector.hitsound-${label.toLowerCase()}`;
      return <label className="flex items-center gap-1 text-white/70" title={title}>
        <UiControl id={id}><input type="checkbox" checked={hasBit(bit)} data-hs={label}
          onChange={e => store.setSelectedHitSoundBit(bit, e.target.checked)} /></UiControl>
        <UiText id={id} textKey={`app.hs_${label.toLowerCase()}`}>{label}</UiText>
      </label>;
    };
    // 多选时取公共值; 不同则 undefined (显示混合态)
    const common = <T,>(get: (o: HitObject) => T): T | undefined =>
      objs.every(o => get(o) === get(objs[0])) ? get(objs[0]) : undefined;
    const samples = objs.map(o => parseHitSample(o.hitSampleRaw));
    const commonSample = <K extends keyof (typeof samples)[0]>(k: K) =>
      samples.every(s => s[k] === samples[0][k]) ? samples[0][k] : undefined;
    const SetSel = ({ label, field, testid }: { label: string; field: 'normalSet' | 'additionSet'; testid: 'normalSet' | 'additionSet' }) => {
      const v = commonSample(field);
      const id = testid === 'normalSet' ? 'inspector.normal-set' : 'inspector.addition-set';
      return (
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{label}</span>
          <UiControl id={id}><select value={v === undefined ? '' : String(v)} data-hs={testid}
            onChange={e => { if (e.target.value !== '') store.applyHitSampleToSelected({ [field]: parseInt(e.target.value) }); }}
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            {v === undefined && <option value="">{t('inspector.mixed', 'Mixed')}</option>}
            <option value="0">{t('inspector.auto_inherit', 'Auto / Inherit')}</option>
            <option value="1">Normal</option>
            <option value="2">Soft</option>
            <option value="3">Drum</option>
          </select></UiControl>
        </label>
      );
    };
    const SampleNum = ({ label, field, testid, clamp }: { label: string; field: 'customIndex' | 'volume'; testid: 'customIndex' | 'volume'; clamp: (v: number) => number }) => {
      const v = commonSample(field);
      return (
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{label}</span>
          <UiControl id={testid === 'customIndex' ? 'inspector.sample-index' : 'inspector.volume'}><input type="number" value={v === undefined ? '' : v} placeholder={t('inspector.mixed', 'Mixed')} data-hs={testid}
            onChange={e => { if (e.target.value !== '') store.applyHitSampleToSelected({ [field]: clamp(parseInt(e.target.value) || 0) }); }}
            className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" /></UiControl>
        </label>
      );
    };
    const filename = common(o => hitSampleFilename(o.hitSampleRaw) ?? '');
    return (
      <div className="space-y-1 border-t border-white/10 pt-2">
        <div className="font-bold text-white/60">Hitsound (Q/W/E/R)</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <BitChk bit={2} label="Whistle" title={t('inspector.whistle_tip', 'Whistle sound (W)')} />
          <BitChk bit={4} label="Finish" title={t('inspector.finish_tip', 'Finish sound (E)')} />
          <BitChk bit={8} label="Clap" title={t('inspector.clap_tip', 'Clap sound (R)')} />
        </div>
        <SetSel label="NormalSet" field="normalSet" testid="normalSet" />
        <SetSel label="AddSet" field="additionSet" testid="additionSet" />
        <SampleNum label={t('inspector.sample_index', 'Sample Index')} field="customIndex" testid="customIndex" clamp={v => Math.max(0, Math.round(v))} />
        <SampleNum label={t('inspector.volume', 'Volume')} field="volume" testid="volume" clamp={v => v <= 0 ? 0 : Math.min(100, Math.max(5, Math.round(v)))} />
        {filename ? <div className="text-white/40">{t('inspector.sample_file', 'Sample File: {filename}', { filename })}</div> : null}
      </div>
    );
  };

  // F1/F4 滑条转换按钮组: 转连打 + 圆弧转贝塞尔 (单选滑条与多选共用; 只动对应类型的滑条, 其他物件不进 removeIds)
  // v141: 废弃 卡特姆→贝塞尔 / 贝塞尔→卡特姆 (用不到), 新增 三点圆弧→贝塞尔
  const SliderConvertButtons = ({ sliders }: { sliders: HitObject[] }) => {
    const selP = sliders.filter(o => o.curveType === 'P');
    const selB4 = sliders.filter(o => parseBSplineType(o.curveType) !== null); // v388: 选中集内 B 样条
    const selBez = sliders.filter(o => o.curveType === 'B'); // v464: 选中集内贝塞尔 (反向转 B4)
    // P->B: 三点圆弧转三次贝塞尔近似 (circleToBezier, 90° 内误差 <0.03%), 无参数不弹窗, 点击直接应用 (一次 undo)
    const onP2B = () => {
      const out = selP.map((o): HitObject | null => {
        const segs = sliderToBezierSegments(o);
        if (!segs.length) return null;
        const pts = segmentsToPoints(segs); // 含头部 = 首段首点; 段接缝重复点 (红锚点)
        return { ...o, id: genId(), curveType: 'B', curvePoints: pts.slice(1) };
      }).filter((o): o is HitObject => !!o);
      if (out.length) store.applyConversion(selP.map(o => o.id), out);
    };
    // v425: cls 手写按钮样式废弃, 统一 Btn 组件; data-conv-* 钩子原样保留 (CDP 验证器依赖)
    // v429: 按钮文本不再带快捷键后缀 (stream/polygon/delete), 快捷键挪进 title tooltip (= 功能详情 + hotkeyLabel,
    // 仍随 v321 改键同步) — 与 v427 旋转/镜像同一模式; 文案缩短后整行按钮不再溢出
    return (
      <>
        {sliders.length > 0 && (
          <UiControl id="inspector.stream"><Btn data-conv-open="stream" onClick={() => store.openConversion('stream')} title={t('inspector.stream_tip', 'Convert sliders to a circle stream ({key})', { key: hotkeyLabel('stream') })}>
            <UiText id="inspector.stream" textKey="inspector.sliders_to_stream" vars={{ n: sliders.length }}>Sliders to Stream ({'{n}'})</UiText>
          </Btn></UiControl>
        )}
        {selP.length > 0 && (
          <UiControl id="inspector.arc-bezier"><Btn data-conv-apply="p2b" onClick={onP2B}>
            <UiText id="inspector.arc-bezier" textKey="inspector.arc_to_bezier" vars={{ n: selP.length }}>Arc → Bezier ({'{n}'})</UiText>
          </Btn></UiControl>
        )}
        {/* v388: 选中集含 B 样条 (B4) 时一键转贝塞尔 (stable 兼容; 原地改不换 id, 一次 undo) */}
        {selB4.length > 0 && (
          <UiControl id="inspector.bspline-bezier"><Btn data-conv-apply="b4toB" onClick={() => store.convertSelectedBSplineSliders()}>
            <UiText id="inspector.bspline-bezier" textKey="inspector.bspline_to_bezier" vars={{ n: selB4.length }}>B-Spline → Bezier ({'{n}'})</UiText>
          </Btn></UiControl>
        )}
        {/* v464: 反向 — 选中集含贝塞尔 ('B') 时一键转 B4 (原地改不换 id, 一次 undo) */}
        {selBez.length > 0 && (
          <UiControl id="inspector.bezier-bspline"><Btn data-conv-apply="btoB4" onClick={() => store.convertSelectedBezierSlidersToB4()}>
            <UiText id="inspector.bezier-bspline" textKey="inspector.bezier_to_bspline" vars={{ n: selBez.length }}>Bezier → B4 ({'{n}'})</UiText>
          </Btn></UiControl>
        )}
      </>
    );
  };

  if (sel.length !== 1) {
    const selSliders = sel.filter(o => o.type === 'slider');
    // F3: 合并为滑条 — 无参数不弹窗, 点击直接应用 (一次 undo); 不满足条件 (重合/<2) 时 computeMerge 返回 null 不动作
    const onMerge = () => {
      const slider = computeMerge(bm, sel, store.beatSnap);
      if (slider) store.applyConversion(sel.map(o => o.id), [slider]);
    };
    return (
      <div className="p-3 text-xs text-white/50 space-y-3">
        <div>{sel.length > 1 ? t('inspector.selected_n', '{n} objects selected', { n: sel.length }) : t('inspector.no_selection', 'No object selected')}</div>
        {sel.length > 1 && <HitSoundPanel objs={sel} />}
        {sel.length > 1 && TransformPanel()}
        {sel.length > 1 && (
          <div className="space-y-1.5 border-t border-white/10 pt-2">
            <div className="font-bold text-white/60">{t('inspector.convert_title', 'Convert')}</div>
            {/* v426: 转换按钮每枚整行 (flex-col 拉伸), 不再多枚挤一行 flex-wrap */}
            <div className="flex flex-col gap-1">
              <SliderConvertButtons sliders={selSliders} />
              <UiControl id="inspector.merge"><Btn data-conv-apply="merge" onClick={onMerge}>
                <UiText id="inspector.merge" textKey="inspector.merge_to_slider">Merge into Slider</UiText>
              </Btn></UiControl>
              {/* v409: 在选中锚点处分割 (多选时同样可用 — 各滑条按各自节点选区分割) */}
              {store.nodeSelectionCount > 0 && (
                <UiControl id="inspector.split-anchors"><Btn data-conv-apply="split-anchors" onClick={() => store.splitSelectedSliderNodes()}>
                  <UiText id="inspector.split-anchors" textKey="inspector.split_at_anchors">Split at Anchors</UiText>
                </Btn></UiControl>
              )}
            </div>
          </div>
        )}
        {/* v64/v65: 多边形生成 (无需选区; Ctrl+Shift+D) + 批量复制 (需选区) */}
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          <div className="font-bold text-white/60">{t('inspector.generate_title', 'Generate')}</div>
          <div className="flex flex-col gap-1">
            <UiControl id="inspector.polygon"><Btn data-conv-open="polygon" onClick={() => store.openConversion('polygon')} title={t('inspector.polygon_tip', 'Generate a polygon of circles ({key})', { key: hotkeyLabel('polygon') })}>
              <UiText id="inspector.polygon" textKey="inspector.polygon_generate">Polygon Generator</UiText>
            </Btn></UiControl>
            <UiControl id="inspector.duplicate"><Btn data-conv-open="duplicate" onClick={() => store.openConversion('duplicate')}
              disabled={!sel.length}>
              <UiText id="inspector.duplicate" textKey={sel.length ? 'inspector.duplicate_count' : 'inspector.duplicate'} vars={{ n: sel.length }}>{sel.length ? 'Duplicate ({n})' : 'Duplicate'}</UiText>
            </Btn></UiControl>
          </div>
        </div>
        {HintsBlock}
      </div>
    );
  }
  const o = sel[0];
  // v387: 当前为 'B<n>' 时下拉按原 degree 显示, 否则提供固定 'B4' 选项
  const bSplineOption = parseBSplineType(o.curveType) !== null && o.curveType ? o.curveType : 'B4';
  const upd = (patch: Partial<typeof o>) => {
    if (store.lockNotes) return; // v115: 锁定物件 — Inspector 数值/下拉编辑禁用
    store.pushUndo();
    Object.assign(o, patch);
    if (o.type === 'slider') invalidatePath(o.id);
    store.commitDrag();
  };

  return (
    <div className="p-3 space-y-1.5 text-xs">
      <div className="font-bold text-white/90 mb-2">
        {o.type === 'circle' ? t('inspector.type_circle', 'Hit Circle') : o.type === 'slider' ? t('inspector.type_slider', 'Slider') : t('inspector.type_spinner', 'Spinner')}
      </div>
      <Num id="time" label={t('inspector.time', 'Time')} value={Math.round(o.time)} onChange={v => upd({ time: v })} />
      {o.type !== 'spinner' && <>
        <Num id="x" label="X" value={Math.round(o.x)} onChange={v => upd({ x: v })} />
        <Num id="y" label="Y" value={Math.round(o.y)} onChange={v => upd({ y: v })} />
      </>}
      {o.type === 'slider' && <>
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{t('inspector.curve_type', 'Curve Type')}</span>
          <UiControl id="inspector.curve-type"><select value={o.curveType} onChange={e => { store.markManualCurveType(o.id); upd({ curveType: e.target.value }); }} // v394: 手动改型后节点编辑不再强制改型
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            <option value="L">{t('inspector.curve_linear', 'L Linear')}</option>
            <option value="P">{t('inspector.curve_perfect', 'P Perfect')}</option>
            <option value="B">{t('inspector.curve_bezier', 'B Bezier')}</option>
            <option value="C">{t('inspector.curve_catmull', 'C Catmull')}</option>
            {/* v387: B 样条 (lazer BSpline(4) 存档格式); 当前为其它 B<n> 时按原 degree 显示, 切换 = 控制点原样改按 B 样条解释 */}
            <option value={bSplineOption}>
              {t('inspector.curve_bspline', '{t} B-Spline (lazer)', { t: bSplineOption })}
            </option>
          </select></UiControl>
        </label>
        {/* v387: B<n> 内联提示 — stable 不可读, 引导用警告条/菜单一键转换 */}
        {parseBSplineType(o.curveType) !== null && (
          <div className="text-amber-300/90 text-[11px]">{t('inspector.curve_bspline_hint', 'B-spline sliders are not readable by stable osu! (use the warning bar / Compose menu to convert)')}</div>
        )}
        <Num id="length" label={t('inspector.length', 'Length')} value={Math.round(o.length ?? 0)} onChange={v => upd({ length: v })} />
        <Num id="repeats" label={t('inspector.repeats', 'Repeats')} value={o.slides ?? 1} onChange={v => upd({ slides: Math.max(1, Math.round(v)) })} />
      </>}
      {o.type === 'spinner' && <Num id="end-time" label={t('inspector.end_time', 'End Time')} value={Math.round(o.endTime ?? 0)} onChange={v => upd({ endTime: v })} />}
      <label className="flex items-center gap-2 text-white/70 pt-1">
        <UiControl id="inspector.new-combo"><input type="checkbox" checked={!!o.newCombo} onChange={e => upd({ newCombo: e.target.checked })} /></UiControl>
        <UiText id="inspector.new-combo" textKey="inspector.new_combo">New Combo</UiText>
      </label>
      <HitSoundPanel objs={sel} />
      <div className="text-white/40 pt-1">{t('inspector.control_points', 'Control Points: {n}', { n: o.type === 'slider' ? (o.curvePoints?.length ?? 0) + 1 : '-' })}</div>
      {TransformPanel()}
      {o.type === 'slider' && (
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          <div className="font-bold text-white/60">{t('inspector.convert_title', 'Convert')}</div>
          <div className="flex flex-col gap-1">
            <UiControl id="inspector.split"><Btn data-conv-open="split" onClick={() => store.openConversion('split')}>
              <UiText id="inspector.split" textKey="inspector.split_slider">Split Slider (Equal Time)</UiText>
            </Btn></UiControl>
            {/* v236: 对称滑条 (轴/中心对称, 旋转/平移 n 次, 可拼头尾) */}
            <UiControl id="inspector.symmetric"><Btn data-conv-open="symSlider" onClick={() => store.openConversion('symSlider')}>
              <UiText id="inspector.symmetric" textKey="inspector.symmetric_slider">Symmetric Slider</UiText>
            </Btn></UiControl>
            {/* v486: 批量插入锚点 (弹簧滑条 — 沿主滑条按节拍间隔盖章子滑条模板) */}
            <UiControl id="inspector.anchor-stamp"><Btn data-conv-open="anchorStamp" onClick={() => store.openConversion('anchorStamp')}>
              <UiText id="inspector.anchor-stamp" textKey="inspector.anchor_stamp">Insert Anchors (Spring)</UiText>
            </Btn></UiControl>
            {/* v409: 在选中锚点处分割 (节点选区存在时显示; 缝点双侧各一份, 时间顺序衔接) */}
            {store.nodeSelectionCount > 0 && (
              <UiControl id="inspector.split-anchors"><Btn data-conv-apply="split-anchors" onClick={() => store.splitSelectedSliderNodes()}>
                <UiText id="inspector.split-anchors" textKey="inspector.split_at_anchors">Split at Anchors</UiText>
              </Btn></UiControl>
            )}
            <SliderConvertButtons sliders={[o]} />
          </div>
        </div>
      )}
      <UiControl id="inspector.delete"><Btn variant="danger" className="mt-2" onClick={() => store.deleteSelected()} title={t('inspector.delete_tip', 'Delete selected objects ({key})', { key: hotkeyLabel('delete') })}>
        <UiText id="inspector.delete" textKey="inspector.delete">Delete</UiText>
      </Btn></UiControl>
      {/* v64/v65: 多边形生成 + 批量复制 (与未选中分支同一入口) */}
      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <div className="font-bold text-white/60">{t('inspector.generate_title', 'Generate')}</div>
        <div className="flex flex-col gap-1">
          <UiControl id="inspector.polygon"><Btn data-conv-open="polygon" onClick={() => store.openConversion('polygon')} title={t('inspector.polygon_tip', 'Generate a polygon of circles ({key})', { key: hotkeyLabel('polygon') })}>
            <UiText id="inspector.polygon" textKey="inspector.polygon_generate">Polygon Generator</UiText>
          </Btn></UiControl>
          <UiControl id="inspector.duplicate"><Btn data-conv-open="duplicate" onClick={() => store.openConversion('duplicate')}>
            <UiText id="inspector.duplicate" textKey="inspector.duplicate_count" vars={{ n: 1 }}>Duplicate ({'{n}'})</UiText>
          </Btn></UiControl>
        </div>
      </div>
      {HintsBlock}
    </div>
  );
}

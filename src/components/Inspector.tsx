import { useState, type ReactNode } from 'react';
import { RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2 } from 'lucide-react'; // v181: ↺/↻/⇋/⇅ → lucide
import { store, useEditor, type TransformOrigin } from '@/osu/store';
import { invalidatePath } from '@/osu/renderer';
import { parseHitSample, hitSampleFilename } from '@/osu/clock/hitSounds';
import { computeMerge } from '@/osu/convert/merge';
import { sliderToBezierSegments, segmentsToPoints } from '@/osu/convert/bezierPath';
import { genId, type HitObject } from '@/osu/parser';
import { hotkeyLabel } from '@/osu/hotkeys'; // v321 (F21): 快捷键提示随改键同步
import { useT } from '@/i18n';

// 选中物件属性编辑

// v146: Btn/NumIn 提升为模块顶层组件 — 原定义为 Inspector 内部组件, 每次重渲染生成新组件类型,
// React 卸载重建子树导致输入框失焦 ("全选输入一个数字就失焦"); 顶层组件类型稳定, DOM 保留
const Btn = ({ label, title, onClick }: { label: ReactNode; title: string; onClick: () => void }) => (
  <button onClick={onClick} title={title}
    className="px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 text-[11px]">
    {label}
  </button>
);
// v146: 局部文本态 (与 App.tsx GridSpacingInput 同款模式): 输入过程中不用数值覆盖文本
// (可全选重输/输小数点/负号), 合法值实时提交, 失焦还原为已提交值
const NumIn = ({ value, set, w = 'w-16', testid }: { value: number; set: (v: number) => void; w?: string; testid: string }) => {
  const [text, setText] = useState<string | null>(null);
  return (
    <input type="number" step="any" data-tf={testid}
      value={text ?? String(value)}
      onChange={e => { setText(e.target.value); const v = parseFloat(e.target.value); if (isFinite(v)) set(v); }}
      onBlur={() => setText(null)}
      className={`${w} bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white`} />
  );
};

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
  const TransformPanel = () => (
    <div className="space-y-1.5">
      <div className="font-bold text-white/60">{t('inspector.transform_title', 'Transform (Selection)')}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white/50">{t('inspector.origin', 'Origin')}</span>
        {([['selection', t('inspector.origin_selection', 'Selection')], ['playfield', t('inspector.origin_playfield', 'Center')], ['custom', t('inspector.origin_custom', 'Custom')]] as const).map(([m, label]) => (
          <label key={m} className="flex items-center gap-0.5 text-white/70">
            <input type="radio" name="tf-origin" checked={originMode === m} data-tf={`origin-${m}`}
              onChange={() => store.setOriginMode(m)} />
            {label}
          </label>
        ))}
        {originMode === 'custom' && (
          <span className="flex items-center gap-1">
            <NumIn value={customX} set={v => store.setCustomOrigin({ x: v, y: store.customOrigin.y })} w="w-14" testid="custom-x" />
            <NumIn value={customY} set={v => store.setCustomOrigin({ x: store.customOrigin.x, y: v })} w="w-14" testid="custom-y" />
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-white/50">{t('inspector.rotate', 'Rotate')}</span>
        <NumIn value={angle} set={setAngle} testid="angle" />
        <Btn label={<><RotateCcw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('inspector.rotate_ccw', 'Counterclockwise')}</>} title={t('inspector.rotate_ccw_tip', 'Rotate counterclockwise by the entered angle')} onClick={() => store.rotateSelected(-Math.abs(angle), origin)} />
        <Btn label={<><RotateCw className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('inspector.rotate_cw', 'Clockwise')}</>} title={t('inspector.rotate_cw_tip', 'Rotate clockwise by the entered angle')} onClick={() => store.rotateSelected(Math.abs(angle), origin)} />
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-white/50">{t('inspector.scale', 'Scale')}</span>
        <span className="text-white/40">x</span>
        <NumIn value={factor} set={setFactor} testid="factor" w="w-14" />
        <span className="text-white/40">y</span>
        <NumIn value={factorY} set={setFactorY} testid="factor-y" w="w-14" />
        <Btn label={t('inspector.apply_scale', 'Apply Factor')} title={t('inspector.apply_scale_tip', 'Scale by the entered factors (X only: set y to 1; Y only: set x to 1; slider length scales too)')} onClick={() => store.scaleSelected(factor, factorY, origin)} />
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-white/50">{t('inspector.flip', 'Flip')}</span>
        <Btn label={<><FlipHorizontal2 className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('inspector.flip_h', 'Horizontal ({key})', { key: hotkeyLabel('flip-h') })}</>} title={t('inspector.flip_h_tip', 'Flip horizontally')} onClick={() => store.flipSelected('h', origin)} />
        <Btn label={<><FlipVertical2 className="inline-block w-3.5 h-3.5 mr-0.5 -mt-0.5" />{t('inspector.flip_v', 'Vertical ({key})', { key: hotkeyLabel('flip-v') })}</>} title={t('inspector.flip_v_tip', 'Flip vertically')} onClick={() => store.flipSelected('v', origin)} />
      </div>
      <div className="text-white/35">{t('inspector.transform_hotkeys_hint', 'Hotkeys {ccw}/{cw} rotate 90°, {flipH}/{flipV} flip around the playfield center (same as stable); the buttons above use the selected origin; {reverse} reverses (same as lazer)', { ccw: hotkeyLabel('rot-ccw'), cw: hotkeyLabel('rot-cw'), flipH: hotkeyLabel('flip-h'), flipV: hotkeyLabel('flip-v'), reverse: hotkeyLabel('reverse') })}</div>
    </div>
  );

  // hitsound 区块 (单选/多选批量; 多选值不同显示混合态, 修改统一应用到全部选中物件)
  const HitSoundPanel = ({ objs }: { objs: HitObject[] }) => {
    const hasBit = (bit: number) => objs.every(o => ((o.hitSound ?? 0) & bit) !== 0);
    const BitChk = ({ bit, label, title }: { bit: number; label: string; title: string }) => (
      <label className="flex items-center gap-1 text-white/70" title={title}>
        <input type="checkbox" checked={hasBit(bit)} data-hs={label}
          onChange={e => store.setSelectedHitSoundBit(bit, e.target.checked)} />
        {label}
      </label>
    );
    // 多选时取公共值; 不同则 undefined (显示混合态)
    const common = <T,>(get: (o: HitObject) => T): T | undefined =>
      objs.every(o => get(o) === get(objs[0])) ? get(objs[0]) : undefined;
    const samples = objs.map(o => parseHitSample(o.hitSampleRaw));
    const commonSample = <K extends keyof (typeof samples)[0]>(k: K) =>
      samples.every(s => s[k] === samples[0][k]) ? samples[0][k] : undefined;
    const SetSel = ({ label, field, testid }: { label: string; field: 'normalSet' | 'additionSet'; testid: string }) => {
      const v = commonSample(field);
      return (
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{label}</span>
          <select value={v === undefined ? '' : String(v)} data-hs={testid}
            onChange={e => { if (e.target.value !== '') store.applyHitSampleToSelected({ [field]: parseInt(e.target.value) }); }}
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            {v === undefined && <option value="">{t('inspector.mixed', 'Mixed')}</option>}
            <option value="0">{t('inspector.auto_inherit', 'Auto / Inherit')}</option>
            <option value="1">Normal</option>
            <option value="2">Soft</option>
            <option value="3">Drum</option>
          </select>
        </label>
      );
    };
    const SampleNum = ({ label, field, testid, clamp }: { label: string; field: 'customIndex' | 'volume'; testid: string; clamp: (v: number) => number }) => {
      const v = commonSample(field);
      return (
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{label}</span>
          <input type="number" value={v === undefined ? '' : v} placeholder={t('inspector.mixed', 'Mixed')} data-hs={testid}
            onChange={e => { if (e.target.value !== '') store.applyHitSampleToSelected({ [field]: clamp(parseInt(e.target.value) || 0) }); }}
            className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" />
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
    const cls = 'px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15';
    return (
      <>
        {sliders.length > 0 && (
          <button data-conv-open="stream" onClick={() => store.openConversion('stream')} className={cls}>
            {t('inspector.sliders_to_stream', 'Sliders to Stream ({n})', { n: sliders.length })}
          </button>
        )}
        {selP.length > 0 && (
          <button data-conv-apply="p2b" onClick={onP2B} className={cls}>
            {t('inspector.arc_to_bezier', 'Arc → Bezier ({n})', { n: selP.length })}
          </button>
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
            <div className="flex gap-1.5 flex-wrap">
              <SliderConvertButtons sliders={selSliders} />
              <button data-conv-apply="merge" onClick={onMerge}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
                {t('inspector.merge_to_slider', 'Merge into Slider')}
              </button>
            </div>
          </div>
        )}
        {/* v64/v65: 多边形生成 (无需选区; Ctrl+Shift+D) + 批量复制 (需选区) */}
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          <div className="font-bold text-white/60">{t('inspector.generate_title', 'Generate')}</div>
          <div className="flex gap-1.5 flex-wrap">
            <button data-conv-open="polygon" onClick={() => store.openConversion('polygon')}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
              {t('inspector.polygon_generate', 'Polygon Generator ({key})', { key: hotkeyLabel('polygon') })}
            </button>
            <button data-conv-open="duplicate" onClick={() => store.openConversion('duplicate')}
              disabled={!sel.length}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15 disabled:opacity-40">
              {sel.length ? t('inspector.duplicate_count', 'Duplicate ({n})', { n: sel.length }) : t('inspector.duplicate', 'Duplicate')}
            </button>
          </div>
        </div>
        {HintsBlock}
      </div>
    );
  }
  const o = sel[0];
  const upd = (patch: Partial<typeof o>) => {
    if (store.lockNotes) return; // v115: 锁定物件 — Inspector 数值/下拉编辑禁用
    store.pushUndo();
    Object.assign(o, patch);
    if (o.type === 'slider') invalidatePath(o.id);
    store.commitDrag();
  };

  const Num = ({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) => (
    <label className="flex items-center gap-1 text-xs text-white/70">
      <span className="w-14">{label}</span>
      <input type="number" step={step} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" />
    </label>
  );

  return (
    <div className="p-3 space-y-1.5 text-xs">
      <div className="font-bold text-white/90 mb-2">
        {o.type === 'circle' ? t('inspector.type_circle', 'Hit Circle') : o.type === 'slider' ? t('inspector.type_slider', 'Slider') : t('inspector.type_spinner', 'Spinner')}
      </div>
      <Num label={t('inspector.time', 'Time')} value={Math.round(o.time)} onChange={v => upd({ time: v })} />
      {o.type !== 'spinner' && <>
        <Num label="X" value={Math.round(o.x)} onChange={v => upd({ x: v })} />
        <Num label="Y" value={Math.round(o.y)} onChange={v => upd({ y: v })} />
      </>}
      {o.type === 'slider' && <>
        <label className="flex items-center gap-1 text-white/70">
          <span className="w-14">{t('inspector.curve_type', 'Curve Type')}</span>
          <select value={o.curveType} onChange={e => upd({ curveType: e.target.value })}
            className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white">
            <option value="L">{t('inspector.curve_linear', 'L Linear')}</option>
            <option value="P">{t('inspector.curve_perfect', 'P Perfect')}</option>
            <option value="B">{t('inspector.curve_bezier', 'B Bezier')}</option>
            <option value="C">{t('inspector.curve_catmull', 'C Catmull')}</option>
          </select>
        </label>
        <Num label={t('inspector.length', 'Length')} value={Math.round(o.length ?? 0)} onChange={v => upd({ length: v })} />
        <Num label={t('inspector.repeats', 'Repeats')} value={o.slides ?? 1} onChange={v => upd({ slides: Math.max(1, Math.round(v)) })} />
      </>}
      {o.type === 'spinner' && <Num label={t('inspector.end_time', 'End Time')} value={Math.round(o.endTime ?? 0)} onChange={v => upd({ endTime: v })} />}
      <label className="flex items-center gap-2 text-white/70 pt-1">
        <input type="checkbox" checked={!!o.newCombo} onChange={e => upd({ newCombo: e.target.checked })} />
        {t('inspector.new_combo', 'New Combo')}
      </label>
      <HitSoundPanel objs={sel} />
      <div className="text-white/40 pt-1">{t('inspector.control_points', 'Control Points: {n}', { n: o.type === 'slider' ? (o.curvePoints?.length ?? 0) + 1 : '-' })}</div>
      {TransformPanel()}
      {o.type === 'slider' && (
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          <div className="font-bold text-white/60">{t('inspector.convert_title', 'Convert')}</div>
          <div className="flex gap-1.5 flex-wrap">
            <button data-conv-open="split" onClick={() => store.openConversion('split')}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
              {t('inspector.split_slider', 'Split Slider (Equal Time)')}
            </button>
            {/* v236: 对称滑条 (轴/中心对称, 旋转/平移 n 次, 可拼头尾) */}
            <button data-conv-open="symSlider" onClick={() => store.openConversion('symSlider')}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
              {t('inspector.symmetric_slider', 'Symmetric Slider')}
            </button>
            <SliderConvertButtons sliders={[o]} />
          </div>
        </div>
      )}
      <button onClick={() => store.deleteSelected()} className="mt-2 px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40 text-red-200">
        {t('inspector.delete', 'Delete (Del)')}
      </button>
      {/* v64/v65: 多边形生成 + 批量复制 (与未选中分支同一入口) */}
      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <div className="font-bold text-white/60">{t('inspector.generate_title', 'Generate')}</div>
        <div className="flex gap-1.5 flex-wrap">
          <button data-conv-open="polygon" onClick={() => store.openConversion('polygon')}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
            {t('inspector.polygon_generate', 'Polygon Generator ({key})', { key: hotkeyLabel('polygon') })}
          </button>
          <button data-conv-open="duplicate" onClick={() => store.openConversion('duplicate')}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/15">
            {t('inspector.duplicate_count', 'Duplicate ({n})', { n: 1 })}
          </button>
        </div>
      </div>
      {HintsBlock}
    </div>
  );
}

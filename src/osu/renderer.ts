// 游玩区渲染器: 按当前时间渲染物件(缩圈/淡入/结束淡出), 参考 osu!lazer 编辑器显示效果
// 皮肤化: hitcircle 白底乘算 combo 色, overlay/箭头/滑条球/数字原色绘制 (osu! 标准着色规则)
import type { Beatmap, HitObject, TimingPoint } from './parser';
import { csToRadius, arToPreempt, sliderVelocityAt } from './parser';
import { alphaAt, isVisibleAt, sliderRepeatAlpha, approachBounceScale, sliderDurationMemo, HIT_LINGER } from './lifecycle';
import { computePendingPath, getSliderPath, invalidateSliderPath, pendingPhantomPoint, placementLength, truncatePathAtLength } from './sliderPath';
import { followPointPairs, followPointsBetween, followPointFrameIndex, followPointCrop } from './followPoints';
import { sliderTickPoints } from './clock/hitSounds';
import { tintedSprite, skinScaleAdjust, skinSpriteWidth, hitcircleSpriteWidth, getSkinContentSeq, type Skin, type SkinImage } from './skin';
import { displaySettings } from './displaySettings'; // v132: 显示设置 (皮肤颜色/轨迹线/缩圈/渐出/点击特效)
import type { GameplayObjRender } from './gameplay/testPlaySession'; // v287: 测试游玩渲染数据

// lazer Colour4.Lighten/Darken: amount 先乘 0.5, 再 c*(1+0.5a)+a (clamp 0..255); Darken(n) = Lighten(-n)
// 当前轨道为纯黑实验样式, 渐变公式暂时不用, 整函数注释备查 (恢复渐变时取消注释即可)
// function lazerLighten(color: string, amount: number): string {
//   let r = 0, gg = 0, b = 0;
//   let m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
//   if (m) { r = parseInt(m[1], 16); gg = parseInt(m[2], 16); b = parseInt(m[3], 16); }
//   else {
//     m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
//     if (!m) return color;
//     r = +m[1]; gg = +m[2]; b = +m[3];
//   }
//   const a = amount * 0.5;
//   const f = (c: number) => Math.round(Math.min(255, Math.max(0, c * (1 + 0.5 * a) + 255 * a)));
//   return `rgb(${f(r)},${f(gg)},${f(b)})`;
// }

// lazer LegacySliderBody.ColourAt 经典皮肤滑条身分层 (position: 0=最外缘 -> 1=圆心):
// 总半径 = r (与单点同宽); [0, 0.078] 外缘阴影, [0.078, 0.1875] 白边, 内部轨道 darken(0.1)->lighten(0.5) 径向渐变
// 必须在离屏 canvas 上合成: 白边整条描边后镂空内部成环, 轨道用 destination-over 垫进镂空 (窄->宽不透明渐变),
// 最后 destination-out 0.3 把轨道区域统一降到 0.7 alpha (lazer Opacity(0.7)) —— 内部透出深色游玩区背景,
// 直接画在主画布上白边会衬在轨道下把内部洗白
function paintSliderBody(g: CanvasRenderingContext2D, points: { x: number; y: number }[], r: number, border: string, _track: string) {
  const stroke = (width: number, style: string) => {
    g.strokeStyle = style; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    points.forEach((p, i) => i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y));
    g.stroke();
  };
  // 1) 外缘阴影 + 白边, 镂空内部成环 (总宽 2r, 与单点直径一致)
  stroke(r * 2, 'rgba(0,0,0,0.25)');
  stroke(r * 2 * 0.922, border);                           // 白边环 (sliderBorder)
  g.globalCompositeOperation = 'destination-out';
  stroke(r * 2 * 0.8125, '#000');
  // 2) 轨道垫进镂空: 实验性对齐 stable 观感 —— 基色纯黑, 无渐变 (lazer 原版是三级离散渐变, 已注释备查)
  g.globalCompositeOperation = 'destination-over';
  stroke(r * 2 * 0.8125, '#000');
  // stroke(r * 2 * 0.3, lazerLighten(track, 0.5));   // lazer 渐变: 中心 Lighten(0.5)
  // stroke(r * 2 * 0.55, lazerLighten(track, 0.2));  //         中间 Lighten(0.2)
  // stroke(r * 2 * 0.8125, lazerLighten(track, -0.1)); //       外圈 Darken(0.1)
  // 3) 轨道区域 alpha 统一 x0.7 (白边环不受影响)
  g.globalCompositeOperation = 'destination-out';
  stroke(r * 2 * 0.8125, 'rgba(0,0,0,0.3)');
  g.globalCompositeOperation = 'source-over';
}

// 滑条身离屏合成结果 (c 为 ss 倍超采样位图, dx/dy/w/h 为 drawImage 目标 osu 坐标矩形)
interface SliderBodySprite { c: HTMLCanvasElement; dx: number; dy: number; w: number; h: number }
const bodyCache = new Map<number, { sprite: SliderBodySprite; key: string }>();
let scratchBody: HTMLCanvasElement | null = null; // 放置预览用 (路径每帧变, 不缓存)

// ss = 超采样倍数 (取主画布 dpr*scale): 离屏按高分绘制再 drawImage 缩回, 否则低分辨率位图放大后边缘锯齿
function sliderBodySprite(points: { x: number; y: number }[], r: number, border: string, track: string, cacheId?: number, ss = 1): SliderBodySprite {
  const pad = r + 3;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  let w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  if (!(w > 0) || !(h > 0)) { minX = minY = 0; w = h = 1; } // 退化路径保底 (防 NaN 画布尺寸)
  // v301: 离屏位图尺寸上限 — 放置预览可拖出游玩区数千 px, 包围盒 × 超采样 (最高 4) 会分配
  // 数万 px 边长的位图, 直接把 GPU 进程打崩 (画面冻结白屏; 恢复后各缓存贴图失效 → 物件失色)。
  // 超上限时降低离屏分辨率 (极端滑条视觉变糊, 但永不冻结)
  // v306: 下限 0.05 → 0.005 — v148 末端延长 (length ≫ 几何全长, 如手改 pixelLength=20 万) 包围盒
  //   可达数十万 px, 0.05 下限会顶破 MAX_AREA (143130px × 0.05 = 7157px 边长 = 50M px ≈ 200MB 位图)
  const MAX_DIM = 8192, MAX_AREA = 8192 * 4096;
  // 目标分辨率 (至少 1x, 跟随超采样, 下限 0.005 防除零) 与尺寸上限取 min — 上限永远优先
  const q = Math.min(4, Math.max(1, ss, 0.005), MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
  const key = `${r.toFixed(2)}|${q.toFixed(3)}|${border}|${track}`;
  const hit = cacheId !== undefined ? bodyCache.get(cacheId) : undefined;
  if (hit && hit.key === key) return hit.sprite;
  const c = cacheId !== undefined ? document.createElement('canvas') : (scratchBody ??= document.createElement('canvas'));
  c.width = Math.ceil(w * q);
  c.height = Math.ceil(h * q);
  const g = c.getContext('2d')!;
  g.scale(q, q);
  g.translate(-minX + pad, -minY + pad);
  paintSliderBody(g, points, r, border, track);
  const sprite = { c, dx: minX - pad, dy: minY - pad, w, h };
  if (cacheId !== undefined) bodyCache.set(cacheId, { sprite, key });
  return sprite;
}

// getSliderPath 实现已挪到 sliderPath.ts (供 stacking.ts 复用, 避免循环 import), 这里 re-export 保持既有调用不变
export { getSliderPath } from './sliderPath';

export function invalidatePath(id?: number) {
  invalidateSliderPath(id);
  if (id === undefined) { bodyCache.clear(); outlineCache.clear(); } // v340: 描边缓存联动
  else { bodyCache.delete(id); outlineCache.delete(id); }
}

export interface RenderCtx {
  g: CanvasRenderingContext2D;
  bm: Beatmap;
  skin: Skin;
  time: number;
  selected: Set<number>;
  /** v245: 帧级缓存键 (EditorCanvas 传 dataVersion) — 选中装饰离屏层/followPoint 对缓存按它失效 */
  cacheKey?: string;
  /** v340: 数据版本键 (EditorCanvas 传 dataVersion) — 静态场景层按它失效 (拖拽只 bump version 不影响) */
  dataKey?: string;
  /** v340: 启用物件场景静态层 (暂停且非平移时; 播放/测试中时间逐帧变, 缓存无意义) */
  staticScene?: boolean;
  /** v340: 静态层排除集 (正在拖拽/变换的物件) — 这些物件不进层, blit 后实时补画 */
  staticExclude?: Set<number>;
  /** v341: 平移拖拽 (多选移动) — 被拖物件几何变化是纯平移时, 渲染进独立拖拽层, 每帧按 (dx,dy)
   *  偏移 blit (全选千件拖动从每帧全量重画降为 2 次 drawImage); dx/dy = 相对拖拽起点的位移 (osu px) */
  staticTranslate?: { ids: Set<number>; dx: number; dy: number };
  /** v341: 选中装饰层随平移拖拽整体偏移 blit (拖拽覆盖整个选区时由 EditorCanvas 传入);
   *  key = 拖拽期间稳定的层键 (替代逐帧变的 cacheKey), 层内容建于拖拽首帧, blit 偏移 = 位移差 */
  selTranslate?: { dx: number; dy: number; key: string };
  /** v201: combo = lazer ComboIndex (皮肤色用), comboWithOffset = ComboIndexWithOffsets (谱面 [Colours] 用), index = 显示数字 */
  comboInfo: Map<number, { combo: number; comboWithOffset: number; index: number }>;
  /** 物件堆叠偏移 (osu px): key=物件 id, 无条目表示不偏移; 由 stacking.ts 按谱面数据预算 */
  stackOffsets: Map<number, { dx: number; dy: number }>;
  /** v287: 测试游玩判定状态 (TestPlayOverlay 传入) — 命中爆炸锚定实际命中时刻/miss 不爆/tick 未跟踪不爆/
   *  跟随圈仅 tracking 时显示/转盘转角由玩家输入驱动; 缺省 = 编辑器 autoplay 行为 (全部路径不变) */
  gameplay?: Map<number, GameplayObjRender>;
}

const ZERO_OFFSET = { dx: 0, dy: 0 };
function stackOffset(rc: RenderCtx, id: number): { dx: number; dy: number } {
  return rc.stackOffsets.get(id) ?? ZERO_OFFSET;
}

// v201: 对齐 lazer OsuHitObject.UpdateComboInformation —
//  combo = ComboIndex (首个 combo = 1, newCombo 递增; 不含跳色位) — 皮肤 combo 色用此索引;
//  comboWithOffset = ComboIndexWithOffsets (newCombo 时 += 1 + comboSkip) — 谱面 [Colours] 用此索引;
//  spinner 永不开始新 combo; 首物件与 spinner 后首个非 spinner 物件强制 new combo。
//  注意: stable/lazer 实际生效的首个 combo 色是颜色表下标 1 (即 Combo2), 不是下标 0
//  (见 lazer EditorBeatmapSkin 构造器注释) — “原版配色顺序”即如此, 之前的实现整体偏了一位。
export function computeCombos(bm: Beatmap): Map<number, { combo: number; comboWithOffset: number; index: number }> {
  const m = new Map<number, { combo: number; comboWithOffset: number; index: number }>();
  let combo = 0, comboWithOffset = 0, idx = 0;
  let lastType: string | null = null;
  for (const o of bm.hitObjects) {
    const startNew = o.type !== 'spinner' && (o.newCombo || lastType === null || lastType === 'spinner');
    if (startNew) { combo++; comboWithOffset += 1 + (o.comboSkip ?? 0); idx = 1; }
    else if (lastType !== null) idx++;
    m.set(o.id, { combo, comboWithOffset, index: idx || 1 });
    lastType = o.type;
  }
  return m;
}

/** v44: 转换预览视图 — 源物件隐藏 + 结果物件按时间并入, 返回的视图可直接用于渲染/combo 计算。
 *  combo 数字与颜色按合并后的完整列表计算 (承接前文 combo, 后续物件重编号), 与转换应用后完全一致 */
export function mergedWithPreview(bm: Beatmap, prev: { hideIds: number[]; objects: HitObject[]; timingPoints?: TimingPoint[] } | null): Beatmap {
  if (!prev || !prev.objects.length) return bm;
  const hide = new Set(prev.hideIds);
  return {
    ...bm,
    hitObjects: bm.hitObjects.filter(o => !hide.has(o.id)).concat(prev.objects).sort((a, b) => a.time - b.time),
    // v68: 绿线副本预览 (批量复制勾选"复制绿线"时, 上时间轴 WYSIWYG)
    timingPoints: prev.timingPoints?.length
      ? [...bm.timingPoints, ...prev.timingPoints].sort((a, b) => a.time - b.time)
      : bm.timingPoints,
  };
}

/**
 * 物件结束时间 (v69 抽出为纯函数): 滑条时长按"给定 timing"下头部 SV 推导
 * (100*multiplier*sv/beatLength px/ms) — 转换预览传入合并后 timing, 复制绿线时长度预览 = 应用后效果
 */
export function objectEndAt(
  points: TimingPoint[], sliderMultiplier: number,
  o: { type: string; time: number; endTime?: number; length?: number; slides?: number },
): number {
  if (o.type === 'spinner') return o.endTime ?? o.time + 1000;
  // v197: 走帧级 memo (lifecycle.sliderDurationMemo) — 时间轴每帧全表 objEnd, 线性 SV 扫描是实测热点
  if (o.type === 'slider')
    return o.time + sliderDurationMemo(points, sliderMultiplier, o);
  return o.time;
}

// v132: override = 显示设置「使用皮肤颜色」时传入皮肤 skin.ini [Colours] 的 Combo 色 (优先于谱面自带)
export function comboColor(bm: Beatmap, combo: number, override?: string[]): string {
  const colors = override?.length ? override : bm.colors.combos.length ? bm.colors.combos : ['#FF69B4'];
  return colors[combo % colors.length];
}

// v132: 滑条身 border/track 颜色 — 开「使用皮肤颜色」时皮肤 skin.ini 优先, 未定义回退谱面颜色
// v347: SliderBorder 解析进 skin 渲染链路 (此前开关关闭时读不到)
// v348: SliderBorder 优先级随开关翻转 — 开: 皮肤 > 谱面 > 默认; 关: 谱面 > 皮肤 > 默认
//   (缺省互相回退, 都没有才纯白)
function sliderBodyColors(bm: Beatmap, skin: Skin, color: string): { border: string; track: string } {
  if (displaySettings.skinColors) {
    return {
      border: skin.sliderBorder || bm.colors.sliderBorder || '#ffffff',
      track: skin.sliderTrackOverride || bm.colors.sliderTrackOverride || color,
    };
  }
  return {
    border: bm.colors.sliderBorder || skin.sliderBorder || '#ffffff',
    track: bm.colors.sliderTrackOverride || color,
  };
}

export function renderPlayfield(rc: RenderCtx, pending?: { x: number; y: number; redAnchor: boolean }[], cursor?: { x: number; y: number } | null, pendingDistanceLock = false, pendingSkeleton = false) {
  const { bm, time } = rc;
  const cs = bm.difficulty.cs;
  const ar = bm.difficulty.ar;
  const radius = csToRadius(cs);
  const preempt = arToPreempt(ar);

  const visible = bm.hitObjects.filter(o => isVisibleAt(bm, o, time));

  // v340: 暂停时物件场景静态层 — 框选/拖曳只动选区或被拖物件, 其余物件+follow point 每帧全量重画
  //   是密集谱面 (近千物件同屏) 交互帧数冰点 (CDP 实测 ~20fps, render 均 20ms+, 几乎全是逐物件
  //   save/restore/drawImage 光栅)。层键 = 时间+dataKey+谱面引用+皮肤内容序号+变换+显示设置+排除集签名;
  //   命中时每帧 1 次 drawImage, 被拖物件 (staticExclude) 不进层、blit 后实时补画。
  //   播放/测试游玩中时间逐帧变, 缓存无意义, 走原路径。
  const excl = rc.staticExclude?.size ? rc.staticExclude : undefined;
  const __w = window as unknown as { __perfScene?: number[]; __perfSel?: number[] };
  const __t0 = performance.now();
  if (rc.staticScene && !rc.gameplay) drawStaticScene(rc, visible, radius, preempt, excl, rc.staticTranslate);
  else drawSceneObjects(rc, visible, radius, preempt);
  const __t1 = performance.now();
  { const a = (__w.__perfScene ??= []); a.push(__t1 - __t0); if (a.length > 900) a.splice(0, a.length - 900); } // v340 调试分段

  // v245: 选中装饰统一走离屏层缓存 (原逐物件穿插在物件循环内/后绘制, 2000 物件全选时每帧
  //   逐物件重画是全选场景最大热点 — CDP 实测 3fps, 帧忙时 ~330ms 几乎全是软件光栅)。
  //   视觉差异: 装饰整体盖在全部物件上层 (原为逐物件穿插); v40 "不可见选中物件也画装饰" 语义保留。
  if (rc.selected.size) drawSelectionLayer(rc, radius);
  { const a = (__w.__perfSel ??= []); a.push(performance.now() - __t1); if (a.length > 900) a.splice(0, a.length - 900); } // v340 调试分段

  if (pending && pending.length) drawPendingSlider(rc, pending, cursor ?? null, pendingDistanceLock, pendingSkeleton);
}

// v340: 物件+follow point 场景绘制 (renderPlayfield 主体抽出, 静态层离屏合成与实时补画共用);
//   skip = 跳过这些 id (静态层排除被拖物件), only = 只画这些 id (blit 后实时补画被拖物件)
//   v341: fpMode 控制 only 对 follow point 连接对的语义 — 'either' 任一端命中即画 (默认),
//   'both' 两端都命中才画 (平移拖拽层: 随层整体平移), 'xor' 恰好一端命中 (拖拽层外实时补画)
function drawSceneObjects(rc: RenderCtx, visible: HitObject[], radius: number, preempt: number,
  skip?: Set<number>, only?: Set<number>, fpMode: 'either' | 'both' | 'xor' = 'either') {
  const { g, bm, time } = rc;
  drawFollowPoints(rc, radius, skip, only, fpMode);

  for (let i = visible.length - 1; i >= 0; i--) {
    const o = visible[i];
    if (skip?.has(o.id)) continue;
    if (only && !only.has(o.id)) continue;
    const dt = time - o.time;
    const alpha = alphaAt(bm, o, time);
    // v215: 暂留模式 (打击动画关) 滑条头/尾圈有独立残留期 — 滑条身 alpha 归零后仍要画头/尾, 不剔除
    const sliderNodeLinger = o.type === 'slider' && displaySettings.hitExplosion && !displaySettings.hitAnimation;
    if (alpha <= 0 && !sliderNodeLinger) continue;
    // 单点命中后的爆炸放大系数; v147: 关「打击动画」时不放大 (原大小残留 800ms 渐隐由 lifecycle.alphaAt 负责)
    let hitFade = o.type === 'circle' && dt >= 0 && displaySettings.hitAnimation ? dt / 240 : 0;
    // v287: 测试游玩 — 爆炸锚定实际命中时刻; miss 不放大 (无爆炸)
    if (o.type === 'circle' && rc.gameplay) {
      const gi = rc.gameplay.get(o.id);
      if (gi?.state === 'hit') hitFade = displaySettings.hitAnimation ? Math.max(0, Math.min(1, (time - gi.hitAt) / 240)) : 0;
      else if (gi?.state === 'miss') hitFade = 0;
    }

    g.save();
    g.globalAlpha = Math.min(1, alpha);
    const ci = rc.comboInfo.get(o.id) ?? { combo: 0, comboWithOffset: 0, index: 1 };
    // v201: 皮肤色索引用 ComboIndex (不含跳色位), 谱面 [Colours] 用 ComboIndexWithOffsets (lazer 同款区分)
    const color = comboColor(bm, displaySettings.skinColors ? ci.combo : ci.comboWithOffset, displaySettings.skinColors ? rc.skin.comboColors : undefined); // v132: 皮肤颜色开关

    if (o.type === 'circle') drawCircle(rc, o, radius, color, ci.index, dt, preempt, hitFade);
    else if (o.type === 'slider') drawSlider(rc, o, radius, color, ci.index, dt, preempt, sliderNodeLinger);
    else drawSpinner(rc, o, dt, preempt);
    g.restore();
  }
}

// v340: 物件场景静态层 (键含义见 renderPlayfield 注释)。层裁剪到可见物件内容包围盒 (v246 同款带宽考量),
//   包围盒并入滑条路径点/控制点 + 缩圈外沿 (4r) 边距; 转盘占整游玩区, 直接不裁剪。
let sceneLayer: { key: string; c: HTMLCanvasElement; x: number; y: number; empty: boolean } | null = null;
const bmSeqIds = new WeakMap<Beatmap, number>();
let bmSeqN = 0;

// 可见物件内容包围盒 (osu px, 已含 4r+16 边距); 转盘 → 整游玩区
function sceneContentBBox(bm: Beatmap, drawn: HitObject[], radius: number): { x0: number; y0: number; x1: number; y1: number } {
  const hasSpinner = drawn.some(o => o.type === 'spinner');
  if (hasSpinner) return { x0: -16, y0: -16, x1: 512 + 16, y1: 384 + 16 };
  const pad = radius * 4 + 16;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of drawn) {
    const pts = o.type === 'slider'
      ? [...getSliderPath(bm, o).points, o, ...(o.curvePoints ?? [])]
      : [{ x: o.x, y: o.y }];
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
    }
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

// osu 包围盒 → 设备 px 矩形 (四角变换求外接, 裁剪到画布); 无交集返回 null
function bboxToDevice(m: DOMMatrix, bb: { x0: number; y0: number; x1: number; y1: number }, cw: number, ch: number) {
  let rx = Infinity, ry = Infinity, rx1 = -Infinity, ry1 = -Infinity;
  for (const [cx, cy] of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x0, bb.y1], [bb.x1, bb.y1]] as const) {
    const dx = m.a * cx + m.c * cy + m.e, dy = m.b * cx + m.d * cy + m.f;
    if (dx < rx) rx = dx; if (dy < ry) ry = dy;
    if (dx > rx1) rx1 = dx; if (dy > ry1) ry1 = dy;
  }
  rx = Math.max(0, Math.floor(rx)); ry = Math.max(0, Math.floor(ry));
  const rw = Math.min(cw, Math.ceil(rx1)) - rx, rh = Math.min(ch, Math.ceil(ry1)) - ry;
  return rw > 0 && rh > 0 ? { rx, ry, rw, rh } : null;
}

function drawStaticScene(rc: RenderCtx, visible: HitObject[], radius: number, preempt: number, excl?: Set<number>,
  tr?: { ids: Set<number>; dx: number; dy: number }) {
  const { g, bm } = rc;
  const m = g.getTransform();
  if (tr?.ids.size) excl = tr.ids; // v341: 平移拖拽 — 被拖物件同样不进基层
  let bid = bmSeqIds.get(bm);
  if (bid === undefined) bmSeqIds.set(bm, (bid = ++bmSeqN));
  const sid = skinIds.get(rc.skin) ?? 0;
  // 排除集签名: 顺序无关 (size + id 和), 拖拽期间集合稳定, 每帧比较成本 O(size)
  let exclSize = 0, exclSum = 0;
  if (excl) for (const id of excl) { exclSize++; exclSum = (exclSum + id) | 0; }
  const key = [rc.time, rc.dataKey ?? '', bid, sid, getSkinContentSeq(),
    g.canvas.width, g.canvas.height,
    m.a.toFixed(4), m.b.toFixed(4), m.c.toFixed(4), m.d.toFixed(4), m.e.toFixed(2), m.f.toFixed(2),
    displaySettings.skinColors, displaySettings.sliderPathLine, displaySettings.approachCircle,
    displaySettings.sliderFadeOut, displaySettings.hitExplosion, displaySettings.hitAnimation,
    exclSize, exclSum].join('|');
  // v340 调试: 页面置 window.__sceneDbg = { rebuilds: 0 } 后统计重建次数/键漂移 (profile 脚本用)
  const dbg = (window as unknown as { __sceneDbg?: { rebuilds: number; prevKey: string; diff: string } }).__sceneDbg;
  if (dbg && sceneLayer && sceneLayer.key !== key) {
    dbg.rebuilds++;
    const a = dbg.prevKey.split('|'), b = key.split('|');
    dbg.diff = b.map((s, i) => (s === a[i] ? '' : `${i}:${a[i]}->${s}`)).filter(Boolean).join(' ');
    dbg.prevKey = key;
  } else if (dbg) dbg.prevKey = key;
  if (!sceneLayer || sceneLayer.key !== key) {
    const drawn = excl ? visible.filter(o => !excl.has(o.id)) : visible;
    const dev = bboxToDevice(m, sceneContentBBox(bm, drawn, radius), g.canvas.width, g.canvas.height);
    if (!sceneLayer) sceneLayer = { key, c: document.createElement('canvas'), x: 0, y: 0, empty: true };
    sceneLayer.key = key;
    sceneLayer.x = dev?.rx ?? 0; sceneLayer.y = dev?.ry ?? 0;
    sceneLayer.empty = !dev || !drawn.length;
    const c = sceneLayer.c;
    const rw = dev?.rw ?? 1, rh = dev?.rh ?? 1;
    if (c.width !== Math.max(1, rw) || c.height !== Math.max(1, rh)) { c.width = Math.max(1, rw); c.height = Math.max(1, rh); }
    if (!sceneLayer.empty && dev) {
      const lg = c.getContext('2d')!;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, c.width, c.height);
      lg.setTransform(m.a, m.b, m.c, m.d, m.e - dev.rx, m.f - dev.ry);
      drawSceneObjects({ ...rc, g: lg }, visible, radius, preempt, excl);
    }
  }
  if (!sceneLayer.empty) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(sceneLayer.c, sceneLayer.x, sceneLayer.y);
    g.restore();
  }
  if (tr?.ids.size) {
    // v341: 平移拖拽 — 被拖物件 + 两端都被拖的 follow point 合成独立层, 按 (当前位移 - 构建时位移) 偏移 blit;
    //   恰好一端被拖的跨界连接对实时补画 (会随拖拽拉伸)
    const w = window as unknown as { __dragPath?: string }; w.__dragPath = 'translate'; // 调试
    drawDragLayer(rc, visible, radius, preempt, tr, key);
    drawFollowPoints(rc, radius, undefined, tr.ids, 'xor');
  } else if (excl) {
    const w = window as unknown as { __dragPath?: string }; w.__dragPath = 'live-exclude'; // 调试
    // 被拖物件实时补画 (含其 follow point); 层级略高于静态物件属拖拽期可接受的瞬态差异
    drawSceneObjects(rc, visible, radius, preempt, undefined, excl);
  }
}

// v341: 平移拖拽层 — 内容 = 被拖物件 + 两端都被拖的 follow point, 构建于拖拽首帧 (记录构建时位移 bx/by),
//   键跟随基层 (排除集签名含拖拽 id 集); 拖拽期间每帧 1 次 drawImage (偏移 = 仿射变换后的位移差)
let dragLayer: { key: string; c: HTMLCanvasElement; x: number; y: number; bx: number; by: number; empty: boolean } | null = null;
function drawDragLayer(rc: RenderCtx, visible: HitObject[], radius: number, preempt: number,
  tr: { ids: Set<number>; dx: number; dy: number }, baseKey: string) {
  const { g, bm } = rc;
  const m = g.getTransform();
  const key = baseKey + '|drag';
  if (!dragLayer || dragLayer.key !== key) {
    const drawn = visible.filter(o => tr.ids.has(o.id));
    const dev = bboxToDevice(m, sceneContentBBox(bm, drawn, radius), g.canvas.width, g.canvas.height);
    if (!dragLayer) dragLayer = { key, c: document.createElement('canvas'), x: 0, y: 0, bx: 0, by: 0, empty: true };
    dragLayer.key = key;
    dragLayer.x = dev?.rx ?? 0; dragLayer.y = dev?.ry ?? 0;
    dragLayer.bx = tr.dx; dragLayer.by = tr.dy; // 构建时位移 (物件已按此位移就位)
    dragLayer.empty = !dev || !drawn.length;
    const c = dragLayer.c;
    const rw = dev?.rw ?? 1, rh = dev?.rh ?? 1;
    if (c.width !== Math.max(1, rw) || c.height !== Math.max(1, rh)) { c.width = Math.max(1, rw); c.height = Math.max(1, rh); }
    if (!dragLayer.empty && dev) {
      const lg = c.getContext('2d')!;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, c.width, c.height);
      lg.setTransform(m.a, m.b, m.c, m.d, m.e - dev.rx, m.f - dev.ry);
      drawSceneObjects({ ...rc, g: lg }, visible, radius, preempt, undefined, tr.ids, 'both');
    }
  }
  if (dragLayer.empty) return;
  // osu 位移差 → 设备 px 偏移 (走完整仿射, 平移层只含 scale+translate 时等价 m.a*dx / m.d*dy)
  const ox = m.a * (tr.dx - dragLayer.bx) + m.c * (tr.dy - dragLayer.by);
  const oy = m.b * (tr.dx - dragLayer.bx) + m.d * (tr.dy - dragLayer.by);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(dragLayer.c, dragLayer.x + ox, dragLayer.y + oy);
  g.restore();
}

// v245: 选中装饰离屏层 — 装饰内容与当前时间无关 (位置/堆叠/选区/样式/皮肤/变换决定),
//   合成到离屏位图, 键不变时每帧仅 1 次 drawImage; 编辑/选区/缩放/设置变更经键失效重建。
// v246: 层裁剪到选中物件内容包围盒 (原为整画布尺寸, 大窗口/高 dpr 下每帧全幅 blit 带宽开销大)。
let selLayer: { key: string; c: HTMLCanvasElement; x: number; y: number; bx: number; by: number; empty: boolean } | null = null;
const skinIds = new WeakMap<Skin, number>(); // 皮肤对象 → 序号 (hitcircleselect 等贴图随皮肤整体更换)
let skinSeq = 0;

function drawSelectionLayer(rc: RenderCtx, radius: number) {
  const { g, bm } = rc;
  const m = g.getTransform();
  let sig = 0;
  for (const id of rc.selected) sig = (sig + id) | 0; // 顺序无关选区签名 (id 全局唯一, 和+数量足够)
  let sid = skinIds.get(rc.skin);
  if (!sid) skinIds.set(rc.skin, (sid = ++skinSeq));
  // v341: 平移拖拽中 (selTranslate) 用稳定键 — 拖拽只 bump version 会让 cacheKey 逐帧变,
  //   千件全选拖动装饰层逐帧重建 (实测 40ms+/帧) 是剩余最大热点; 改为构建一次 + 按位移差 blit
  const key = [rc.selTranslate?.key ?? rc.cacheKey ?? '', rc.selected.size, sig, g.canvas.width, g.canvas.height,
    m.a.toFixed(4), m.b.toFixed(4), m.c.toFixed(4), m.d.toFixed(4), m.e.toFixed(2), m.f.toFixed(2),
    displaySettings.selectionStyle, displaySettings.sliderPointStyle, sid].join('|');
  if (!selLayer || selLayer.key !== key) {
    // v246: 内容包围盒 (osu px) — 物件位置/滑条路径点 ± (2r+16) (描边环/头尾选框/控制点柄/堆叠偏移均在内)
    // v302: F02 — 滑条锚点 (贝塞尔控制点) 可远在采样路径包围盒之外 (控制点牵拉曲线但曲线不到达),
    //   只按路径点建层会把锚点/连线裁掉 (hover 预览画在主画布不裁, 选中态画在层上被裁); 包围盒并入控制点
    const pad = radius * 2 + 16;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of bm.hitObjects) {
      if (!rc.selected.has(o.id)) continue;
      const pts = o.type === 'slider'
        ? [...getSliderPath(bm, o).points, o, ...(o.curvePoints ?? [])]
        : [{ x: o.x, y: o.y }];
      for (const p of pts) {
        if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
      }
    }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    // osu 包围盒四角 → 设备 px (m 一般无旋转, 仍按四角变换求外接矩形), 再裁剪到画布
    const cw = g.canvas.width, ch = g.canvas.height;
    let rx = Infinity, ry = Infinity, rx1 = -Infinity, ry1 = -Infinity;
    for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
      const dx = m.a * cx + m.c * cy + m.e, dy = m.b * cx + m.d * cy + m.f;
      if (dx < rx) rx = dx; if (dy < ry) ry = dy;
      if (dx > rx1) rx1 = dx; if (dy > ry1) ry1 = dy;
    }
    rx = Math.max(0, Math.floor(rx)); ry = Math.max(0, Math.floor(ry));
    const rw = Math.min(cw, Math.ceil(rx1)) - rx, rh = Math.min(ch, Math.ceil(ry1)) - ry;
    if (!selLayer) selLayer = { key, c: document.createElement('canvas'), x: 0, y: 0, bx: 0, by: 0, empty: true };
    selLayer.key = key;
    selLayer.x = rx; selLayer.y = ry;
    selLayer.bx = rc.selTranslate?.dx ?? 0; selLayer.by = rc.selTranslate?.dy ?? 0; // v341: 构建时位移 (装饰已按此位移就位)
    selLayer.empty = rw <= 0 || rh <= 0; // 选区完全在画布外 (v223 平移/缩放得再远也不重建不贴图)
    const c = selLayer.c;
    if (c.width !== Math.max(1, rw) || c.height !== Math.max(1, rh)) { c.width = Math.max(1, rw); c.height = Math.max(1, rh); }
    if (!selLayer.empty) {
      const lg = c.getContext('2d')!;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, c.width, c.height);
      lg.setTransform(m.a, m.b, m.c, m.d, m.e - rx, m.f - ry); // 与主画布同一变换 (平移减掉层原点), 装饰按 osu 坐标画进层
      const lrc: RenderCtx = { ...rc, g: lg };
      for (const o of bm.hitObjects) if (rc.selected.has(o.id)) drawSelectionDecor(lrc, o, radius);
    }
  }
  if (selLayer.empty) return;
  // v341: osu 位移差 → 设备 px 偏移 (同 dragLayer); 非拖拽态 bx/by=0 偏移为 0
  const tdx = (rc.selTranslate?.dx ?? 0) - selLayer.bx, tdy = (rc.selTranslate?.dy ?? 0) - selLayer.by;
  const ox = m.a * tdx + m.c * tdy, oy = m.b * tdx + m.d * tdy;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(selLayer.c, selLayer.x + ox, selLayer.y + oy);
  g.restore();
}

// follow points: 连接同 combo 相邻物件 (lazer FollowPointRenderer), 画在物件下层;
// 缩放 = end.Scale (= radius/64, lazer OsuHitObject.OBJECT_RADIUS=64) * 动画缩放;
// maxSize (128x64) 上限 = lazer WithMaximumSize 居中裁剪 (逐轴独立, 非等比缩放), @2x 按 ScaleAdjust 换算;
// 序列帧皮肤 (followpoint-{n}.png): 帧 = floor((time - 该点 fadeInTime) / frameMs) % 帧数
// (lazer SkinnableTextureAnimation: PlaybackPosition = time - AnimationStartTime, 循环)
// v245: followPointPairs 每帧全量重建数组是纯开销 — 对内容只随谱面数据变, 按 bm 引用 + cacheKey 缓存
const fpPairsCache = new WeakMap<Beatmap, { key: string; pairs: { start: HitObject; end: HitObject }[] }>();
function followPointPairsMemo(rc: RenderCtx): { start: HitObject; end: HitObject }[] {
  const hit = fpPairsCache.get(rc.bm);
  const key = rc.cacheKey ?? '';
  if (hit && hit.key === key) return hit.pairs;
  const pairs = followPointPairs(rc.bm);
  fpPairsCache.set(rc.bm, { key, pairs });
  return pairs;
}

function drawFollowPoints(rc: RenderCtx, radius: number, skip?: Set<number>, only?: Set<number>, fpMode: 'either' | 'both' | 'xor' = 'either') {
  const { g, bm, skin, time } = rc;
  const frames = skin.followpointFrames;
  for (const { start, end } of followPointPairsMemo(rc)) {
    // v340: 静态层排除/补画语义 (skip = 跳过触及被拖物件的连接对, only = 只画触及的)
    if (skip && (skip.has(start.id) || skip.has(end.id))) continue;
    if (only) {
      const sIn = only.has(start.id), eIn = only.has(end.id);
      // v341: fpMode — both = 两端都在集合内 (平移拖拽层), xor = 恰好一端 (跨界对实时补画), either = 任一端
      if (fpMode === 'both' ? !(sIn && eIn) : fpMode === 'xor' ? sIn === eIn : !sIn && !eIn) continue;
    }
    for (const p of followPointsBetween(bm, start, end, time, rc.stackOffsets)) {
      if (p.alpha <= 0) continue;
      const img = frames.length > 1
        ? frames[followPointFrameIndex(frames.length, skin.followpointFrameMs, time, p.animStart)]
        : frames.length === 1 ? frames[0] : skin.followpoint;
      const adj = skinScaleAdjust.get(img) ?? 1;
      const c = followPointCrop(img.width, img.height, adj); // lazer WithMaximumSize: 超限居中裁剪
      const k = (radius / 64) * p.scale;
      const w = c.dw * k, h = c.dh * k;
      g.save();
      g.globalAlpha = p.alpha;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.drawImage(img, c.sx, c.sy, c.sw, c.sh, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }
}

// v231: 控制点手柄 — stable = 红/白实心小方格 (~8 屏幕像素宽, 与用户 stable 截图一致; 头尾同尺寸);
// lazer = 圆点 (旧行为: 头 r7, 其余 r6); 红白语义与 #222 描边两模式一致
function drawControlPointHandle(g: CanvasRenderingContext2D, x: number, y: number, isRed: boolean, isHead: boolean) {
  g.fillStyle = isRed ? '#ff5555' : '#ffffff';
  g.strokeStyle = '#222'; g.lineWidth = 1;
  if (displaySettings.sliderPointStyle === 'stable') {
    // 10px 是屏幕像素目标: g 带 dpr×zoom×scale 总变换, 从当前矩阵反算 osu 单位边长与描边宽
    // (实测 5/k 渲染约 4px, 用户对照 stable 截图确认目标 ~8x8 → 边长翻倍为 10/k)
    // v257: 用户反馈仍偏肥 — stable 实测 ~8x8 含描边, 边长改 7/k + 1px 居中描边 ≈ 8px 总宽
    const m = g.getTransform();
    const k = Math.hypot(m.a, m.b) || 1;
    const s = 7 / k;
    g.lineWidth = 1 / k;
    g.fillRect(x - s / 2, y - s / 2, s, s);
    g.strokeRect(x - s / 2, y - s / 2, s, s);
  } else {
    g.beginPath(); g.arc(x, y, isHead ? 7 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}

// v232: stable 选中框 (皮肤 hitcircleselect.png) — 与 hitcircle 族同公式 (stable 同款):
// 128-box 基准, 贴图固有宽度 ÷128 × 圈直径 2r, 默认/128px 贴图恰与圆圈一样大;
// 大贴图按固有尺寸放大 (上限 256 在 hitcircleSpriteWidth 内), @2x 折半在 skinSpriteWidth 登记处已计入; 无图时跳过
// v305: F03 — stable 选中圆环 (皮肤无关) 橙黄环; 取代 v232 的 hitcircleselect 方框
// v308: 改为覆盖圆圈白边 (stable 选中环压在 hitcircle 边框上, 不是在圈外多加一圈)
// v310: 用户指定数值 — 线宽减为 0.14r 的 75% = 0.105r
// v311: 环宽度 = 滑条选中描边带宽 (= 0.925-0.81 = 0.115r)
// v314: 弧半径修正 — v311 误用 r-0.5lw (=0.9425r, 环带实际 0.885r..1.0r 整体偏外, 遮不住蓝边带);
//       蓝边带 = 0.81r..0.925r (见 drawSliderBodyOutline cover), 弧半径应为其中心 0.8675r,
//       环带恰 0.81r..0.925r 与蓝边带逐点重合 (用户反馈: 环过大, 没遮住滑条蓝色选中边框)
// v340: 选中圆环共享 sprite 缓存 — 原实现每物件一次带 shadowBlur 的 arc stroke, 框选上千物件
//   选区变动时装饰层全量重建是实测热点 (shadowBlur 光栅极慢); 环只随半径/颜色/分辨率变, 全局共享。
const ringCache = new Map<string, { c: HTMLCanvasElement; half: number }>();
export function drawSelectionRing(g: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#f5a623') {
  const lw = Math.max(1.5, r * 0.115);
  const m = g.getTransform();
  const q = Math.min(4, Math.max(1, Math.hypot(m.a, m.b) || 1)); // 超采样倍数 (与 sliderBodySprite 同款)
  const rad = r * 0.8675;
  const half = rad + lw / 2 + lw * 0.6 + 2; // 半径 + 线半宽 + 辉光 + 余量 (osu px)
  const key = `${r.toFixed(2)}|${color}|${q.toFixed(2)}`;
  let sp = ringCache.get(key);
  if (!sp) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(half * 2 * q);
    const og = c.getContext('2d')!;
    og.scale(q, q);
    og.translate(half, half);
    og.strokeStyle = color;
    og.lineWidth = lw;
    og.shadowColor = color;
    og.shadowBlur = lw * 0.6; // shadowBlur 是设备 px 语义, 不随 CTM 缩放 (与原实现一致)
    og.beginPath();
    og.arc(0, 0, rad, 0, Math.PI * 2);
    og.stroke();
    sp = { c, half };
    ringCache.set(key, sp);
  }
  g.drawImage(sp.c, x - half, y - half, half * 2, half * 2);
}

// v259: 控制点连线 + 手柄绘制抽为共用 — 选中装饰 (drawSelectionDecor) 与 hover 预览 (EditorCanvas) 复用
// lazer PathControlPointConnection: 用 2px 白线 (PathRadius=1) 依次连接全部控制点,
// 直观呈现贝塞尔/圆弧的控制多边形
// v231: stable 控制点样式时连线改 1 屏幕像素 (与柄同 getTransform 反算); lazer 保持 2 osu 单位
export function drawSliderControlPoints(g: CanvasRenderingContext2D, o: HitObject) {
  const ctrl = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  g.strokeStyle = '#ffffff'; g.globalAlpha *= 0.8;
  if (displaySettings.sliderPointStyle === 'stable') {
    const m = g.getTransform();
    g.lineWidth = 1 / (Math.hypot(m.a, m.b) || 1);
  } else {
    g.lineWidth = 2;
  }
  g.beginPath();
  ctrl.forEach((pt, j) => j === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y));
  g.stroke();
  g.globalAlpha /= 0.8;
  // 可拖拽的控制点手柄: 白色锚点, 重复点(红锚点)为红色
  // v35: 倒序绘制 — 顺序在前的控制点渲染在更上层 (与命中优先级一致: 并列取序号在前);
  // 红锚点重复对只画后一个 (红色), 前一个在正下方被完全遮住故跳过; 头部(idx 0)始终绘制
  for (let idx = ctrl.length - 1; idx >= 0; idx--) {
    const pt = ctrl[idx];
    if (idx > 0 && idx < ctrl.length - 1 && ctrl[idx + 1].x === pt.x && ctrl[idx + 1].y === pt.y) continue;
    const isRed = idx > 1 && ctrl[idx - 1].x === pt.x && ctrl[idx - 1].y === pt.y;
    drawControlPointHandle(g, pt.x, pt.y, isRed, idx === 0); // v231: 样式开关在柄内分支
  }
}

// 选中装饰: 滑条 = 身体高亮环 + 控制多边形 + 控制点手柄; 其他 = 青色虚线环
// v232: selectionStyle=stable 时改 osu!stable 样式; v305: F03 修正 — stable 实为圆环/边框高亮:
//   圆圈类 = 橙黄圆环 (不再用皮肤 hitcircleselect 方框); 滑条 = sliderborder 蓝色高亮描边 + 头尾橙黄圆环
// (滑条控制点连线/手柄两种模式都画, 手柄样式由 v231 开关控制)
function drawSelectionDecor(rc: RenderCtx, o: HitObject, radius: number) {
  const { g, bm } = rc;
  const so = stackOffset(rc, o.id);
  const stableSel = displaySettings.selectionStyle === 'stable'; // v232: 物件选中效果开关
  g.save();
  g.translate(so.dx, so.dy); // 选中高亮与控制点手柄随堆叠偏移整体平移
  if (o.type === 'slider') {
    const p = getSliderPath(bm, o);
    // 选中描边: 沿滑条身外形画一圈高亮环 (v340: 逐滑条 sprite 缓存, 选区变动重建装饰层时 1 次 drawImage)
    // v305: stable = 蓝色边框高亮 (sliderborder 选中变色), lazer 默认 = 青色环
    // v308: stable 改 cover 模式 — 蓝色环带覆盖原白边 (不再外凸一圈), 附外缘辉光
    const osp = p.points.length >= 2
      ? sliderOutlineSprite(p.points, radius, stableSel ? '#4a90e2' : '#4df3ff', stableSel, o.id, g.getTransform().a)
      : null;
    if (osp) g.drawImage(osp.c, osp.dx, osp.dy, osp.w, osp.h);
    if (stableSel) {
      // v305: F03 — 滑条头/尾各画橙黄圆环 (stable 选中效果, 见用户对比截图)
      drawSelectionRing(g, o.x, o.y, radius);
      const tail = p.points[p.points.length - 1];
      if (tail) drawSelectionRing(g, tail.x, tail.y, radius);
    }
    drawSliderControlPoints(g, o); // v259: 抽出共用 (hover 预览同用)
  } else if (stableSel) {
    drawSelectionRing(g, o.x, o.y, radius); // v305: F03 — 单点/spinner 橙黄圆环
  } else {
    g.strokeStyle = '#4df3ff'; g.lineWidth = 2.5;
    g.setLineDash([6, 4]);
    g.beginPath();
    g.arc(o.x, o.y, radius * 1.15, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.restore();
}

// 放置中的滑条预览: 按 lazer SliderPlacementBlueprint 显示真实计算路径的滑条身 (含幻影 cursor 点)
// v219: 滑条身截断到节拍吸附后的预期长度 (lazer: body = ExpectedDistance; 与 finishSlider 落盘/时间轴预览同一 placementLength)
// v318: F24a — skeleton 模式: 滑条身/头部已由注入渲染管线的幽灵滑条完整绘制 (F24a), 这里只画控制骨架 (连线+手柄+幻影点)
function drawPendingSlider(rc: RenderCtx, pend: { x: number; y: number; redAnchor: boolean }[], cursor: { x: number; y: number } | null, distanceLock: boolean, skeleton = false) {
  const { g, bm, skin, time } = rc;
  const r = csToRadius(bm.difficulty.cs);
  const computed = computePendingPath(pend, cursor);
  const { raw } = computed;
  // v201: 放置预览颜色 = 下一个 new combo 的索引; 无物件时首物件索引 = 1 (lazer 生效色从下标 1 起)
  const ciVals = [...rc.comboInfo.values()];
  const useSkin = displaySettings.skinColors;
  const colorIdx = ciVals.length
    ? Math.max(...ciVals.map(c => (useSkin ? c.combo : c.comboWithOffset))) + 1
    : 1;
  const color = comboColor(bm, colorIdx, useSkin ? skin.comboColors : undefined); // v132: 皮肤颜色开关
  const bodyCols = sliderBodyColors(bm, skin, color); // v132
  g.save();
  g.globalAlpha = 0.65;
  if (!skeleton && raw.length > 1) {
    // v219: 预览滑条身按吸附后长度截断 (v218 起 = 当前节拍细分的 1/2); 控制点/连线不截断, 仍随光标实时走
    const expected = placementLength(bm.timingPoints, time, bm.difficulty.sliderMultiplier,
      computed.length, distanceLock, bm.editor.distanceSpacing, bm.editor.beatDivisor);
    const body = sliderBodySprite(truncatePathAtLength(raw, expected), r, bodyCols.border, bodyCols.track, undefined, g.getTransform().a);
    g.drawImage(body.c, body.dx, body.dy, body.w, body.h);
  }
  // 头部 (盒子 = 2r, 与已放置物件一致); v318: skeleton 模式跳过 (幽灵滑条已画头部+数字)
  const head = pend[0];
  const size = r * 2;
  if (!skeleton) {
    // v150: 同 drawCircle — sliderstartcircle 族按贴图固有尺寸显示
    const scw = (img: SkinImage) => size * hitcircleSpriteWidth(img) / 128;
    const sc1 = scw(skin.sliderstartcircle), sc2 = scw(skin.sliderstartcircleoverlay);
    g.drawImage(tintedSprite(skin.sliderstartcircle, color), head.x - sc1 / 2, head.y - sc1 / 2, sc1, sc1);
    g.drawImage(skin.sliderstartcircleoverlay, head.x - sc2 / 2, head.y - sc2 / 2, sc2, sc2);
  }
  // v74: 控制点连线 (与选中滑条一致: lazer PathControlPointConnection 2px 白线)
  // v76: 幻影尾点 (光标处控制点) 也画手柄并接入连线 (lazer 放置预览: 光标即当前滑条尾的控制点)
  const phantom = pendingPhantomPoint(pend, cursor);
  const linePts = phantom ? [...pend, phantom] : pend;
  if (linePts.length > 1) {
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.globalAlpha *= 0.8;
    g.beginPath();
    linePts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.stroke();
    g.globalAlpha /= 0.8;
  }
  // 控制点手柄: 白点/红点 (v231: stable = 方格, lazer = 圆点, 样式开关在柄内分支)
  pend.forEach((p, i) => {
    drawControlPointHandle(g, p.x, p.y, p.redAnchor, i === 0);
  });
  if (phantom) {
    drawControlPointHandle(g, phantom.x, phantom.y, false, false);
  }
  g.restore();
}

// 选中滑条的外形描边: 在离屏画布上按当前变换粗描边, 再 destination-out 镂空, 最后按设备像素贴回主画布
// 默认 (cover=false): 粗描边 (滑条身宽 + 5px) 镂空滑条身区域, 剩下紧贴白边外侧的一圈高亮环 (lazer 风格)
// v308: cover=true (stable) — 环带改为覆盖原白边 (白边带 = 0.8125r..0.922r, 见 paintSliderBody);
//   外缘加 shadowBlur 蓝辉光 (stable 同款)
// v310: 用户嫌 v308 的 0.79r..0.96r 环带仍过粗 — 缩到精确覆盖白边带 (±1% 余量防白边毛刺):
//   描边 0.925r 镂空 0.81r, 剩下 0.81r..0.925r 只是让滑条原有描边变蓝
let outlineCanvas: HTMLCanvasElement | null = null;
// v340: 选中滑条描边逐滑条 sprite 缓存 — drawSliderBodyOutline 每次调用都在「整层尺寸」离屏上
//   清屏+两次粗描边+shadowBlur 合成, 框选几百条滑条时每次选区变动全量重算是实测热点 (D1 场景 ~20ms/帧)。
//   描边内容只随滑条几何/半径/样式变, 按 slider id 缓存包围盒 sprite (invalidatePath 联动失效),
//   装饰层重建退化为逐滑条 1 次 drawImage。
const outlineCache = new Map<number, { sprite: SliderBodySprite; key: string }>();
function sliderOutlineSprite(points: { x: number; y: number }[], r: number, color: string, cover: boolean, cacheId: number, ss: number): SliderBodySprite {
  const pad = r + 5 + 12; // 描边半宽 + 外缘辉光 (shadowBlur 10) 余量
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  let w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  if (!(w > 0) || !(h > 0)) { minX = minY = 0; w = h = 1; } // 退化路径保底
  // v301/v306 同款尺寸上限 (防极端滑条位图打崩 GPU 进程)
  const MAX_DIM = 8192, MAX_AREA = 8192 * 4096;
  const q = Math.min(4, Math.max(0.005, ss, 1), MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
  const key = `${r.toFixed(2)}|${q.toFixed(3)}|${color}|${cover ? 1 : 0}`;
  const hit = outlineCache.get(cacheId);
  if (hit && hit.key === key) return hit.sprite;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * q);
  c.height = Math.ceil(h * q);
  const og = c.getContext('2d')!;
  og.scale(q, q);
  og.translate(-minX + pad, -minY + pad);
  og.lineJoin = 'round'; og.lineCap = 'round';
  const trace = () => {
    og.beginPath();
    points.forEach((p, i) => (i === 0 ? og.moveTo(p.x, p.y) : og.lineTo(p.x, p.y)));
    og.stroke();
  };
  og.strokeStyle = color;
  if (cover) {
    og.lineWidth = r * 2 * 0.925;
    og.shadowColor = color; og.shadowBlur = 10; // 设备 px (sprite 分辨率 q, 1:1 blit 后 = 10 设备 px)
    trace();
    og.shadowBlur = 0;
    og.globalCompositeOperation = 'destination-out';
    og.lineWidth = r * 2 * 0.81;
    trace();
    og.globalCompositeOperation = 'source-over';
  } else {
    og.lineWidth = r * 2 + 5;
    trace();
    og.globalCompositeOperation = 'destination-out';
    og.lineWidth = r * 2 - 1.5;
    trace();
    og.globalCompositeOperation = 'source-over';
  }
  const sprite = { c, dx: minX - pad, dy: minY - pad, w, h };
  outlineCache.set(cacheId, { sprite, key });
  return sprite;
}

export function drawSliderBodyOutline(g: CanvasRenderingContext2D, points: { x: number; y: number }[], r: number, color = '#4df3ff', cover = false) { // v305: 颜色参数 + 导出; v308: cover 参数
  if (points.length < 2) return;
  const w = g.canvas.width, h = g.canvas.height;
  if (!outlineCanvas) outlineCanvas = document.createElement('canvas');
  if (outlineCanvas.width !== w || outlineCanvas.height !== h) { outlineCanvas.width = w; outlineCanvas.height = h; }
  const og = outlineCanvas.getContext('2d')!;
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, w, h);
  og.setTransform(g.getTransform()); // 含 dpr*scale 与堆叠平移, 描边宽度按 osu 坐标系给
  og.lineJoin = 'round'; og.lineCap = 'round';
  const trace = () => {
    og.beginPath();
    points.forEach((p, i) => (i === 0 ? og.moveTo(p.x, p.y) : og.lineTo(p.x, p.y)));
    og.stroke();
  };
  og.strokeStyle = color; // v305: 颜色由调用方给 (默认青 #4df3ff; stable 滑条选中 #4a90e2)
  if (cover) {
    og.lineWidth = r * 2 * 0.925; // v310: 覆盖原白边带 (0.8125r..0.922r) + 微小余量, 不再加粗
    og.shadowColor = color; og.shadowBlur = 10; // 设备 px, 不随 CTM 缩放 — 外缘辉光
    trace();
    og.shadowBlur = 0;
    og.globalCompositeOperation = 'destination-out';
    og.lineWidth = r * 2 * 0.81;
    trace();
    og.globalCompositeOperation = 'source-over';
  } else {
    og.lineWidth = r * 2 + 5;
    trace();
    og.globalCompositeOperation = 'destination-out';
    og.lineWidth = r * 2 - 1.5; // 比滑条身略窄, 避免白边外缘留毛刺
    trace();
    og.globalCompositeOperation = 'source-over';
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(outlineCanvas, 0, 0);
  g.restore();
}

// v133: 视觉间距辅助线 (滑条) — 等距环带描边法: 粗描边 (半径 distR + w/2, 圆角 join/cap) 后
// destination-out 镂空 粗描边 (半径 distR - w/2), 留下宽度 w 的环带, 其中心线距路径恒为 distR。
// canvas round join/cap 的粗描边区域 = 路径与半径 R 圆盘的 Minkowski 和, 对任意滑条类型
// (直线/贝塞尔/完美圆弧/急弯回头) 都是精确等距轮廓 — 内弯自动裁剪, 端帽自动为半圆。
// 取代 v126 折线 miter 偏移 (geometryHelpers.offsetPolyline): 顶点法线 miter 在曲率半径 < 偏移量的
// 内弯处产生尖刺/回折, 曲线滑条轮廓不准; 且描边法无需单独画端帽。代价: 环带为实心 (无法按虚线描边)
export function drawDistanceGuideRing(g: CanvasRenderingContext2D, points: { x: number; y: number }[], distR: number, w: number, style: string) {
  if (points.length < 2) return;
  const cw = g.canvas.width, ch = g.canvas.height;
  if (!outlineCanvas) outlineCanvas = document.createElement('canvas');
  if (outlineCanvas.width !== cw || outlineCanvas.height !== ch) { outlineCanvas.width = cw; outlineCanvas.height = ch; }
  const og = outlineCanvas.getContext('2d')!;
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, cw, ch);
  og.setTransform(g.getTransform()); // 含 dpr*scale 与调用方堆叠平移, 描边宽度按 osu 坐标系给
  og.lineJoin = 'round'; og.lineCap = 'round';
  const trace = (width: number) => {
    og.lineWidth = width;
    og.beginPath();
    points.forEach((p, i) => (i === 0 ? og.moveTo(p.x, p.y) : og.lineTo(p.x, p.y)));
    og.stroke();
  };
  og.strokeStyle = style;
  trace(distR * 2 + w);
  og.globalCompositeOperation = 'destination-out';
  trace(Math.max(0.001, distR * 2 - w));
  og.globalCompositeOperation = 'source-over';
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(outlineCanvas, 0, 0);
  g.restore();
}

function drawSprite(g: CanvasRenderingContext2D, img: SkinImage, x: number, y: number, size: number, rot = 0) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.drawImage(img, -size / 2, -size / 2, size, size);
  g.restore();
}

// v175: 非方形贴图绘制 — 滑条球等宽幅/高幅贴图保持固有宽高比 (压成方形会把球环拉成椭圆)
function drawSpriteRect(g: CanvasRenderingContext2D, img: SkinImage, x: number, y: number, w: number, h: number, rot = 0) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
}

function drawCircle(rc: RenderCtx, o: HitObject, r: number, color: string, num: number, dt: number, preempt: number, hitFade: number) {
  const { g, skin } = rc;
  const so = stackOffset(rc, o.id);
  const x = o.x + so.dx, y = o.y + so.dy; // 堆叠后显示位置
  // lazer LegacyMainCirclePiece: 贴图盒子 = OBJECT_DIMENSIONS = 2r (贴图内边距原样显示, 不做补偿放大)
  const size = r * 2;
  const scale = 1 + hitFade * 0.4; // lazer: 命中后 240ms 放大到 1.4x
  // v150: hitcircle 族按贴图固有尺寸显示 (lazer LegacyMainCirclePiece: AutoSize + WithMaximumSize(256)),
  // 不再拉伸进 2r 盒子 — 150px 贴图显示为盒子的 150/128 倍 (stable 同款, 旧逻辑压回盒子显得偏小)
  const cw = (img: SkinImage) => size * scale * hitcircleSpriteWidth(img) / 128;
  // v200: 暂留模式 (点击特效开 + 打击动画关) 命中后本体变白 (stable 同款: 被击那刻圈体变色,
  // 与 combo 色区分已打过的 note); overlay 原色不变
  const linger = displaySettings.hitExplosion && !displaySettings.hitAnimation;
  const bodyColor = linger && dt >= 0 ? '#ffffff' : color;
  // osu! 着色: hitcircle 白底乘算 combo 色, overlay 原色
  drawSprite(g, tintedSprite(skin.hitcircle, bodyColor), x, y, cw(skin.hitcircle));
  drawSprite(g, skin.hitcircleoverlay, x, y, cw(skin.hitcircleoverlay));
  drawNumber(g, skin, num, x, y, r * 2); // v173: 传 128 盒子 (2r), 数字按贴图固有逻辑尺寸显示 (lazer LegacySpriteText 自然尺寸)
  // v183: 单点在「打击动画」关的暂留模式下命中后缩圈贴边渐隐 (stable 同款)
  drawApproach(g, skin, color, x, y, size, dt, preempt, linger);
}

// 缩圈: 从 4 倍大小收缩到与 note 等大, 透明度随时间淡入; v144: 与 hitcircle 同款按 combo 色乘算染色
// v183: pinAfterHit — 单点专用 (滑条传 false): 「打击动画」关 (stable 编辑器暂留模式) 时命中后
// 缩圈固定贴在圈边, 随本体整体渐隐 (透明度继承 caller 的 g.globalAlpha);
// 打击动画开 / 点击特效关 / 滑条 不贴 (lazer: 命中即消失)
// v195: 贴边前先反弹 — 命中后缩圈以缩小速度向外扩大 APPROACH_BOUNCE 再停住 (见 lifecycle.approachBounceScale)
function drawApproach(g: CanvasRenderingContext2D, skin: Skin, color: string, x: number, y: number, size: number, dt: number, preempt: number, pinAfterHit = false) {
  if (!displaySettings.approachCircle) return; // v132: 显示设置「缩圈」开关
  if (dt >= 0) {
    if (!pinAfterHit) return;
    const pin = size * approachBounceScale(dt, preempt);
    g.drawImage(tintedSprite(skin.approachcircle, color), x - pin / 2, y - pin / 2, pin, pin);
    return;
  }
  const t = Math.max(0, Math.min(1, -dt / preempt)); // 1(刚出现) -> 0(命中)
  const arSize = size * (1 + 3 * t);
  g.save();
  g.globalAlpha *= Math.min(1, (1 - t) * 1.5) * 0.95;
  g.drawImage(tintedSprite(skin.approachcircle, color), x - arSize / 2, y - arSize / 2, arSize, arSize);
  g.restore();
}

// v173: 数字按贴图固有逻辑尺寸显示 (lazer LegacySpriteText: FontUsage size=1 + glyph scale=1/ScaleAdjust = 自然尺寸, 单位 = 128 盒子)
// v174: 补上 OsuLegacySkinTransformer.HitCircleText 的 hitcircle_text_scale = 0.8 (stable 对圈内数字统一乘 0.8) —
//       "数字即圈"皮肤 (default-N = 160x160 整圈, 如 a(No Number)) 160×0.8 = 128 正好一圈大小;
//       (lazer 另有 MaxSizePerGlyph = 320 裁剪超大字形, 极端情况未实现)
//       经典 35x52 数字: box*52*0.8/128, 与 lazer 一致
function drawNumber(g: CanvasRenderingContext2D, skin: Skin, num: number, x: number, y: number, box: number) {
  const s = String(num);
  const glyphs = [...s].map(ch => skin.default0[parseInt(ch)]);
  const TEXT_SCALE = 0.8; // lazer hitcircle_text_scale
  const heights = glyphs.map(gl => box * (gl.height / (skinScaleAdjust.get(gl) ?? 1)) / 128 * TEXT_SCALE);
  const widths = glyphs.map((gl, i) => heights[i] * (gl.width / gl.height));
  let advances: number[];
  if (skin.hitCircleOverlap !== null) {
    // v170: skin.ini [Fonts] HitCircleOverlap — 步进 = 字宽 - overlap (ini 为 1x 逻辑像素, 连同 0.8 换算进盒子单位)
    const ovDraw = skin.hitCircleOverlap * box / 128 * TEXT_SCALE;
    advances = widths.map(w => w - ovDraw);
  } else {
    // lazer 经典皮肤: 字距 = 字宽 + HitCircleOverlap(-2px@128盒子) -> 33/35
    const spacing = 33 / 35;
    advances = widths.map(w => w * spacing);
  }
  const total = advances.slice(0, -1).reduce((a, b) => a + b, 0) + (widths[widths.length - 1] ?? 0);
  let cx = x - total / 2;
  for (let i = 0; i < glyphs.length; i++) {
    g.drawImage(glyphs[i], cx, y - heights[i] / 2, widths[i], heights[i]); // 每个字形各自垂直居中
    cx += advances[i];
  }
}

// v178: osu-framework DefaultEasingFunction Easing.OutElasticHalf (tick 弹入缓动)
export function outElasticHalf(t: number): number {
  const EC = (2 * Math.PI) / 0.3; // elastic_const
  const EC2 = 0.3 / 4; // elastic_const2
  const OFF = Math.pow(2, -10) * Math.sin((0.5 - EC2) * EC); // elastic_offset_half
  return Math.pow(2, -10 * t) * Math.sin((0.5 * t - EC2) * EC) + 1 - OFF * t;
}

// v178: 滑条头被点击后 (dt>=0, 编辑器按 autoplay 于 dt=0 命中) 头圈透明度/缩放 —
// lazer DrawableHitCircle.UpdateHitStateTransforms: 无打击动画 FadeOut(60ms);
// 开「打击动画」时同单点命中爆炸 (240ms 放大到 1.4x 淡出); 关「note点击特效」立即消失
// v203: 暂留模式 (点击特效开+打击动画关) 头圈同单点暂留 — 原大小 HIT_LINGER(800ms) 线性渐隐,
//       不再 60ms 闪没 (用户反馈: 滑条头被打到不会像一般 note 一样暂留)
export function sliderHeadHitState(dt: number): { alpha: number; scale: number } {
  if (dt < 0) return { alpha: 1, scale: 1 };
  if (!displaySettings.hitExplosion) return { alpha: 0, scale: 1 };
  if (displaySettings.hitAnimation) { const hf = Math.min(1, dt / 240); return { alpha: 1 - hf, scale: 1 + 0.4 * hf }; }
  return { alpha: Math.max(0, 1 - dt / HIT_LINGER), scale: 1 };
}

// v215: 暂留模式 (点击特效开 + 打击动画关) 滑条尾圈残留透明度 — 滑条结束时刻视作尾圈命中,
// 原大小 HIT_LINGER(800ms) 线性渐隐 (与单点/滑条头同款), 不随滑条身淡出;
// 非暂留模式/结束前返回 null = 尾圈随滑条身 alpha (旧行为)
export function sliderTailLingerAlpha(dtEnd: number): number | null {
  if (!displaySettings.hitExplosion || displaySettings.hitAnimation) return null;
  if (dtEnd < 0) return null;
  return Math.max(0, 1 - dtEnd / HIT_LINGER);
}

// v204: tick 出现时刻的 preempt — lazer SliderTick.ApplyDefaultsToSelf:
//   TimePreempt = (tickTime - spanStart)/2 + offset; offset = spanIndex>0 ? 200 (含 stable 偏移) : preempt*0.66
// 即首段 tick 在缩圈进程约 2/3 处出现, 后续 span 的 tick 在 span 开始前 200ms 起逐渐出现 (stable 同款)
export function sliderTickPreempt(tickTime: number, spanStart: number, spanIndex: number, preempt: number): number {
  return (tickTime - spanStart) / 2 + (spanIndex > 0 ? 200 : preempt * 0.66);
}

// v178: slider tick 渐进显示 — lazer DrawableSliderTick: FadeIn(ANIM_DURATION=150ms)
// + ScaleTo(0.5→1, 600ms, OutElasticHalf); 球经过后 150ms 淡出 (既有语义保留)。null = 不绘制
// v204: 出现时刻从「tickTime - 整 preempt」改为 lazer SliderTick 的 tick 专属 preempt (见 sliderTickPreempt)
export function sliderTickState(time: number, tickTime: number, spanStart: number, spanIndex: number, preempt: number): { alpha: number; scale: number } | null {
  const showAt = tickTime - sliderTickPreempt(tickTime, spanStart, spanIndex, preempt);
  if (time < showAt || time > tickTime + 150) return null;
  const fadeIn = Math.min(1, (time - showAt) / 150);
  const fadeOut = time <= tickTime ? 1 : 1 - (time - tickTime) / 150;
  const scale = 0.5 + 0.5 * outElasticHalf(Math.min(1, (time - showAt) / 600));
  return { alpha: fadeIn * fadeOut, scale };
}

function drawSlider(rc: RenderCtx, o: HitObject, r: number, color: string, num: number, dt: number, preempt: number, nodeLinger = false) {
  const { g, bm, skin, time } = rc;
  const path = getSliderPath(bm, o);
  const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
  const slideLen = o.length ?? path.totalLength;
  const slides = o.slides ?? 1;
  const duration = slideLen / vel * slides;

  // 堆叠偏移: 滑条身/头尾/折返箭头/tick/滑条球统一平移
  const so = stackOffset(rc, o.id);
  g.save();
  g.translate(so.dx, so.dy);

  g.save();
  // osu! 滑条身: 按 lazer LegacySliderBody 离屏合成分层 (外缘阴影 + sliderBorder 白边 + 半透明轨道)
  g.globalAlpha *= 0.95;
  const bodyCols = sliderBodyColors(bm, skin, color); // v132: 皮肤颜色开关
  const body = sliderBodySprite(path.points, r, bodyCols.border, bodyCols.track, o.id, g.getTransform().a);
  g.drawImage(body.c, body.dx, body.dy, body.w, body.h);
  g.restore();

  // v132: 显示设置「滑条轨迹线」— 沿计算路径在滑条身正中画一条细实线, 方便确认轨迹
  if (displaySettings.sliderPathLine && path.points.length > 1) {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 2; // osu px, 随 CS 缩放的滑条身内保持细线
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    path.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.stroke();
    g.restore();
  }

  // v199: 折返箭头先画 (在头/尾圈之下, 对齐 lazer DrawableSliderRepeat 层级 — 原版箭头压在圈下)
  // 皮肤 reversearrow 朝右直接按切线角旋转 (lazer: 贴图盒子 = 2r)
  // 显示时机对齐 lazer (sliderRepeatAlpha): s=1 随滑条淡入; s>=2 在球经过前一个同侧端点后才渐显;
  // 球到达该端点立即隐藏 —— 避免 slides>=3 时头部箭头与滑条头从一开始就叠在一起
  const size = r * 2;
  const span = slideLen / vel;
  for (let s = 1; s < slides; s++) {
    const a = sliderRepeatAlpha(time, o.time, span, preempt, s);
    if (a <= 0) continue;
    const atEnd = s % 2 === 1;
    const p = path.positionAt(atEnd ? slideLen : 0);
    const pNear = path.positionAt(atEnd ? slideLen - 4 : 4);
    const ang = Math.atan2(pNear.y - p.y, pNear.x - p.x);
    g.globalAlpha *= 0.9 * a;
    drawSprite(g, skin.reversearrow, p.x, p.y, size, ang);
    g.globalAlpha /= 0.9 * a;
  }

  // 头: sliderstartcircle 着色 + overlay 原色 + 数字 (盒子 = 2r, 同 hitcircle)
  // v178: 被点击后 (dt>=0) 头圈按 sliderHeadHitState 淡出/放大, 不再常显
  // v150: sliderstart/endcircle 同按贴图固有尺寸显示 (见 drawCircle)
  const hs = (() => { // v287: 测试游玩 — 头命中爆炸锚定实际命中时刻; 头 miss 直接隐去 (无爆炸)
    if (rc.gameplay) {
      const gi = rc.gameplay.get(o.id);
      if (gi?.state === 'hit') return sliderHeadHitState(time - gi.hitAt);
      if (gi?.state === 'miss') return { alpha: 0, scale: 1 };
    }
    return sliderHeadHitState(dt);
  })();
  if (nodeLinger && dt >= 0) {
    // v215: 暂留模式命中后头圈独立残留 — 不随滑条身 alpha 归零 (短滑条身先没, 头圈继续渐隐);
    //       缩圈同单点贴边 (v183 pinAfterHit), 透明度继承头圈
    if (hs.alpha > 0) {
      const cw = (img: SkinImage) => size * hs.scale * hitcircleSpriteWidth(img) / 128;
      g.save();
      g.globalAlpha = hs.alpha;
      drawSprite(g, tintedSprite(skin.sliderstartcircle, '#ffffff'), o.x, o.y, cw(skin.sliderstartcircle));
      drawSprite(g, skin.sliderstartcircleoverlay, o.x, o.y, cw(skin.sliderstartcircleoverlay));
      drawNumber(g, skin, num, o.x, o.y, size * hs.scale);
      drawApproach(g, skin, color, o.x, o.y, size, dt, preempt, true);
      g.restore();
    }
  } else if (hs.alpha > 0) {
    const cw = (img: SkinImage) => size * hs.scale * hitcircleSpriteWidth(img) / 128;
    // v203: 暂留模式命中后头圈本体同单点变白 (v200 drawCircle 同款)
    const headLinger = displaySettings.hitExplosion && !displaySettings.hitAnimation;
    const headColor = headLinger && dt >= 0 ? '#ffffff' : color;
    g.globalAlpha *= hs.alpha;
    drawSprite(g, tintedSprite(skin.sliderstartcircle, headColor), o.x, o.y, cw(skin.sliderstartcircle));
    drawSprite(g, skin.sliderstartcircleoverlay, o.x, o.y, cw(skin.sliderstartcircleoverlay));
    drawNumber(g, skin, num, o.x, o.y, size * hs.scale);
    g.globalAlpha /= hs.alpha;
    drawApproach(g, skin, color, o.x, o.y, size, dt, preempt);
  } else {
    drawApproach(g, skin, color, o.x, o.y, size, dt, preempt);
  }

  // 尾端 (半透明)
  const endP = path.positionAt(slides % 2 === 0 ? 0 : slideLen);
  const ecw = (img: SkinImage) => size * hitcircleSpriteWidth(img) / 128;
  // v215: 暂留模式尾圈同单点残留 — 滑条结束 = 尾圈命中, 原大小 800ms 线性渐隐 + 变白,
  //       不随滑条身淡出 (旧行为: 滑条身一没尾圈跟着没)
  const tailLinger = nodeLinger ? sliderTailLingerAlpha(time - (o.time + duration)) : null;
  if (tailLinger !== null) {
    if (tailLinger > 0) {
      g.save();
      g.globalAlpha = 0.5 * tailLinger;
      drawSprite(g, tintedSprite(skin.sliderendcircle, '#ffffff'), endP.x, endP.y, ecw(skin.sliderendcircle));
      drawSprite(g, skin.sliderendcircleoverlay, endP.x, endP.y, ecw(skin.sliderendcircleoverlay));
      g.restore();
    }
  } else {
    g.globalAlpha *= 0.5;
    drawSprite(g, tintedSprite(skin.sliderendcircle, color), endP.x, endP.y, ecw(skin.sliderendcircle));
    drawSprite(g, skin.sliderendcircleoverlay, endP.x, endP.y, ecw(skin.sliderendcircleoverlay));
    g.globalAlpha /= 0.5;
  }

  // 身体上的 slidertick 节拍点: v178 渐进显示 (150ms 淡入 + 600ms OutElasticHalf 0.5→1 弹入),
  // 球经过后 150ms 淡出 (既有语义); v204: 出现时刻对齐 lazer SliderTick 公式 (见 sliderTickPreempt)
  for (const t of sliderTickPoints(bm, o)) {
    // v287: 测试游玩 — tick 未跟踪 (miss) 到点即隐去, 不做经过淡出; prehit/命中维持原经过淡出
    if (rc.gameplay) {
      const st = rc.gameplay.get(o.id)?.ticks.get(t.timeMs);
      if (st === 'miss' && time > t.timeMs) continue;
    }
    const ts = sliderTickState(time, t.timeMs, o.time + t.spanIndex * span, t.spanIndex, preempt);
    if (!ts) continue;
    const p = path.positionAt(t.progress * slideLen);
    g.globalAlpha *= ts.alpha * 0.95;
    drawSprite(g, skin.sliderscorepoint, p.x, p.y, r * 0.6 * ts.scale);
    g.globalAlpha /= ts.alpha * 0.95;
  }

  // 滑条球 + 跟随圈 (滑动期间)
  if (dt >= 0 && dt <= duration) {
    const prog = dt * vel;
    const cycle = Math.floor(prog / slideLen);
    let along = prog - cycle * slideLen;
    if (cycle % 2 === 1) along = slideLen - along;
    const bp = path.positionAt(Math.min(along, slideLen));
    // lazer DrawableSliderBall: 球 = 2r, 跟随圈 = FOLLOW_AREA(2.4) x 2r
    // v287: 测试游玩 — 跟随圈仅 tracking (光标在圈内且按住击打键) 时显示
    if (!rc.gameplay || rc.gameplay.get(o.id)?.tracking) drawSprite(g, skin.sliderfollowcircle, bp.x, bp.y, size * 2.4);
    // v131: 滑条球按贴图固有尺寸绘制 (lazer LegacySliderBall: AutoSize = 贴图尺寸);
    // v175: 保持固有宽高比 (v131 用 drawSprite 方形绘制, 宽幅贴图如 kongehund mapping 2.0 的
    //       1500x236 sliderb@2x 会被压成竖椭圆) + 沿路径切线旋转 (stable/lazer: 球随移动方向旋转,
    //       lazer LegacySliderBall "undo rotation on layers which should not be rotated" 即父级带旋转);
    //       上限 = 高 >384 (lazer MAX_FOLLOW_CIRCLE_AREA_SIZE = OBJECT_DIMENSIONS*3) 时等比缩小 (lazer 为居中裁剪, 从简);
    //       未登记固有宽度 (默认皮肤/回退) 按 128x128 = 2r 盒子
    {
      const adjB = skinScaleAdjust.get(skin.sliderb) ?? 1;
      const natW = (skinSpriteWidth.get(skin.sliderb) ?? 128);
      const natH = skinSpriteWidth.has(skin.sliderb) ? skin.sliderb.height / adjB : 128;
      const bk = natH > 384 ? 384 / natH : 1;
      // v176: 补回 CS 缩放因子 — lazer 中球贴图按固有逻辑尺寸置于 DrawableSliderBall 内,
      //       随 DrawableHitObject.Scale (= size/128) 缩放; v175 漏掉导致低 CS 下球比物件大一圈
      const csK = size / 128;
      const alongC = Math.min(along, slideLen);
      const t0 = path.positionAt(Math.max(0, alongC - 1.5));
      const t1 = path.positionAt(Math.min(slideLen, alongC + 1.5));
      const ballAng = Math.atan2(t1.y - t0.y, t1.x - t0.x);
      drawSpriteRect(g, skin.sliderb, bp.x, bp.y, natW * bk * csK, natH * bk * csK, ballAng);
    }
  }
  g.restore(); // 堆叠平移
}

// v125: spinner 缩圈相对转盘的大小比例, 对齐 osu!lazer LegacyOldStyleSpinner.cs:
// 转盘开始前恒定 ~1.4x (SPRITE_SCALE*1.86 相对 disc), 转盘期间 (frac 0→1)
// 线性缩至 ~0.08x (ScaleTo(SPRITE_SCALE*0.1, duration) —— 缩进转盘内部)
export function spinnerApproachRatio(frac: number): number {
  return frac <= 0 ? 1.4 : 1.4 + (0.08 - 1.4) * Math.min(1, frac);
}

// v177: spinner 转盘旋转角度(弧度), 对齐 osu!lazer 两处源码:
// 1) ambient 自转 (DefaultSpinnerDisc.cs updateStateTransforms): 从 preempt/2 前开始,
//    在 (preempt+duration) 内转 25*duration/2000 度 (v125 误作恒定 12.5°/s);
// 2) 转盘期间主动旋转 (OsuAutoGenerator.cs: "0.05 rad/ms, or ~477 RPM[SPM], as per stable") —
//    lazer/stable 实际游玩(autoplay)中光标绕圈驱动 RotationTracker 的转速, 编辑器无输入,
//    按此速率模拟, 结束后保持最终角度
export function spinnerAmbientRotation(dtMs: number, preemptMs: number, durationMs: number): number {
  const ambientRate = (25 * durationMs / 2000) / Math.max(1, preemptMs + durationMs); // °/ms
  const t = Math.max(0, Math.min(dtMs + preemptMs / 2, preemptMs + durationMs));
  const ambient = ambientRate * t;
  const spin = 0.05 * Math.max(0, Math.min(dtMs, durationMs)); // rad
  return spin + (ambient * Math.PI) / 180;
}

function drawSpinner(rc: RenderCtx, o: HitObject, dt: number, preempt: number) {
  const { g, skin } = rc;
  const cx = 256, cy = 192;
  const end = o.endTime ?? o.time;
  const frac = Math.max(0, Math.min(1, dt / Math.max(1, end - o.time)));
  // 背景 (转盘期间压暗全屏)
  g.save();
  g.globalAlpha *= Math.min(1, frac * 4) * 0.75;
  g.drawImage(skin.spinnerBackground, 0, 0, 512, 384);
  g.restore();
  // 转盘主体: v125 恒定大小 (lazer 经典皮肤转盘不缩放), 按 v177 角度自转 (ambient + 477 SPM)
  const size = 360;
  g.globalAlpha *= 0.95;
  // v287: 测试游玩 — 转角由玩家光标绕心累计驱动 (TestPlaySession.accum), 不再 autoplay 模拟;
  //       prehit (lead-back 期间已过的转盘) 回退 autoplay 角度
  const giSpin = rc.gameplay?.get(o.id);
  const spinRot = giSpin && giSpin.state !== 'prehit' ? giSpin.spinRotation : undefined;
  drawSprite(g, skin.spinnerCircle, cx, cy, size, spinRot ?? spinnerAmbientRotation(dt, preempt, Math.max(1, end - o.time)));
  g.globalAlpha /= 0.95;
  // v125 缩圈: 开始前恒定 1.4x, 转盘期间线性缩到 0.08x (lazer LegacyOldStyleSpinner)
  const apSize = size * spinnerApproachRatio(frac);
  g.globalAlpha *= 0.8;
  drawSprite(g, skin.spinnerApproach, cx, cy, apSize);
  g.globalAlpha /= 0.8;
}

// v180: 转盘放置预览 (lazer SpinnerPiece: 放置中 Alpha=0.5; 终点实时跟随编辑器当前时间, 由调用处传入)
export function drawPendingSpinner(rc: RenderCtx, startTime: number, endTime: number, preempt: number) {
  const fake: HitObject = { id: -9, type: 'spinner', x: 256, y: 192, time: startTime, endTime, newCombo: true, comboSkip: 0, hitSound: 0 };
  rc.g.save();
  rc.g.globalAlpha *= 0.5;
  drawSpinner(rc, fake, rc.time - startTime, preempt);
  rc.g.restore();
}

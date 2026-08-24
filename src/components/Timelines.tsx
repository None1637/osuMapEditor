import { useEffect, useRef } from 'react';
import { FastForward, Pause, Play, Rewind, Square, X } from 'lucide-react'; // v181: ⏮/▶/⏸/⏹/⏭/✕ → lucide
import { store, useEditor } from '@/osu/store';
import { timingAt, sliderVelocityAt, type TimingPoint } from '@/osu/parser';
import { computeCombos, comboColor, invalidatePath, mergedWithPreview, objectEndAt } from '@/osu/renderer';
import { beatTicks, TICK_COLORS } from '@/osu/beatTicks';
import { defaultNewPoint } from '@/osu/timingEdit';
import { selectionSpacingInfo, previewSpacingInfo } from '@/osu/spacing';
import { timelineMarkerHit, timelineBarHit, timelineNodeHit, stackInfo, stackLayout } from '@/osu/timelineHit';
import { parseEdgeSounds, resizeEdgeStrings } from '@/osu/edgeSounds'; // v213: 滑条节点音效
import {
  edgeScrollVelocity, edgeScrollRamp, marqueeObjectIds, marqueeGreenTimes, bandHit,
  GREEN_PILL_TOP, PILL_HEIGHT,
} from '@/osu/timelineSelect';
import { pendingSliderTimeline, spinnerPlacementEnd } from '@/osu/sliderPath'; // v188: spinnerPlacementEnd 转盘幻影
import { getSkin } from '@/osu/skin';
import { displaySettings } from '@/osu/displaySettings'; // v132: 显示设置 (皮肤颜色)
import { drawWave, drawSpectro, type SpectroScroll } from '@/osu/waveformDraw';
import { zoomRect, zoomClientX, zoomClientY, zoomDpr } from '@/osu/uiZoom'; // v217: 布局空间绘制/命中
import {
  bpmPillText, svPoints, svPillText, samplePill, pillLayout,
  PILL_RED, PILL_LIME, PILL_PINK, PILL_PINK_ALT, PILL_TEXT,
} from '@/osu/timelinePills';

function fmt(ms: number) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), mm = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

// 上方时间轴 (stable 风格): 物件大圆行 (combo 染色/数字/滑条连体) + 节拍 tick 行
// (小节长白线 / 1/1 白 / 1/2 红 / 1/3 紫 / 1/4 蓝 / 1/6+ 黄) + 红绿 timing 线旗标
const OBJ_H = 60; // 物件行高 (css px)
const RAD = 24;   // 物件圆半径 (stable 大圆)

const hexRgb = (c: string): [number, number, number] => {
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); // 解析器存的是 rgb(r,g,b) 串
  if (m) return [+m[1], +m[2], +m[3]];
  const n = parseInt(c.slice(1), 16); // '#rrggbb'
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** combo 色与深底 (#2e2e38) 混合: 圆/尾端填充 — 比行背景略亮, 白环白数字对比清晰 */
const mixDark = (hex: string, k = 0.55) => {
  const [r, g, b] = hexRgb(hex);
  const m = (c: number, d: number) => Math.round(c * k + d * (1 - k));
  return `rgb(${m(r, 0x2e)},${m(g, 0x2e)},${m(b, 0x38)})`;
};
/** combo 色半透明: 滑条连体条填充 */
const alphaOf = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// v83: 时间轴物件绘制 (真实物件与放置预览幻影共用): 连体条 + 尾圆 + 折返点 + 头圆 (+combo 数字)
interface TimelineObjectStyle {
  fill: string | null;                 // 头/尾圆填充 (null = 不填充, 幻影)
  barFill: string | null;              // 连体条填充 (null = 不画条)
  barStroke: string; barWidth: number; // 连体条描边 (尾圆描边沿用条样式, 与原实现一致)
  headStroke: string; headWidth: number;
  dashed?: boolean;                    // 幻影虚线
  slides?: number;                     // >1 画折返点
  number?: string;                     // 头圆数字 (省略 = 不画)
  dur: boolean;                        // 是否画连体条/尾圆/折返点
  edgeSel?: (k: number) => boolean;    // v213: 节点选中 (k=1..slides 折返点/尾圆加黄环; 头沿用整条选中态)
  edgeSounds?: number[];               // v213: 各节点音效位 (k=0..slides; 节点圆内侧顶部画色点)
}
// v213: hitsound 位 → 色点 (Whistle 绿 / Finish 红 / Clap 蓝, stable 时间轴配色)
const HS_DOTS: [number, string][] = [[2, '#4ddb64'], [4, '#ff5544'], [8, '#55aaff']];
function drawTimelineObject(g: CanvasRenderingContext2D, sx: number, ex: number, cy: number, rad: number, st: TimelineObjectStyle) {
  if (st.dashed) g.setLineDash([6, 4]);
  if (st.dur) {
    // 连体条: 矩形 (两端被头/尾圆覆盖, 圆角胶囊会在尾圆接缝处缺角)
    if (st.barFill) { g.fillStyle = st.barFill; g.fillRect(sx, cy - rad, ex - sx, rad * 2); }
    g.strokeStyle = st.barStroke; g.lineWidth = st.barWidth;
    g.strokeRect(sx, cy - rad, ex - sx, rad * 2);
    // 尾端圆: 与头圆同款 (填充 + 环), 无数字; 描边沿用条的样式
    if (st.fill) { g.fillStyle = st.fill; g.beginPath(); g.arc(ex, cy, rad, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(ex, cy, rad, 0, Math.PI * 2); g.stroke();
    const n = st.slides ?? 1;
    if (st.edgeSel?.(n)) { // v213: 尾节点选中黄环
      g.strokeStyle = '#ffcc22'; g.lineWidth = 3;
      g.beginPath(); g.arc(ex, cy, rad + 2, 0, Math.PI * 2); g.stroke();
    }
    // 折返点: v142 起与滑条尾同款圆圈 (填充 + 环, 描边沿用条样式), 皮肤 reversearrow 画在圆圈上指示方向:
    // 奇数节点在尾端 -> 朝左 (转 π), 偶数节点在头端 -> 朝右 (贴图原向), 与游玩区折返箭头同图同语义
    if (n > 1) {
      const img = getSkin().reversearrow;
      const size = rad * 2; // v205: 箭头与 note 圆等大 (游玩区 reversearrow 盒子 = 2r; 原 1.3rad 偏小)
      for (let s = 1; s < n; s++) {
        const tx = sx + (ex - sx) * s / n;
        if (st.fill) { g.fillStyle = st.fill; g.beginPath(); g.arc(tx, cy, rad, 0, Math.PI * 2); g.fill(); }
        g.beginPath(); g.arc(tx, cy, rad, 0, Math.PI * 2); g.stroke();
        if (st.edgeSel?.(s)) { // v213: 折返节点选中黄环
          g.strokeStyle = '#ffcc22'; g.lineWidth = 3;
          g.beginPath(); g.arc(tx, cy, rad + 2, 0, Math.PI * 2); g.stroke();
        }
        g.save();
        g.translate(tx, cy);
        g.rotate(s % 2 === 1 ? Math.PI : 0);
        g.drawImage(img, -size / 2, -size / 2, size, size);
        g.restore();
      }
    }
  }
  // 头圆
  if (st.fill) { g.fillStyle = st.fill; g.beginPath(); g.arc(sx, cy, rad, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = st.headStroke; g.lineWidth = st.headWidth;
  g.beginPath(); g.arc(sx, cy, rad, 0, Math.PI * 2); g.stroke();
  if (st.dashed) g.setLineDash([]);
  if (st.number) {
    g.fillStyle = '#ffffff';
    g.font = `bold ${rad * 0.85}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(st.number, sx, cy + 1);
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  }
  // v213: 节点音效色点 (圆内侧顶部一排, 避开下方 sample 药丸; 位为 0 不画)
  if (st.edgeSounds) {
    const n = st.dur ? (st.slides ?? 1) : 0;
    for (let k = 0; k < st.edgeSounds.length; k++) {
      const bits = st.edgeSounds[k];
      if (!bits) continue;
      const nx = k === 0 ? sx : k >= n ? ex : sx + (ex - sx) * k / n;
      const on = HS_DOTS.filter(([b]) => bits & b);
      on.forEach(([, col], di) => {
        g.fillStyle = col;
        g.beginPath();
        g.arc(nx + (di - (on.length - 1) / 2) * 7, cy - rad + 4, 2.5, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
}

export function TopTimeline() {
  useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  void useEditor; // 订阅重渲染
  // v32: 时间轴物件拖拽 (改时间, 吸附节拍); anchor 吸附到 tick, 其余选中物件跟随同 delta
  const markerDragRef = useRef<{
    anchorId: number; startX: number; moved: boolean;
    ids: number[]; orig: Map<number, { time: number; endTime?: number }>;
  } | null>(null);
  // v35: 拖滑条尾端改折返次数 (stable/lazer: 时间轴拉长按整 repeat 伸缩, 单次时长不变)
  const tailResizeRef = useRef<{ objId: number; dur: number; moved: boolean } | null>(null);
  // v45: 物件行框选 (css px 坐标; base = 按下时已有选区, Shift 追加)
  // v102: 锚定时间 (lazer TimelineDragBox: 锚边钉在 tAnchor 上, 滚动不丢); 全高度可起手;
  //       scrollAccum = 边缘滚动 ramp 累计 (lazer handleScrollViaDrag); selKey = 选区变更去抖
  const marqueeRef = useRef<{
    tAnchor: number; px0: number; y0: number; x1: number; y1: number;
    base: number[]; baseGreens: number[]; moved: boolean; scrollAccum: number; selKey: string;
  } | null>(null);
  // v102: 绿线药丸拖拽 (按住改时间, 吸附节拍; 未移动单击 = 选中; 双击仍开编辑窗)
  const greenDragRef = useRef<{ tp: TimingPoint; startX: number; origTime: number; lastKey: number; moved: boolean } | null>(null);
  // v127: 频谱滚动缓存 (波形/频谱画在时间轴背景/上层, 面板废弃后缓存移入本组件)
  const spectroScrollRef = useRef<SpectroScroll | null>(null);
  // v138: 上层模式离屏画布 (drawWave/drawSpectro 的 clearRect 只清离屏, 下层时间轴内容不被抹掉)
  const waveTopScratchRef = useRef<HTMLCanvasElement | null>(null);

  const snapMs = (t: number) => {
    const bm = store.beatmap!;
    const { red } = timingAt(bm.timingPoints, t);
    const div = red.beatLength / store.beatSnap;
    return red.time + Math.round((t - red.time) / div) * div;
  };

  const finishMarkerDrag = () => {
    // v102: 绿线药丸拖拽收尾 (moved = 改时间一次 undo; 未移动 = 单击选中, 弹出 beginDrag 空快照)
    const gd = greenDragRef.current;
    if (gd) {
      greenDragRef.current = null;
      store.canvasDragging = false;
      if (gd.moved) { store.commitDrag(); return; }
      store.undo();
      return;
    }
    // v79: 单击 (未拖出矩形) = 仅清空选区; 点击时间轴一律不改变当前时间 (用户反馈: 点击不该 seek)
    const mq = marqueeRef.current;
    if (mq) {
      marqueeRef.current = null;
      store.canvasDragging = false;
      if (!mq.moved) {
        // v80: 单击落空兜底 — 点在连体条中段 = 选中该滑条/转盘 (Shift 追加);
        // 拖动仍走框选 (barHit 只在未拖动单击时查, v50 语义保持)
        const bm = store.beatmap;
        const r = ref.current ? zoomRect(ref.current) : null; // v217: 布局空间
        if (bm && r && mq.y0 <= OBJ_H) {
          const win = 6000 / (bm.editor.timelineZoom || 1);
          const barId = timelineBarHit(bm.hitObjects, objEnd, store.currentTime - win / 2, win, r.width, mq.px0, mq.y0, stackGeomOf(stackInfo(bm.hitObjects))); // v162: 堆叠几何
          if (barId !== null) { store.select([...mq.base, barId]); return; }
        }
        if (!mq.base.length && !mq.baseGreens.length) store.clearSelection();
      }
      return;
    }
    // v35: 拖尾改折返收尾 (v79: 未拖动 = 单击尾端只弹出空快照, 不再 seek 到尾时间)
    const tr = tailResizeRef.current;
    if (tr) {
      tailResizeRef.current = null;
      store.canvasDragging = false;
      if (tr.moved) { store.commitDrag(); return; }
      store.undo();
      // v213: 单击尾端 (未拖动) = 选中尾节点 (stable: 时间轴点尾圆单独加音效)
      const to = store.beatmap?.hitObjects.find(x => x.id === tr.objId);
      if (to?.type === 'slider') store.selectEdges(tr.objId, [to.slides ?? 1]);
      return;
    }
    const md = markerDragRef.current;
    if (!md) return;
    markerDragRef.current = null;
    store.canvasDragging = false;
    if (md.moved) { store.commitDrag(); return; }
    store.undo(); // 未拖动 = 点击: 弹出 beginDrag 空快照 (v79: 不再 seek 到物件时间)
  };

  /** v102: 框选/绿线拖拽共享移动逻辑 (canvas onMouseMove 与 window 兜底共用 — 拖出边界后继续跟踪, lazer ReceivePositionalInputAt 越界语义) */
  const handleDragMove = (cx: number, cy: number) => {
    const r = ref.current ? zoomRect(ref.current) : null; // v217: 布局空间
    if (!r) return;
    const mq = marqueeRef.current;
    if (mq) {
      mq.x1 = cx - r.left; mq.y1 = cy - r.top;
      if (Math.hypot(mq.x1 - mq.px0, mq.y1 - mq.y0) > 3) mq.moved = true;
    }
    const gd = greenDragRef.current;
    const bm = store.beatmap;
    if (gd && bm) {
      if (!gd.moved && Math.abs(cx - gd.startX) <= 4) return;
      gd.moved = true;
      const win = 6000 / (bm.editor.timelineZoom || 1);
      const nt = Math.round(snapMs(gd.origTime + ((cx - gd.startX) / r.width) * win));
      if (nt !== gd.tp.time) {
        gd.tp.time = nt;
        bm.timingPoints.sort((a, b) => a.time - b.time);
        if (store.selectedGreenLines.has(gd.lastKey)) {
          store.selectedGreenLines.delete(gd.lastKey);
          store.selectedGreenLines.add(nt);
        }
        gd.lastKey = nt;
        store.emit();
      }
    }
  };

  // 拖出时间轴 canvas 松开/移动时 React 事件不触发, window 兜底
  useEffect(() => {
    const up = () => finishMarkerDrag();
    const move = (e: MouseEvent) => {
      if (marqueeRef.current || greenDragRef.current) handleDragMove(zoomClientX(e.clientX), zoomClientY(e.clientY));
    };
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', move); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const objEnd = (o: { type: string; time: number; endTime?: number; length?: number; slides?: number }): number => {
    const bm = store.beatmap!;
    // v69: 滑条时长按"合并转换预览后的 timing"推导 — 批量复制勾选复制绿线时, 预览条长 = 应用后效果 (WYSIWYG)
    const prevTp = store.conversionPreview?.timingPoints;
    const tps = prevTp?.length
      ? [...bm.timingPoints, ...prevTp].sort((a, b) => a.time - b.time)
      : bm.timingPoints;
    return objectEndAt(tps, bm.difficulty.sliderMultiplier, o);
  };

  /** v162: 堆叠命中几何 — 仅同刻堆叠件返回 {y, rad} (2D 命中跟着堆叠位置); 非堆叠 undefined = 旧 x-only 行为 */
  const stackGeomOf = (stacks: Map<number, { level: number; count: number }>) => (o: { id: number }) => {
    const si = stacks.get(o.id);
    if (!si || si.count <= 1) return undefined;
    const lay = stackLayout(si.count, OBJ_H, RAD);
    return { y: lay.yOf(si.level), rad: lay.rad };
  };

  /** v127: 波形/频谱层 (背景/上层共用) — 绘制函数内部 setTransform(identity) 按设备像素作画, 完后复位 css px 坐标系;
   *  v138: 上层模式 (onTop=true) 先画到离屏再整体贴回 — drawWave/drawSpectro 内部 clearRect 只清离屏,
   *        不会抹掉下层已画好的时间轴内容 (物件/红绿线经暗化层透出, 波形半透明底 = 旧独立窗口观感);
   *        背景模式下方无内容, 直接画 (clearRect 无害) */
  const drawWaveLayer = (g: CanvasRenderingContext2D, r: { width: number; height: number }, dpr: number, t0: number, win: number, onTop = false) => {
    const buf = store.getAudioBuffer();
    if (!buf) return;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (!onTop) {
      if (store.waveMode === 'wave') drawWave(g, buf, t0, win, W, H, dpr);
      else drawSpectro(g, buf, t0, win, W, H, spectroScrollRef);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    if (!waveTopScratchRef.current) waveTopScratchRef.current = document.createElement('canvas');
    const scratch = waveTopScratchRef.current;
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
    const sg = scratch.getContext('2d')!;
    if (store.waveMode === 'wave') drawWave(sg, buf, t0, win, W, H, dpr);
    else drawSpectro(sg, buf, t0, win, W, H, spectroScrollRef);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(scratch, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** v137: 暗化层 (背景/上层两种模式共用同一层半透明暗色):
   *  波形在下层 -> 暗化波形 (物件/红绿线等内容保持正常亮度);
   *  波形在上层 -> 暗化时间轴内容 (波形全亮盖在最上层) */
  const drawDimOverlay = (g: CanvasRenderingContext2D, r: { width: number; height: number }) => {
    g.fillStyle = 'rgba(8,8,12,0.5)';
    g.fillRect(0, 0, r.width, r.height);
  };

  useEffect(() => {
    const c = ref.current; if (!c) return;
    let raf = 0;
    let lastTs = 0; // v102: 帧间隔 (边缘滚动 ramp/速度积分用)
    const draw = () => {
      const nowTs = performance.now();
      const dtMs = lastTs ? nowTs - lastTs : 16;
      lastTs = nowTs;
      // v152: 播放泵兜底 — 播放位置推进 (currentTime = positionMs) 原本只在 EditorCanvas 的 rAF 循环里做,
      // 而 EditorCanvas 仅 edit 页签挂载; timing/song setup 页签里没人推进, 上下时间轴冻结不滚动
      // (副作用: hitsound 排程也在 positionMs 内, 这些页签里 hitsound 此前同样不响, 一并恢复)。
      // 上时间轴全页签常驻, 在此每帧推进; edit 页签与 EditorCanvas 重复推进同值, 幂等无害
      store.tickClock(); // 暂停中也维持相位跟踪, 保证播放启动即 <1ms (与 EditorCanvas 一致)
      if (store.playing) {
        store.currentTime = store.positionMs();
        if (store.currentTime >= store.songLength()) store.pause();
      }
      const bm = store.beatmap;
      const g = c.getContext('2d')!;
      const r = zoomRect(c); // v217: 布局空间
      const dpr = zoomDpr(); // v217: dpr × zoom (backing = 屏幕物理像素)
      if (c.width !== r.width * dpr) { c.width = r.width * dpr; c.height = r.height * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // v129: 半透明底 — 上时间轴为浮层, 能看到背后游玩的物件
      g.fillStyle = 'rgba(12,12,17,0.72)';
      g.fillRect(0, 0, r.width, r.height);
      if (bm) {
        const win = 6000 / (bm.editor.timelineZoom || 1);
        const t = store.currentTime;
        const t0 = t - win / 2;
        const x = (ms: number) => ((ms - t0) / win) * r.width;
        // v127: 波形/频谱画在时间轴背景 (默认) — 物件/红绿线/tick/药丸等全部时间轴内容在其上层;
        //       waveOnTop=true 时在帧尾改画到内容上层 (见 当前时间针 之后)
        // v137: 背景模式 — 波形上盖同一层半透明暗色 (波形暗化, 时间轴内容保持正常亮度)
        if (store.wavePanelOpen && !store.waveOnTop) { drawWaveLayer(g, r, dpr, t0, win); drawDimOverlay(g, r); }
        // 红/绿 timing 线 (v61: 三角旗 -> 竖线, 对齐 lazer PointVisualisation 竖条语义):
        // lazer 色 Red2 #eb4747 / Lime1 #b2ff66, 全高 2px 竖线, 同刻多条叠放更亮
        // v68: 批量复制"复制绿线"预览 — 副本绿线一并画出 (WYSIWYG)
        const convPrev = store.conversionPreview;
        for (const tp of convPrev?.timingPoints?.length
          ? [...bm.timingPoints, ...convPrev.timingPoints]
          : bm.timingPoints) {
          const tx = x(tp.time);
          if (tx < -4 || tx > r.width + 4) continue;
          g.fillStyle = tp.uninherited ? 'rgba(235,71,71,0.55)' : 'rgba(178,255,102,0.45)';
          g.fillRect(tx - 1, 0, 2, r.height);
        }
        // 分隔线
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath(); g.moveTo(0, OBJ_H + 0.5); g.lineTo(r.width, OBJ_H + 0.5); g.stroke();
        // 物件行: stable 大圆 (combo 染色 + 白环 + combo 数字), 滑条/转盘连体条与圆同宽 + 尾端圆 + 折返点
        const cy = OBJ_H / 2;
        // v44: 转换预览走合并视图 — combo 数字/颜色按合并后列表计算, 与转换应用后一致
        const bmView = mergedWithPreview(bm, convPrev);
        const combos = computeCombos(bmView);
        // v40: 转换预览 — 源物件隐藏, 结果物件以选中样式 (黄环) 一并绘制
        const prevIds = new Set((convPrev?.objects ?? []).map(o => o.id));
        const drawList = bmView.hitObjects;
        // v162: 同刻物件按文件顺序从下往上堆叠 (level 0 = 文件靠前 = 最下); v189: 堆叠不再缩半径
        const stacks = stackInfo(drawList);
        const samplePills: { x: number; text: string; alt: boolean }[] = []; // v53
        // v189: 按时间倒序画 (晚物件先画, 早物件后画压上层, 与游玩区/stable 一致) —
        //       1ms 偏移的叠放 (Aspire) 中早物件不再被晚物件的头圆完全盖住; 同刻组内稳定排序保持文件顺序
        // v197: drawList 本就按时间升序 (parser/store 全程维护), 倒序遍历即可 — 不再每帧 [...all].sort
        //       (4299 物件每帧 nlogn 排序 + 数组分配是实测热点); 倒序迭代 + 窗口早退等价于原 filter+sort
        for (let oi = drawList.length - 1; oi >= 0; oi--) {
          const o = drawList[oi];
          if (o.time > t0 + win) continue; // 更晚的还在窗口外 (倒序头部)
          const end = objEnd(o);
          // 注意不能用 break 早退: 长滑条/转盘的 end 可能远大于起点 (起点在窗口左外但身体仍在窗口内)
          if (end < t0) continue;
          const sx = x(o.time), ex = Math.max(sx, x(end));
          const si = stacks.get(o.id) ?? { level: 0, count: 1 };
          const lay = stackLayout(si.count, OBJ_H, RAD);
          // v53: 粉药丸 (lazer SamplePointPiece): bank 字母 + 音量, 挂在头圆下方
          const sp = samplePill(bm, o);
          samplePills.push({ x: sx, text: sp.text, alt: sp.alt });
          // v213: 节点选区存在时整条不高亮, 只给选中节点画黄环 (stable 时间轴节点选中语义)
          const edgeSel = store.selectedEdges.get(o.id);
          const sel = (store.selected.has(o.id) || prevIds.has(o.id)) && !edgeSel?.size;
          const ci = combos.get(o.id) ?? { combo: 0, comboWithOffset: 0, index: 1 };
          // v201: 皮肤色索引用 combo (ComboIndex), 谱面色用 comboWithOffset (ComboIndexWithOffsets)
          const col = comboColor(bm, displaySettings.skinColors ? ci.combo : ci.comboWithOffset, displaySettings.skinColors ? getSkin().comboColors : undefined); // v31: 按 combo 染色, 不再固定灰; v132: 皮肤颜色开关
          const fill = mixDark(col);
          // v83: 绘制收敛到 drawTimelineObject (与放置预览幻影共用); v162: 堆叠位置/半径
          drawTimelineObject(g, sx, ex, lay.yOf(si.level), lay.rad, {
            fill, barFill: alphaOf(col, 0.35),
            barStroke: sel ? '#ffcc22' : 'rgba(255,255,255,0.55)', barWidth: sel ? 3 : 2,
            // v202: newCombo 不再加粗描边 (lazer/stable 时间轴 NC 无特殊粗环, 加粗看着怪); 仅选中黄环
            headStroke: sel ? '#ffcc22' : 'rgba(255,255,255,0.55)',
            headWidth: sel ? 4 : 2.5,
            slides: o.type === 'slider' ? (o.slides ?? 1) : 1,
            number: String(ci.index), dur: end - o.time > 1,
            // v213: 节点选中黄环 + 节点音效色点
            edgeSel: edgeSel?.size ? (k) => edgeSel.has(k) : undefined,
            edgeSounds: o.type === 'slider' ? parseEdgeSounds(o) : [o.hitSound ?? 0],
          });
        }
        g.textAlign = 'start';
        g.textBaseline = 'alphabetic';
        // v82: 放置中滑条预览 (幻影虚线条: 位置/长度与 finishSlider 落盘规则一致, 含幻影光标点; v83: 绘制走共用 drawTimelineObject)
        if (store.tool === 'slider' && store.pendingSlider.length > 0) {
          const pv = pendingSliderTimeline(bm.timingPoints, bm.difficulty.sliderMultiplier,
            store.pendingSlider, store.pendingCursor, t, store.beatSnap, store.distanceLock, bm.editor.distanceSpacing);
          const psx = x(pv.time), pex = Math.max(psx, x(pv.end));
          if (pex >= -RAD && psx <= r.width + RAD) {
            drawTimelineObject(g, psx, pex, cy, RAD, {
              fill: null, barFill: 'rgba(255,255,255,0.16)',
              barStroke: 'rgba(255,255,255,0.75)', barWidth: 2,
              headStroke: 'rgba(255,255,255,0.75)', headWidth: 2,
              dashed: true, dur: true,
            });
          }
        }
        // v188: 放置中转盘预览 (同滑条幻影: 虚线连体条, 起 = pendingSpinner, 终 = 放置落盘规则 spinnerPlacementEnd)
        if (store.tool === 'spinner' && store.pendingSpinner !== null) {
          const sStart = store.pendingSpinner;
          const sEnd = spinnerPlacementEnd(bm.timingPoints, sStart, t, store.beatSnap);
          const ssx = x(sStart), sex = Math.max(ssx, x(sEnd));
          if (sex >= -RAD && ssx <= r.width + RAD) {
            drawTimelineObject(g, ssx, sex, cy, RAD, {
              fill: null, barFill: 'rgba(255,255,255,0.16)',
              barStroke: 'rgba(255,255,255,0.75)', barWidth: 2,
              headStroke: 'rgba(255,255,255,0.75)', headWidth: 2,
              dashed: true, dur: true,
            });
          }
        }
        // v53: 粉药丸绘制 (头圆下方, 压分隔线垂入 tick 行; 过密时收缩为圆点 — lazer SamplePointContracted)
        {
          g.font = 'bold 10px sans-serif';
          // v190: v189 起物件倒序绘制, 收集到的药丸 x 为降序; pillLayout 依赖升序, 否则全部误判重叠收缩成点
          const items = samplePills.map(p => ({ ...p, w: g.measureText(p.text).width + 10 })).sort((a, b) => a.x - b.x);
          const kinds = pillLayout(items);
          items.forEach((p, i) => {
            g.fillStyle = p.alt ? PILL_PINK_ALT : PILL_PINK;
            if (kinds[i] === 'dot') {
              g.beginPath(); g.arc(p.x, 57, 3, 0, Math.PI * 2); g.fill();
              return;
            }
            g.beginPath(); g.roundRect(p.x - p.w / 2, 50, p.w, 14, 7); g.fill();
            g.fillStyle = PILL_TEXT;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(p.text, p.x, 57.5);
            g.textAlign = 'start'; g.textBaseline = 'alphabetic';
          });
        }
        // 节拍 tick 行: 按 beatSnap 细分, 小节长白线 / 整拍白 / 1/2 红 / 1/3 紫 / 1/4 蓝 / 其他黄
        const tickTop = OBJ_H + 3;
        for (const tick of beatTicks(bm.timingPoints, t0, t0 + win, store.beatSnap)) {
          const tx = x(tick.time);
          if (tx < -2 || tx > r.width + 2) continue;
          const long = tick.level === 'measure';
          g.strokeStyle = TICK_COLORS[tick.level];
          g.globalAlpha = tick.level === 'beat' || long ? 0.9 : 0.8;
          g.lineWidth = long ? 2 : 1.5;
          g.beginPath();
          g.moveTo(tx, tickTop);
          g.lineTo(tx, long ? r.height - 2 : tickTop + (r.height - tickTop) * 0.55);
          g.stroke();
          g.globalAlpha = 1;
        }
        // v53/v61: timing 药丸 (lazer 时间轴标签): 红线 = BPM (红), 全部绿线 = SV 倍率 (绿); 画在 tick 之上
        {
          g.font = 'bold 9.5px sans-serif';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          const drawPill = (px: number, py: number, text: string, bg: string, sel = false) => {
            const w = g.measureText(text).width + 10; // lazer HitObjectPointPiece: Padding=5 两侧
            g.fillStyle = bg;
            g.beginPath(); g.roundRect(px - w / 2, py, w, 13, 6.5); g.fill();
            if (sel) { // v102: 选中绿线 — 与选中物件同款黄色描边
              g.strokeStyle = '#ffcc22'; g.lineWidth = 2;
              g.beginPath(); g.roundRect(px - w / 2, py, w, 13, 6.5); g.stroke();
            }
            g.fillStyle = PILL_TEXT;
            g.fillText(text, px, py + 7);
          };
          for (const tp of bm.timingPoints) {
            if (!tp.uninherited) continue;
            const tx = x(tp.time);
            if (tx < -20 || tx > r.width + 20) continue;
            drawPill(tx, 63, bpmPillText(tp.beatLength), PILL_RED);
          }
          for (const p of svPoints(bm.timingPoints)) {
            const tx = x(p.time);
            if (tx < -20 || tx > r.width + 20) continue;
            drawPill(tx, 76.5, svPillText(p.sv), PILL_LIME, store.selectedGreenLines.has(p.time));
          }
          g.textAlign = 'start'; g.textBaseline = 'alphabetic';
        }
        // v45/v102: 框选 — 矩形与选区更新都在帧循环里做 (边缘滚动时指针不动也要累积选区)
        const mq = marqueeRef.current;
        if (mq) {
          // v102: 边缘自动滚动 (lazer TimelineBlueprintContainer.handleScrollViaDrag:
          // 40px 容差, 速度 sign*min(10,overshoot²), 5s ramp; 播放中不滚 — 视图跟音频钟走)
          if (!store.playing) {
            const v = edgeScrollVelocity(mq.x1, r.width);
            if (v !== 0) {
              mq.scrollAccum += dtMs; // ramp 在速度非 0 时才累计 (lazer: amount==0 时 dragTimeAccumulated 清零)
              store.seek(t + v * edgeScrollRamp(mq.scrollAccum) * dtMs * (win / r.width));
            } else mq.scrollAccum = 0;
          }
          // v102: 时间锚定 (lazer TimelineDragBox): 锚边钉在 tAnchor, 跨滚动累积选中;
          // 物件要求纵跨物件行 (v45), 绿线要求纵跨 SV 药丸带
          const t1 = t0 + (mq.x1 / r.width) * win;
          const msA = Math.min(mq.tAnchor, t1), msB = Math.max(mq.tAnchor, t1);
          const objIds = bandHit(mq.y0, mq.y1, 0, OBJ_H) ? marqueeObjectIds(bm.hitObjects, objEnd, msA, msB) : [];
          const greens = bandHit(mq.y0, mq.y1, GREEN_PILL_TOP, PILL_HEIGHT) ? marqueeGreenTimes(bm.timingPoints, msA, msB) : [];
          const selKey = objIds.join(',') + '|' + greens.join(',');
          if (selKey !== mq.selKey) {
            mq.selKey = selKey;
            store.selectWithGreens([...mq.base, ...objIds], [...mq.baseGreens, ...greens]);
          }
          // 矩形 (锚边 = tAnchor 的当前屏幕位置, 与游玩区同款青色虚线)
          const ax = x(mq.tAnchor);
          const rx = Math.min(ax, mq.x1), ry = Math.min(mq.y0, mq.y1);
          const rw = Math.abs(mq.x1 - ax), rh = Math.abs(mq.y1 - mq.y0);
          g.fillStyle = 'rgba(77,243,255,0.08)';
          g.strokeStyle = 'rgba(77,243,255,0.9)';
          g.lineWidth = 1.5;
          g.setLineDash([5, 4]);
          g.fillRect(rx, ry, rw, rh);
          g.strokeRect(rx, ry, rw, rh);
          g.setLineDash([]);
        }
        // 当前时间针
        g.strokeStyle = '#ff4d6d'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(r.width / 2, 0); g.lineTo(r.width / 2, r.height); g.stroke();
        // v127: 波形/频谱上层模式 — 盖在时间轴内容之上 (canvas 内最上层; 右侧按钮为 DOM 浮层 z-10, 仍在其上)
        // v137: 上层模式 — 先用同一层半透明暗色暗化时间轴内容 (物件/红绿线/tick 等), 波形全亮盖在最上层
        // v138: onTop=true — 波形画到离屏再贴回, 其半透明底透出下层暗化后的内容 (旧独立波形窗口观感)
        if (store.wavePanelOpen && store.waveOnTop) { drawDimOverlay(g, r); drawWaveLayer(g, r, dpr, t0, win, true); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hitTestMarker = (e: React.MouseEvent): number | null => {
    const bm = store.beatmap;
    if (!bm) return null;
    const r = zoomRect(ref.current!); // v217: 布局空间
    if (zoomClientY(e.clientY) - r.top > OBJ_H) return null; // tick 行不选物件, 直接 seek
    const win = 6000 / (bm.editor.timelineZoom || 1);
    const t0 = store.currentTime - win / 2;
    const px = zoomClientX(e.clientX) - r.left;
    const py = zoomClientY(e.clientY) - r.top;
    // v50: 像素阈值 (marker 半径), 且去掉"时长条范围内即选中"的短路 — 旧逻辑里长滑条/转盘的
    // 连体条覆盖物件行大部分区域, 空白处点击总被某个条抢走 (选中最近物件), 框选永远进不去;
    // v79: 命中逻辑抽为纯函数 timelineMarkerHit — 尾圆与头圆同为命中目标
    // (尾圆是可见物件的一部分, 点尾圆应能选中/右键删除), 连体条中段仍不命中 (保住框选)
    // v162: 堆叠件按堆叠位置/缩小半径做 2D 命中; 非堆叠件保持旧 x-only 行为
    return timelineMarkerHit(bm.hitObjects, objEnd, t0, win, r.width, px, RAD, py, stackGeomOf(stackInfo(bm.hitObjects)));
  };

  // v79: seekFromEvent 已移除 — 点击上方时间轴不再改变当前时间 (避免点物件/空白时跳时间)

  // v213: 滑条节点命中 (折返点/尾端圆, 不含头) — 点节点 = 选中该节点, W/E/R 单独加音效 (stable)
  const hitTestNode = (e: React.MouseEvent): { id: number; edge: number } | null => {
    const bm = store.beatmap;
    if (!bm) return null;
    const r = zoomRect(ref.current!); // v217: 布局空间
    if (zoomClientY(e.clientY) - r.top > OBJ_H) return null;
    const win = 6000 / (bm.editor.timelineZoom || 1);
    const t0 = store.currentTime - win / 2;
    return timelineNodeHit(bm.hitObjects, objEnd, o => o.type === 'slider' ? (o.slides ?? 1) : 0,
      t0, win, r.width, zoomClientX(e.clientX) - r.left, RAD, zoomClientY(e.clientY) - r.top, stackGeomOf(stackInfo(bm.hitObjects)));
  };

  // v63: BPM/SV 药丸命中 (绘制同款几何: y=63/76.5 高 13, 宽 = 文本 + 10) — 双击开编辑弹窗
  // v102: 返回 {idx, tp} — 绿线还要支持单击选中/按住拖动 (需要对象引用与种类)
  const hitTestTimingPill = (e: React.MouseEvent): { idx: number; tp: TimingPoint } | null => {
    const bm = store.beatmap; const c = ref.current;
    if (!bm || !c) return null;
    const r = zoomRect(c); // v217: 布局空间
    const mx = zoomClientX(e.clientX) - r.left, my = zoomClientY(e.clientY) - r.top;
    const g = c.getContext('2d')!;
    g.font = 'bold 9.5px sans-serif';
    const win = 6000 / (bm.editor.timelineZoom || 1);
    const t0 = store.currentTime - win / 2;
    const tx = (ms: number) => ((ms - t0) / win) * r.width;
    const inRect = (cx: number, py: number, text: string) => {
      const w = g.measureText(text).width + 10; // lazer HitObjectPointPiece: Padding=5 两侧
      return mx >= cx - w / 2 && mx <= cx + w / 2 && my >= py && my <= py + 13;
    };
    for (let i = 0; i < bm.timingPoints.length; i++) {
      const tp = bm.timingPoints[i];
      if (tp.uninherited && inRect(tx(tp.time), 63, bpmPillText(tp.beatLength))) return { idx: i, tp };
    }
    for (const p of svPoints(bm.timingPoints)) {
      if (inRect(tx(p.time), 76.5, svPillText(p.sv))) {
        const idx = bm.timingPoints.findIndex(tp => !tp.uninherited && tp.time === p.time);
        if (idx >= 0) return { idx, tp: bm.timingPoints[idx] };
      }
    }
    return null;
  };

  // v35: 滑条尾端命中 (css px 阈值, 仅滑条): 拖尾 = 改折返次数, 必须优先于 hitTestMarker (尾时间在物件时长范围内)
  const hitTestTail = (e: React.MouseEvent): number | null => {
    const bm = store.beatmap;
    if (!bm) return null;
    const r = zoomRect(ref.current!); // v217: 布局空间
    if (zoomClientY(e.clientY) - r.top > OBJ_H) return null;
    const win = 6000 / (bm.editor.timelineZoom || 1);
    const t0 = store.currentTime - win / 2;
    const px = zoomClientX(e.clientX) - r.left;
    const py = zoomClientY(e.clientY) - r.top;
    const stacks = stackInfo(bm.hitObjects); // v162
    let best: number | null = null, bestD = 8;
    for (const o of bm.hitObjects) {
      if (o.type !== 'slider') continue;
      const end = objEnd(o);
      if (end < t0 || o.time > t0 + win) continue;
      const dx = ((end - t0) / win) * r.width - px;
      // v162: 堆叠件 2D 命中 (跟着堆叠后的尾圆位置); 非堆叠保持旧 x-only 竖条
      const si = stacks.get(o.id);
      const d = si && si.count > 1
        ? Math.hypot(dx, stackLayout(si.count, OBJ_H, RAD).yOf(si.level) - py)
        : Math.abs(dx);
      if (d < bestD) { bestD = d; best = o.id; }
    }
    return best;
  };

  return (
    <div className="relative">
      <canvas ref={ref} className="w-full h-[92px] cursor-pointer"
        onMouseDown={(e) => {
          if (e.button !== 0) return; // 右键交给 onContextMenu (删除物件), 不能走选中/拖拽预备 (会置 canvasDragging 挡住删除)
          if (store.canvasDragging) return; // 画布拖拽经过 (如拖控制点) 时不响应
          // v35: 拖滑条尾端 -> 改折返次数 (优先于物件拖拽; 尾端在物件时长范围内); v115: 锁定物件禁用
          const tailId = store.lockNotes ? null : hitTestTail(e);
          if (tailId !== null) {
            const bm = store.beatmap!;
            const o = bm.hitObjects.find(x => x.id === tailId)!;
            const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
            const dur = (o.length ?? 0) / vel; // 单次折返时长 (ms)
            if (dur > 0) {
              if (!store.selected.has(tailId)) store.select([tailId]);
              tailResizeRef.current = { objId: tailId, dur, moved: false };
              store.beginDrag();
              store.canvasDragging = true;
              return;
            }
          }
          // v213: 滑条折返点/尾端圆 (拖尾把手 8px 区之外) — 点节点选中该节点, 无拖拽; Shift/Ctrl 同物件内加选
          const nh = hitTestNode(e);
          if (nh) {
            store.selectEdges(nh.id, [nh.edge], e.shiftKey || e.ctrlKey || e.metaKey);
            return;
          }
          const id = hitTestMarker(e);
          if (id !== null) {
            // v32: 选中 + 准备拖拽 (mouseup 未移动才视为点击 seek); v40: Ctrl 同 Shift 切换选中 (对齐 lazer)
            if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleSelect(id);
            else if (!store.selected.has(id)) store.select([id]);
            if (!store.lockNotes) { // v115: 锁定物件 — 可选中, 不可拖动改时间
              const bm = store.beatmap!;
              markerDragRef.current = {
                anchorId: id, startX: zoomClientX(e.clientX), moved: false,
                ids: [...store.selected],
                orig: new Map([...store.selected].map(oid => {
                  const o = bm.hitObjects.find(x => x.id === oid)!;
                  return [oid, { time: o.time, endTime: o.endTime }];
                })),
              };
              store.beginDrag();
              store.canvasDragging = true;
            }
          }
          else {
            // v142: 连体条中段 (滑条/转盘) — 与头/尾圆同款: 选中 + 按住拖动改时间 (吸附节拍)
            // (原仅 mouseup 单击选中/右键删除; 框选仍可从物件行空白处或行下方任意高度起手, v102 全高度语义保持)
            const bmBar = store.beatmap;
            const rBar = zoomRect(ref.current!); // v217: 布局空间
            if (bmBar && zoomClientY(e.clientY) - rBar.top <= OBJ_H) {
              const winBar = 6000 / (bmBar.editor.timelineZoom || 1);
              const barId = timelineBarHit(bmBar.hitObjects, objEnd, store.currentTime - winBar / 2, winBar, rBar.width, zoomClientX(e.clientX) - rBar.left, zoomClientY(e.clientY) - rBar.top, stackGeomOf(stackInfo(bmBar.hitObjects))); // v162: 堆叠几何
              if (barId !== null) {
                if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleSelect(barId);
                else if (!store.selected.has(barId)) store.select([barId]);
                if (!store.lockNotes) { // v115: 锁定物件 — 可选中, 不可拖动改时间
                  markerDragRef.current = {
                    anchorId: barId, startX: zoomClientX(e.clientX), moved: false,
                    ids: [...store.selected],
                    orig: new Map([...store.selected].map(oid => {
                      const o = bmBar.hitObjects.find(x => x.id === oid)!;
                      return [oid, { time: o.time, endTime: o.endTime }];
                    })),
                  };
                  store.beginDrag();
                  store.canvasDragging = true;
                }
                return;
              }
            }
            // v102: 绿线药丸 — 单击选中 (Shift/Ctrl 加选/减选), 按住拖动改时间 (吸附节拍), 双击仍开编辑窗
            const pill = hitTestTimingPill(e);
            if (pill && !pill.tp.uninherited) {
              const t = pill.tp.time;
              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                const s = new Set(store.selectedGreenLines);
                if (s.has(t)) s.delete(t); else s.add(t);
                store.selectGreenLines([...s], true);
              } else if (!store.selectedGreenLines.has(t)) store.selectGreenLines([t]);
              greenDragRef.current = { tp: pill.tp, startX: zoomClientX(e.clientX), origTime: t, lastKey: t, moved: false };
              store.beginDrag();
              store.canvasDragging = true;
              return;
            }
            if (pill) return; // 红线药丸: 单击不动作 (双击开编辑窗), 也不进入框选
            // v45/v102: 空白处按下 -> 框选 (Shift 在现有选区上追加), 与游玩区框选同逻辑;
            // v102: 全高度可起手 (原来仅物件行 OBJ_H 内), 锚定按下时刻 (lazer TimelineDragBox)
            const bm2 = store.beatmap;
            if (bm2) {
              const r = zoomRect(ref.current!); // v217: 布局空间
              const win = 6000 / (bm2.editor.timelineZoom || 1);
              const px = zoomClientX(e.clientX) - r.left, py = zoomClientY(e.clientY) - r.top;
              marqueeRef.current = {
                tAnchor: store.currentTime - win / 2 + (px / r.width) * win,
                px0: px, y0: py, x1: px, y1: py,
                base: e.shiftKey ? [...store.selected] : [],
                baseGreens: e.shiftKey ? [...store.selectedGreenLines] : [],
                moved: false, scrollAccum: 0, selKey: '',
              };
              store.canvasDragging = true;
            }
          }
        }}
        onMouseMove={(e) => {
          // v102: 框选/绿线拖拽走共享移动逻辑 (选区更新在帧循环, 边缘滚动时指针不动也累积)
          if (marqueeRef.current || greenDragRef.current) { handleDragMove(zoomClientX(e.clientX), zoomClientY(e.clientY)); return; }
          // v35: 拖尾改折返次数 (整 repeat 伸缩, 单次时长 dur 不变)
          const tr = tailResizeRef.current;
          if (tr) {
            const bm = store.beatmap;
            const o = bm?.hitObjects.find(x => x.id === tr.objId);
            if (!bm || !o) return;
            const r = zoomRect(ref.current!); // v217: 布局空间
            const win = 6000 / (bm.editor.timelineZoom || 1);
            const ms = store.currentTime - win / 2 + ((zoomClientX(e.clientX) - r.left) / r.width) * win;
            const slides = Math.max(1, Math.min(100, Math.round((ms - o.time) / tr.dur)));
            if (slides !== (o.slides ?? 1)) {
              o.slides = slides; tr.moved = true;
              resizeEdgeStrings(o); // v213: edge 串段数同步 slides+1 (缺段会让播放端 ?? 回落静默错位)
              const es = store.selectedEdges.get(o.id); // v213: 丢弃超出新折返数的节点选区
              if (es) { for (const k of [...es]) if (k > slides) es.delete(k); if (!es.size) store.selectedEdges.delete(o.id); }
              store.emit();
            } // 折返音/尾时间随 slides 重建
            return;
          }
          const md = markerDragRef.current;
          if (md) {
            // v32: 时间轴拖拽改时间 (anchor 吸附节拍, 其余选中物件同 delta 跟随)
            const bm = store.beatmap;
            if (!bm) return;
            if (!md.moved && Math.abs(zoomClientX(e.clientX) - md.startX) <= 4) return;
            md.moved = true;
            const r = zoomRect(ref.current!); // v217: 布局空间
            const win = 6000 / (bm.editor.timelineZoom || 1);
            const dMs = ((zoomClientX(e.clientX) - md.startX) / r.width) * win;
            const anchorOrig = md.orig.get(md.anchorId)!;
            const delta = snapMs(anchorOrig.time + dMs) - anchorOrig.time;
            for (const [oid, o0] of md.orig) {
              const o = bm.hitObjects.find(x => x.id === oid);
              if (!o) continue;
              o.time = Math.round(o0.time + delta);
              if (o0.endTime !== undefined && o.endTime !== undefined) o.endTime = Math.round(o0.endTime + delta);
            }
            bm.hitObjects.sort((a, b) => a.time - b.time);
            store.emit();
            return;
          }
          if (!store.canvasDragging && e.buttons === 0 && ref.current) {
            // v35: 悬停尾端提示可拖; v102: 悬停绿线药丸同样提示可拖
            const pill = hitTestTimingPill(e);
            ref.current.style.cursor = hitTestTail(e) || (pill && !pill.tp.uninherited) ? 'ew-resize' : 'pointer';
          }
          // v79: 移除按住拖动 scrub seek — 点击/拖动时间轴均不改变当前时间
          // v70: 鼠标下的红/绿线 (±4px) -> Timing 页签高亮对应行 (变化才 emitSelection)
          if (!store.canvasDragging && store.beatmap) {
            const bm = store.beatmap;
            const r = zoomRect(ref.current!); // v217: 布局空间
            const win = 6000 / (bm.editor.timelineZoom || 1);
            const t0 = store.currentTime - win / 2;
            const px = zoomClientX(e.clientX) - r.left;
            let best: TimingPoint | null = null, bestD = 4;
            for (const tp of bm.timingPoints) {
              const d = Math.abs(((tp.time - t0) / win) * r.width - px);
              if (d <= bestD) { bestD = d; best = tp; }
            }
            if (best !== store.timelineHoverTp) { store.timelineHoverTp = best; store.emitSelection(); }
          }
        }}
        onMouseUp={finishMarkerDrag}
        onMouseLeave={() => {
          // v70: 移出时间轴清除红/绿线悬停高亮
          if (store.timelineHoverTp) { store.timelineHoverTp = null; store.emitSelection(); }
        }}
        onDoubleClick={(e) => {
          // v63: 双击 BPM/SV 药丸 -> 弹出该线的编辑窗口 (与 +红/+绿 插入同一窗口, 显示全部参数)
          const hit = hitTestTimingPill(e);
          if (!hit) return;
          store.openTimingPointDialog('edit', hit.idx, hit.tp);
        }}
        onContextMenu={(e) => {
          // v31: 右键时间轴物件 -> 删除该物件 (与游玩区四模式右键删除一致)
          e.preventDefault();
          if (store.canvasDragging) return;
          const bm = store.beatmap;
          // v113: 右键绿线药丸 -> 删除 (点在选中绿线上则删全部选中绿线, 否则只删该线; 红线右键不动作)
          const pill = hitTestTimingPill(e);
          if (pill) {
            if (pill.tp.uninherited) return;
            const t = pill.tp.time;
            // v114: 右键已选中绿线 -> 删除整个选区 (物件+绿线); 未选中 -> 只删该线
            if (store.selectedGreenLines.has(t)) store.deleteSelected();
            else store.deleteGreenLinesAt([t]);
            return;
          }
          let id = hitTestMarker(e);
          if (id === null && bm) {
            // v80: 右键兜底 — 连体条中段也可删除 (与单击选中同款 barHit)
            const r = zoomRect(ref.current!); // v217: 布局空间
            if (zoomClientY(e.clientY) - r.top <= OBJ_H) {
              const win = 6000 / (bm.editor.timelineZoom || 1);
              id = timelineBarHit(bm.hitObjects, objEnd, store.currentTime - win / 2, win, r.width, zoomClientX(e.clientX) - r.left, zoomClientY(e.clientY) - r.top, stackGeomOf(stackInfo(bm.hitObjects))); // v162: 堆叠几何
            }
          }
          if (id === null || !bm) return;
          if (store.lockNotes) return; // v115: 锁定物件 — 右键删除物件禁用 (绿线不受影响)
          // v114: 右键已选中物件 -> 删除整个选区 (与游玩区右键一致); 未选中 -> 只删该物件
          if (store.selected.has(id)) { store.deleteSelected(); return; }
          store.pushUndo(); // 一次操作一次 undo; emit bump dataVersion (tick 事件重建)
          bm.hitObjects = bm.hitObjects.filter(o => o.id !== id);
          store.selected.delete(id);
          invalidatePath(id);
          store.emit();
        }}
        onWheel={(e) => {
          const bm = store.beatmap;
          if (!bm) return;
          if (e.ctrlKey) {
            // Ctrl+滚轮: 缩放时间轴 (TimelineZoom)
            const f = e.deltaY > 0 ? 1 / 1.25 : 1.25;
            bm.editor.timelineZoom = Math.max(0.25, Math.min(8, (bm.editor.timelineZoom || 1) * f));
            store.emit();
          } else {
            // v193: 滚轮走 store.wheelSeek (lazer 对齐: 刻度累积; 播放中不吸附大步长 + 轻量重定位, 暂停吸附 1/beatSnap)
            store.wheelSeek(e.deltaY, e.deltaMode);
          }
        }} />
      {/* v127: z-10 保证按钮浮在时间轴 canvas 最上层 — 波形/频谱切到「上层」时也不被遮挡;
          波形显示时加三个钮: 波形图/频谱图 + 背景/上层 + v135 关闭波形/频谱 */}
      <div className="absolute right-1 top-1 flex gap-1 z-10">
        {store.wavePanelOpen && (
          <>
            <button data-wave="mode" className="px-1.5 text-xs rounded bg-emerald-500/40 text-white/85 hover:bg-emerald-500/60" title="切换波形图/频谱图 (显示在时间轴上)"
              onClick={() => store.setWaveMode(store.waveMode === 'wave' ? 'spectro' : 'wave')}>
              {store.waveMode === 'wave' ? '波形图' : '频谱图'}
            </button>
            <button data-wave="layer" className="px-1.5 text-xs rounded bg-emerald-500/40 text-white/85 hover:bg-emerald-500/60" title="切换波形/频谱显示层级: 时间轴背景 / 时间轴上层"
              onClick={() => store.setWaveOnTop(!store.waveOnTop)}>
              {store.waveOnTop ? '上层' : '背景'}
            </button>
            {/* v135: 关闭波形/频谱 (同左侧栏「波形」开关, setWavePanelOpen 持久化记忆) */}
            <button data-wave="close" className="px-1.5 text-xs rounded bg-emerald-500/40 text-white/85 hover:bg-red-500/60 flex items-center" title="关闭波形图/频谱图 (左侧栏「波形」可重新开启)"
              onClick={() => store.setWavePanelOpen(false)}><X className="w-3.5 h-3.5" /></button>
          </>
        )}
        {/* v63: 当前时间插入红/绿线 (默认值克隆生效点 — lazer ControlPointList.addNew) */}
        <button data-tp-add="red" className="px-1.5 text-xs rounded bg-red-500/40 text-white/85 hover:bg-red-500/60" title="在当前时间插入红线 (克隆生效点默认值)"
          onClick={() => { const bm = store.beatmap; if (bm) store.openTimingPointDialog('add', -1, defaultNewPoint(bm.timingPoints, Math.round(store.currentTime), true)); }}>+红</button>
        <button data-tp-add="green" className="px-1.5 text-xs rounded bg-green-500/40 text-white/85 hover:bg-green-500/60" title="在当前时间插入绿线 (克隆生效点默认值)"
          onClick={() => { const bm = store.beatmap; if (bm) store.openTimingPointDialog('add', -1, defaultNewPoint(bm.timingPoints, Math.round(store.currentTime), false)); }}>+绿</button>
        <button className="px-1.5 text-xs rounded bg-black/50 text-white/70 hover:text-white" title="放大 (Ctrl+滚轮)"
          onClick={() => { const bm = store.beatmap; if (bm) { bm.editor.timelineZoom = Math.min(8, (bm.editor.timelineZoom || 1) * 1.25); store.emit(); } }}>+</button>
        <button className="px-1.5 text-xs rounded bg-black/50 text-white/70 hover:text-white" title="缩小 (Ctrl+滚轮)"
          onClick={() => { const bm = store.beatmap; if (bm) { bm.editor.timelineZoom = Math.max(0.25, (bm.editor.timelineZoom || 1) / 1.25); store.emit(); } }}>−</button>
      </div>
    </div>
  );
}

// 下方全局时间轴 + 播放控制
export function BottomTimeline() {
  useEditor();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    let raf = 0;
    const draw = () => {
      const bm = store.beatmap;
      const g = c.getContext('2d')!;
      const r = zoomRect(c); // v217: 布局空间
      const dpr = zoomDpr(); // v217: dpr × zoom (backing = 屏幕物理像素)
      if (c.width !== r.width * dpr) { c.width = r.width * dpr; c.height = r.height * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // v129: 半透明底 — 下时间轴为浮层, 能看到背后游玩的物件
      g.fillStyle = 'rgba(16,16,24,0.7)';
      g.fillRect(0, 0, r.width, r.height);
      if (bm) {
        const len = store.songLength();
        const x = (ms: number) => (ms / len) * r.width;
        // v155: stable 风格全局时间轴 —
        // kiai 橙区 (半高, 垂直居中于中线; v161) → 节拍刻度 (v158) → 红/绿 timing 线 (上半, 1px; v161) → 书签蓝线 (下半, 1px; v161)
        //   → 预览点黄线 (全高, 1px; v161) → 水平中线 (v159) → 物件粉点 (在线上, r=1; v159) → 白色播放头 (v158)
        const mid = r.height * 0.5;
        const greens = bm.timingPoints.filter(tp => !tp.uninherited);
        for (let gi = 0; gi < greens.length; gi++) {
          const tp = greens[gi];
          if (!(tp.effects & 1)) continue; // effects bit0 = kiai
          const x0 = x(tp.time), x1 = x(greens[gi + 1]?.time ?? len);
          g.fillStyle = 'rgba(255,150,30,0.28)';
          g.fillRect(x0, mid / 2, Math.max(1, x1 - x0), mid); // v161: 半高且中心落在中线上 (y = h/4 ~ 3h/4)
        }
        // 节拍刻度 (v158: 对齐 stable — 每拍底部短刻度, 小节首拍更长更亮, 替代原秒刻度)
        {
          const reds = bm.timingPoints.filter(tp => tp.uninherited);
          for (let ri = 0; ri < reds.length; ri++) {
            const rd = reds[ri];
            const segEnd = reds[ri + 1]?.time ?? len;
            const meter = Math.max(1, rd.meter);
            for (let k = 0; ; k++) {
              const t = rd.time + k * rd.beatLength;
              if (t >= segEnd - 1e-6) break;
              const down = k % meter === 0;
              const h = down ? 10 : 5;
              g.fillStyle = down ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
              g.fillRect(x(t), r.height - h, 1, h);
            }
          }
        }
        // timing 点竖线 (红线 = BPM/拍号, 绿线 = SV/音效; v159: 只画中线上方; v161: 1px)
        for (const tp of bm.timingPoints) {
          g.fillStyle = tp.uninherited ? 'rgba(255,85,85,0.8)' : 'rgba(85,221,85,0.65)';
          g.fillRect(x(tp.time), 0, 1, mid);
        }
        // 书签蓝线 (Ctrl+B 添加 / Ctrl+Shift+B 删除; v159: 只画中线下方; v161: 1px)
        g.fillStyle = 'rgba(80,160,255,0.9)';
        for (const b of bm.editor.bookmarks) g.fillRect(x(b), mid, 1, r.height - mid);
        // 预览点黄线 ([General] PreviewTime; v159: 中线上下全高; v161: 1px)
        if (bm.general.previewTime >= 0) {
          g.fillStyle = 'rgba(255,220,60,0.9)';
          g.fillRect(x(bm.general.previewTime), 0, 1, r.height);
        }
        // v159: 水平中线 (stable 样式 — 物件粉点都落在这根线上)
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(0, mid, r.width, 1);
        // 物件粉点 (v155: 粉竖线改粉点; v158: 加亮 0.9; v159: 半径 1 且落在中线上, 对齐 stable)
        g.fillStyle = 'rgba(255,105,180,0.9)';
        for (const o of bm.hitObjects) {
          g.beginPath(); g.arc(x(o.time), mid, 1, 0, Math.PI * 2); g.fill();
        }
        // 播放头 (v158: 对齐 stable — 白色竖线, 不再粉色填充已过区域)
        g.strokeStyle = '#ffffff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x(store.currentTime), 0); g.lineTo(x(store.currentTime), r.height); g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seekFromEvent = (e: React.MouseEvent) => {
    const r = zoomRect(ref.current!); // v217: 布局空间
    store.seek(((zoomClientX(e.clientX) - r.left) / r.width) * store.songLength());
  };

  return (
    <div className="flex items-stretch gap-2 h-20 px-2 py-1.5 bg-[#151520]/70">{/* v129: 背景半透明 */}
      {/* v155: 左侧当前时间 + 进度百分比 (stable 底部时间轴样式; 原右侧时间显示移到此处) */}
      <div className="flex flex-col justify-center shrink-0 font-mono text-xs leading-4 select-none w-24" data-bottom-time>
        <span className="text-white/85">{fmt(store.currentTime)}</span>
        <span className="text-white/45">{store.songLength() > 0 ? (store.currentTime / store.songLength() * 100).toFixed(1) : '0.0'}%</span>
      </div>
      <canvas ref={ref} className="flex-1 cursor-pointer rounded border border-white/10"
        onMouseDown={(e) => { if (!store.canvasDragging) seekFromEvent(e); }} // 画布拖拽经过时不 seek
        onMouseMove={(e) => !store.canvasDragging && e.buttons === 1 && seekFromEvent(e)}
        onWheel={(e) => {
          // v193: 滚轮走 store.wheelSeek (与游玩区/上时间轴同一入口; 原为固定 len/40 与细分无关, v179 起网格步进)
          store.wheelSeek(e.deltaY, e.deltaMode);
        }} />
      <div className="flex items-center gap-1.5 shrink-0">
        {/* 倍速 (lazer PlaybackControl.PlaybackTabControl: 底栏右侧, 25/50/75/100%, 激活加粗) */}
        <div className="flex flex-col items-center gap-0.5 px-1" title="播放速度 (变速不变调 signalsmith-stretch, lazer Tempo)">
          <span className="text-[10px] text-white/40 leading-3">倍速</span>
          <div className="flex rounded overflow-hidden border border-white/10">
            {[0.25, 0.5, 0.75, 1].map(v => (
              <button key={v} data-speed-input={v} onClick={() => store.setRate(v)}
                className={`px-1.5 py-0.5 text-[11px] ${store.playbackRate === v
                  ? 'font-bold text-white bg-white/15'
                  : 'text-white/50 hover:text-white/85 bg-transparent'}`}>
                {v * 100}%
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => store.seek(store.currentTime - 1000)} className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center" title="后退1秒"><Rewind className="w-4 h-4" fill="currentColor" /></button>
        <button onClick={() => store.togglePlay()} className="px-3 py-1.5 rounded bg-pink-500 hover:bg-pink-400 text-white text-sm font-bold w-12 flex items-center justify-center" title="空格">
          {store.playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
        </button>
        <button onClick={() => { store.pause(); store.seek(0); }} className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center" title="回到开头"><Square className="w-4 h-4" fill="currentColor" /></button>
        <button onClick={() => store.seek(store.currentTime + 1000)} className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center" title="前进1秒"><FastForward className="w-4 h-4" fill="currentColor" /></button>
      </div>
    </div>
  );
}

// v45: 右上角选区信息 — 选中首件 (按时间) 坐标 + 前/后间距倍率 (单位同锁定间距 1x,
// 与上方时间轴同行, 见 App.tsx 布局)
export function SelectionInfoPanel() {
  useEditor();
  const bm = store.beatmap;
  const info = bm ? selectionSpacingInfo(bm, store.selected) : null;
  // v145: 无选区且有放置预览幽灵时, 实时显示预览间距 (time 取 currentTime, 与 snapPlacement 放置公式同源);
  // 拖动选中物件时 info 分支因 EditorCanvas 拖动末尾 emitSelection 而实时刷新
  const pv = !info && bm && store.placementPreview ? previewSpacingInfo(bm, store.placementPreview, store.currentTime) : null;
  return (
    <div className="w-40 shrink-0 bg-[#0c0c11]/72 border-l border-white/10 flex flex-col items-end justify-center px-2 font-mono text-[11px] leading-5 text-white/85 select-none whitespace-nowrap">{/* v129: 背景半透明 */}
      {info ? (
        <>
          <div>x:{info.x} y:{info.y}</div>
          {/* v55: 倍率后括号附原始 osu 像素距离, 如 0.00x(0px) */}
          <div className="text-white/60">Prev: <span className="text-cyan-300">{info.prev === null ? '—' : `${info.prev.toFixed(2)}x(${info.prevPx}px)`}</span></div>
          <div className="text-white/60">Next: <span className="text-cyan-300">{info.next === null ? '—' : `${info.next.toFixed(2)}x(${info.nextPx}px)`}</span></div>
        </>
      ) : pv ? (
        <>
          <div>x:{pv.x} y:{pv.y}</div>
          <div className="text-white/60">Prev: <span className="text-cyan-300">{pv.prev === null ? '—' : `${pv.prev.toFixed(2)}x(${pv.prevPx}px)`}</span></div>
          <div className="text-white/60">Next: <span className="text-white/30">—</span></div>
        </>
      ) : (
        <div className="text-white/30">未选中物件</div>
      )}
    </div>
  );
}

// v236: 对称滑条 — 选中单个滑条的全部节点做 轴对称/中心对称/中心旋转 n 次/方向平移 n 次,
//   结果可拼到原滑条头/尾 (一条 curveType='B' 的滑条, 接缝红锚点分段) 或生成独立副本 (join='none')。
// 变换语义:
//   - 节点序列 = [头部 (o.x,o.y), ...curvePoints]; axis/point 恒 1 份, rotate/translate 份数 = count (1..99)
//   - 拼接锚点 joinAnchor: 拼尾/独立副本 = 滑条尾 (sliderTailPoint, 含折返/末端延长语义), 拼头 = 滑条头
//   - axis: 关于一条直线镜像 (镜像公式同 transform.ts reflectObjectsAcrossLine: 垂足 q, 像 = 2q−p);
//     axisDir 三选一: 'v' = 过拼接锚点的竖直线 (左右镜像), 'h' = 过拼接锚点的水平线 (上下镜像),
//     'custom' = axisP1/axisP2 两点决定的直线 (画布可拖拽); 缩放锚点 = 拼接锚点 (轴上点镜像不动, 绕轴缩放仍贴轴)
//   - point: 绕拼接锚点旋转 180°; 缩放锚点 = 拼接锚点 (无额外参数)
//   - rotate: 第 i 份 = 原节点绕锚点 (anchor 字段) 转 i×rotateDeg (度, 顺时针为正)
//   - translate: 第 i 份位移 = i×(dx,dy) + i(i-1)/2×(ddx,ddy) (等差向量, ddx/ddy = 每份向量增量)
//   - 所有份在各自变换后再绕缩放锚点 (axis/point = 拼接锚点; rotate/translate = anchor 字段)
//     缩放 s = 1 + i×scalePerCopy (v116 同款语义; 下限 0.1 防负缩放)
//   - 修正1: axis/point 份节点序列反转 (镜像翻转路径手性, 反转后拼接方向连续); rotate/translate 等距变换不翻手性, 不反转
//   - 二轮修正: join=tail/head 时各份变换 (含反转/缩放) 后整体平移做链式对齐 — 拼尾: 份1首节点对齐原滑条尾
//     (节点序列末点), 份 i 首节点对齐份 i-1 末节点; 拼头: 份 n 末节点对齐原滑条头, 份 i 末节点对齐份 i+1
//     首节点 (i 从大到小)。对齐后所有接缝天然重合 (走红锚点去重分支); 拼头段序列 = [份1..份n, 原] (各份正向,
//     取代初版"拼头逆序+内反转")。join=none 不平移 (各份保持变换原位)。
// v243: 源滑条为圆弧 (curveType='P') 时先整体转贝塞尔 (sliderToBezierSegments+segmentsToPoints,
//   v237 误差驱动减点, 误差 ≤0.2px) 再做对称/拼接 — 否则拼接结果恒 'B', 原弧段直接嵌入会被
//   当成普通贝塞尔控制点 (三点一段折线/二次曲线), 与原圆弧形状不一致; 独立副本也一并转 'B'。
// 拼接 (join='tail'/'head'):
//   - 段序列: 拼尾 = [原, 份1..份n]; 拼头 = [份1..份n, 原]
//   - 接缝处重复坐标点 = 红锚点分段 (segmentsToPoints 同款): 段 k>0 首点先写一次作接缝,
//     与上一段末点本就重合时去重 (重合对即天然红锚点, merge.ts 同款 — 链式对齐后恒重合), 否则首点连写两次形成红锚点对
//   - length = 拼接后路径几何全长 (sliderGeometryLength, 不做节拍吸附)
//   - 时长: 原 duration×(份数+1) — 拼尾 time 不变 endTime 延长; 拼头 endTime 不变 time 提前
//   - slides/newCombo/hitSound/hitSampleRaw 等其余字段保留原值
import type { Beatmap, HitObject, Vec2 } from '../parser';
import { genId } from '../parser';
import { sliderGeometryLength } from '../sliderPath';
import { sliderTailPoint } from '../objectSnap';
import { segmentsToPoints, sliderToBezierSegments } from './bezierPath';

export type SymSliderMode = 'axis' | 'point' | 'rotate' | 'translate';

export interface SymSliderParams {
  mode: SymSliderMode;
  join: 'tail' | 'head' | 'none'; // 拼到原滑条尾/头/不拼(生成独立副本)
  count: number;            // rotate/translate 份数 1..99 (axis/point 恒 1 份)
  axisDir: 'v' | 'h' | 'custom'; // axis: 过拼接锚点的竖直线/水平线, 或 axisP1/axisP2 自定义两点直线
  axisP1: Vec2; axisP2: Vec2; // axis custom: 两点决定的直线 (画布可拖拽)
  anchor: 'tail' | 'head' | 'custom'; // 仅 rotate/translate: 旋转中心 / 缩放锚点 (axis/point 恒用拼接锚点)
  customX: number; customY: number;
  rotateDeg: number;        // rotate: 每份递转角度 (顺时针为正)
  dx: number; dy: number;   // translate: 每份向量
  ddx: number; ddy: number; // translate: 每份向量增量 — 第 i 份位移 = i*(dx,dy) + i*(i-1)/2*(ddx,ddy)
  scalePerCopy: number;     // 每份节点大小增量: 第 i 份变换后坐标相对缩放锚点再缩放 (1 + i×scalePerCopy)
}

export const DEFAULT_SYM_SLIDER_PARAMS: SymSliderParams = {
  mode: 'axis', join: 'tail', count: 2,
  axisDir: 'v', axisP1: { x: 176, y: 192 }, axisP2: { x: 336, y: 192 },
  anchor: 'tail', customX: 256, customY: 192,
  rotateDeg: 90, dx: 0, dy: 0, ddx: 0, ddy: 0, scalePerCopy: 0,
};

const roundPt = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** 锚点解析 (rotate/translate 用): head = 原滑条头; tail = 滑条尾 (sliderTailPoint); custom = 自定义坐标 */
export function symSliderAnchor(bm: Beatmap, o: HitObject, p: SymSliderParams): Vec2 {
  if (p.anchor === 'head') return { x: o.x, y: o.y };
  if (p.anchor === 'custom') return { x: p.customX, y: p.customY };
  return sliderTailPoint(bm, o);
}

/** 第 i 份 (i 从 1 起) 的节点变换: 先做模式变换, 再绕缩放锚点 ×s = 1 + i×scalePerCopy */
function transformNodes(nodes: Vec2[], anchor: Vec2, scaleAnchor: Vec2,
  axis: { p1: Vec2; p2: Vec2 } | null, i: number, p: SymSliderParams): Vec2[] {
  const s = Math.max(0.1, 1 + p.scalePerCopy * i);
  // rotate: 与 duplicate.ts 同公式 (y 向下屏幕坐标系下正角度 = 视觉顺时针)
  const rr = (p.rotateDeg * i * Math.PI) / 180, cos = Math.cos(rr), sin = Math.sin(rr);
  // translate: 第 i 份位移 = i×向量 + i(i-1)/2×向量增量
  const tx = p.dx * i + (p.ddx * i * (i - 1)) / 2, ty = p.dy * i + (p.ddy * i * (i - 1)) / 2;
  // axis: 镜像直线方向 (reflectObjectsAcrossLine 同款, 无需单位化 — t 公式除 len2)
  const ax = axis ? axis.p2.x - axis.p1.x : 0, ay = axis ? axis.p2.y - axis.p1.y : 0;
  const alen2 = ax * ax + ay * ay;
  return nodes.map(n => {
    let px = n.x, py = n.y; // 模式变换后的绝对坐标
    if (p.mode === 'axis' && axis) {
      // 关于直线的镜像: 垂足 q = p1 + d·((n−p1)·d/|d|²), 像 = 2q − n
      const t = ((n.x - axis.p1.x) * ax + (n.y - axis.p1.y) * ay) / alen2;
      px = 2 * (axis.p1.x + t * ax) - n.x;
      py = 2 * (axis.p1.y + t * ay) - n.y;
    } else if (p.mode === 'point') { px = 2 * anchor.x - n.x; py = 2 * anchor.y - n.y; }
    else if (p.mode === 'rotate') {
      const dx = n.x - anchor.x, dy = n.y - anchor.y;
      px = anchor.x + dx * cos - dy * sin; py = anchor.y + dx * sin + dy * cos;
    } else { px = n.x + tx; py = n.y + ty; } // translate
    // 绕缩放锚点缩放 (axis/point = 拼接锚点; rotate/translate = anchor)
    return { x: scaleAnchor.x + (px - scaleAnchor.x) * s, y: scaleAnchor.y + (py - scaleAnchor.y) * s };
  });
}

/**
 * 对称滑条计算 (纯函数, 不改原物件 — 预览/应用由调用方决定)。
 * @returns join='none' → 各份独立副本数组; join='tail'/'head' → 单元素数组 (一条拼接滑条)
 */
export function computeSymSlider(bm: Beatmap, o: HitObject, p: SymSliderParams): HitObject[] {
  if (o.type !== 'slider') return [];
  const count = p.mode === 'rotate' || p.mode === 'translate'
    ? Math.max(1, Math.min(99, Math.round(p.count))) : 1;
  // v243: 圆弧滑条 (P) 先转贝塞尔再变换 — 拼接结果恒 'B', 原弧段不转会被当普通贝塞尔控制点,
  //   形状与原圆弧不一致; 独立副本同样转 'B' 保持几何一致 (转换误差 ≤0.2px, v237 误差驱动)
  let workType = o.curveType ?? 'L';
  let nodes: Vec2[] = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  if (o.curveType === 'P') {
    const pts = segmentsToPoints(sliderToBezierSegments(o)); // 含头部; 段接缝重复点 (红锚点)
    if (pts.length >= 2) { nodes = pts; workType = 'B'; }
  }
  // 拼接锚点: 拼头 = 原滑条头; 拼尾/独立副本 = 滑条尾 (v236 二轮修正: axis/point 的对称中心与缩放锚点恒用它)
  const joinAnchor = p.join === 'head' ? { x: o.x, y: o.y } : sliderTailPoint(bm, o);
  // rotate/translate 用 anchor 字段; point 中心 = 拼接锚点
  const anchor = p.mode === 'point' ? joinAnchor : symSliderAnchor(bm, o, p);
  // axis: 解析对称轴 (v/h = 过拼接锚点, 仅方向有效 — 位置随即被链式对齐覆盖; custom = axisP1/axisP2 两点直线)
  let axis: { p1: Vec2; p2: Vec2 } | null = null;
  if (p.mode === 'axis') {
    if (p.axisDir === 'custom') {
      const ddx = p.axisP2.x - p.axisP1.x, ddy = p.axisP2.y - p.axisP1.y;
      if (ddx * ddx + ddy * ddy < 1e-9) return []; // 自定义轴两点重合 = 轴退化, 不动作 (同 reflectObjectsAcrossLine)
      axis = { p1: { ...p.axisP1 }, p2: { ...p.axisP2 } };
    } else {
      axis = p.axisDir === 'v'
        ? { p1: { x: joinAnchor.x, y: 0 }, p2: { x: joinAnchor.x, y: 1 } }
        : { p1: { x: 0, y: joinAnchor.y }, p2: { x: 1, y: joinAnchor.y } };
    }
  }
  // 缩放锚点: axis/point = 拼接锚点; rotate/translate = anchor 字段
  const scaleAnchor = p.mode === 'axis' || p.mode === 'point' ? joinAnchor : anchor;
  // 修正1: 镜像 (axis/point) 翻转路径手性 — 份节点序列反转, 拼接/独立副本方向连续; rotate/translate 不反转
  const flip = p.mode === 'axis' || p.mode === 'point';
  const copies: Vec2[][] = [];
  for (let i = 1; i <= count; i++) {
    const pts = transformNodes(nodes, anchor, scaleAnchor, axis, i, p).map(roundPt);
    copies.push(flip ? pts.reverse() : pts);
  }

  const orig = nodes.map(pt => ({ ...pt })); // 原节点坐标原样保留 (不重复取整)
  if (p.join !== 'none') {
    // v236 二轮修正: 链式对齐平移 (取整后平移, 整数偏移无需再取整) — 对齐后所有接缝天然重合
    if (p.join === 'tail') {
      // 份1首节点 → 原滑条尾 (节点序列末点), 份 i 首节点 → 份 i-1 末节点
      let base = orig[orig.length - 1];
      for (const pts of copies) {
        const ox = base.x - pts[0].x, oy = base.y - pts[0].y;
        if (ox || oy) for (const q of pts) { q.x += ox; q.y += oy; }
        base = pts[pts.length - 1];
      }
    } else {
      // 份 n 末节点 → 原滑条头, 份 i 末节点 → 份 i+1 首节点 (i 从大到小)
      let base = orig[0];
      for (let i = copies.length - 1; i >= 0; i--) {
        const pts = copies[i];
        const ox = base.x - pts[pts.length - 1].x, oy = base.y - pts[pts.length - 1].y;
        if (ox || oy) for (const q of pts) { q.x += ox; q.y += oy; }
        base = pts[0];
      }
    }
  } else {
    // 独立副本: time/endTime/slides/音效等继承原滑条, length 按各份几何全长重算
    // v243: curveType 用 workType (源为圆弧 P 时副本随转换变 'B')
    return copies.map(pts => ({
      ...o, id: genId(),
      curveType: workType,
      x: pts[0].x, y: pts[0].y,
      curvePoints: pts.slice(1),
      length: Math.round(sliderGeometryLength(workType, pts) * 100) / 100,
    }));
  }

  // 拼接段序列: 拼尾 = [原, 份1..份n]; 拼头 = [份1..份n, 原] (各份正向, 链式对齐后方向顺接)
  const parts: Vec2[][] = p.join === 'tail' ? [orig, ...copies] : [...copies, orig];
  const joined: Vec2[] = [...parts[0]];
  for (let k = 1; k < parts.length; k++) {
    const part = parts[k];
    const last = joined[joined.length - 1];
    const share = last.x === part[0].x && last.y === part[0].y; // 接缝点本就重合 (merge.ts 同款去重; 链式对齐后恒成立)
    joined.push({ ...part[0] }); // 红锚点接缝: 与上一段末点形成同坐标对
    for (let j = share ? 1 : 0; j < part.length; j++) joined.push({ ...part[j] });
  }

  const dur = (o.endTime ?? o.time) - o.time;
  const time = p.join === 'tail' ? o.time : Math.round((o.endTime ?? o.time) - dur * (count + 1));
  const endTime = p.join === 'tail' ? Math.round(o.time + dur * (count + 1)) : (o.endTime ?? o.time);
  return [{
    ...o, id: genId(),
    x: joined[0].x, y: joined[0].y,
    time, endTime,
    curveType: 'B',
    curvePoints: joined.slice(1),
    length: Math.round(sliderGeometryLength('B', joined) * 100) / 100,
  }];
}

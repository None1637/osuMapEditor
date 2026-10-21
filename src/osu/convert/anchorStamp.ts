// v486: 滑条批量插入锚点 (Anchor Stamp) 纯计算层 — 沿主滑条按节拍间隔采样位置/切线,
//   把子滑条 (模板) 的锚点形状旋转对齐后批量"盖章"插入, 生成弹簧状滑条。
// v488: 模板默认垂直于主滑条 (rule.rotate 默认 90°, 相对切线对齐的偏转角, 浮窗可调)。
// 语义 (用户确认):
//   - 保形: 主滑条统一转贝塞尔段后 de Casteljau 剖分 (无损), 未被吞掉的区段形状不变;
//     模板段与主滑条段红锚点硬接 (segmentsToPoints 接缝重复点, 弹簧需要硬角)。
//   - 消除原滑条 a×1/b = 吞掉原路径: 插入点后 erase 拍 (换算弧长) 的原路径段被模板段取代,
//     模板尾接回 erase 末端处的原路径; erase=0 = 纯叠加。
//   - 优先级: 插入位置冲突 (弧长差 < min(两者间隔)/2) 时 priority 数字小者胜出。
//   - 保留时长: o.length 写新几何长度, 头时刻插/改绿线 SV' 保持原时长, 尾时刻按需恢复绿线。
// 零件: sliderToBezierSegments/measureSegments/extractRange/segmentsToPoints (bezierPath.ts,
//   split.ts 同款管线), svForDurationRaw/beatLengthForSv/svRestoreTargetAt (timingSv.ts)。
import { genId, sliderVelocityAt, timingAt, type Beatmap, type HitObject, type TimingPoint, type Vec2 } from '../parser';
import { deCasteljau, extractRange, measureSegments, segmentsToPoints, sliderToBezierSegments, type BezierSeg, type MeasuredSegments } from './bezierPath';
import { sliderGeometryLength } from '../sliderPath';
import { beatLengthForSv, greenLineAt, svAt, svForDurationRaw, svRestoreTargetAt, SV_MAX, SV_MIN } from '../timingSv';

/** 模板 (子滑条) 快照: 绝对坐标控制点列 (头 + curvePoints) + 曲线类型 */
export interface AnchorStampTemplate { curveType: string; points: Vec2[] }

export interface AnchorStampRule {
  /** 优先级 (数字小者高) */
  priority: number;
  /** 活链接: 源滑条 id — 谱面中仍存在时模板取它的实时锚点 (预览期拖源滑条锚点实时联动) */
  srcId: number | null;
  /** 捕获快照 (源滑条删除后回落; 随参数持久化) */
  template: AnchorStampTemplate | null;
  /** 插入间隔 a×1/b 拍 */
  intervalNum: number; intervalDen: number;
  /** v489: 时间偏移 a×1/b 拍 (相位: 首个插入点从头部推移 offset 弧长, 0 = 从 1 个间隔处开始) */
  offsetNum: number; offsetDen: number;
  /** 吞掉原路径 a×1/b 拍 (0 = 纯叠加) */
  eraseNum: number; eraseDen: number;
  /** v488: 相对切线对齐的额外偏转角 (度, 屏幕坐标正角 = 视觉顺时针; 默认 90 = 模板垂直于主滑条) */
  rotate: number;
}

export interface AnchorStampParams { rules: AnchorStampRule[]; keepDuration: boolean }

export const DEFAULT_ANCHOR_STAMP_PARAMS: AnchorStampParams = { rules: [], keepDuration: true };

/** v486: 间隔/消除的分母选项 (用户要求到 1/128; 浮窗本地参数, 不动全局 BEAT_SNAP_OPTIONS) */
export const STAMP_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 72, 96, 128];

export function newRule(priority: number): AnchorStampRule {
  return { priority, srcId: null, template: null, intervalNum: 1, intervalDen: 4, offsetNum: 0, offsetDen: 4, eraseNum: 0, eraseDen: 32, rotate: 90 };
}

/** 捕获滑条为模板快照 (绝对坐标) */
export function captureTemplate(o: HitObject): AnchorStampTemplate {
  return { curveType: o.curveType ?? 'L', points: [{ x: o.x, y: o.y }, ...(o.curvePoints ?? []).map(p => ({ x: p.x, y: p.y }))] };
}

/** 解析模板: srcId 活链接优先 (源滑条存在 → 实时锚点), 否则快照 */
export function resolveTemplate(bm: Beatmap, rule: AnchorStampRule): AnchorStampTemplate | null {
  if (rule.srcId !== null) {
    const o = bm.hitObjects.find(x => x.id === rule.srcId && x.type === 'slider');
    if (o) return captureTemplate(o);
  }
  return rule.template;
}

export interface AnchorStampResult {
  /** 盖章结果滑条 (替换主滑条; 无可盖章规则/无插入点时为 null) */
  object: HitObject | null;
  /** 预览用绿线 (头 SV 线 [改/插] + 可选恢复线; keepDuration 且可反解时非空) */
  svLines: TimingPoint[];
  /** 应用用全量 timing 替换数组 (头绿线改/插 + 恢复线插入, 同刻红先绿后; 无 SV 计划时 null) */
  applyTiming: TimingPoint[] | null;
  /** SV 变化预览 (头时刻旧→新) */
  svPreview: { from: number; to: number } | null;
  /** 实际插入的模板数 */
  stamps: number;
  warnings: string[];
}

/** 弧长 → 位置 (measured 表二分 + de Casteljau) */
function posAt(m: MeasuredSegments, d: number): Vec2 {
  const dd = Math.max(0, Math.min(d, m.total));
  let lo = 0, hi = m.segs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m.cum[mid] <= dd) lo = mid; else hi = mid - 1; }
  const la = dd - m.cum[lo];
  const arr = m.lens[lo], n = m.steps[lo];
  let t: number;
  if (la <= 0) t = 0;
  else if (la >= arr[n]) t = 1;
  else {
    let a = 0, b = n;
    while (a < b - 1) { const mid = (a + b) >> 1; if (arr[mid] <= la) a = mid; else b = mid; }
    const l0 = arr[a], l1 = arr[b];
    t = (a + (l1 > l0 ? (la - l0) / (l1 - l0) : 0)) / n;
  }
  return deCasteljau(m.segs[lo], t);
}

/** 切线角 (中心差分, renderer.ts:1286 同款; 端点退化单侧) */
function tangentAt(m: MeasuredSegments, d: number): number {
  const e = 1.5;
  const a = posAt(m, Math.max(0, d - e)), b = posAt(m, Math.min(m.total, d + e));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** 模板段组变换: 头对齐 pos, 头切线对齐 theta (y 向下屏幕坐标, 正角 = 视觉顺时针) */
function transformTemplate(segs: BezierSeg[], head: Vec2, dTheta: number, pos: Vec2): BezierSeg[] {
  const cos = Math.cos(dTheta), sin = Math.sin(dTheta);
  return segs.map(seg => seg.map(p => {
    const dx = p.x - head.x, dy = p.y - head.y;
    return { x: pos.x + dx * cos - dy * sin, y: pos.y + dx * sin + dy * cos };
  }));
}

/**
 * 计算批量插锚点结果 (纯函数, 不碰谱面)。
 * 主滑条统一转 'B' (P/C/B\<n> 必转贝塞尔, v243 先例; P 有 ≤0.2px 近似); 长度写新几何全长
 * (不走 resnapSliderLength — 它改时长); keepDuration 时 SV 反解保持原时长。
 */
export function computeAnchorStamp(bm: Beatmap, main: HitObject, params: AnchorStampParams): AnchorStampResult {
  const warnings: string[] = [];
  const none: AnchorStampResult = { object: null, svLines: [], applyTiming: null, svPreview: null, stamps: 0, warnings };
  if (main.type !== 'slider') return none;
  const segs = sliderToBezierSegments(main);
  if (!segs.length) { warnings.push('主滑条无有效路径'); return none; }
  const m = measureSegments(segs);
  // 可见行程 = min(o.length, 几何全长) — 超出截断的部分不采样
  const eff = Math.max(0, Math.min(main.length ?? m.total, m.total));
  const red = timingAt(bm.timingPoints, main.time).red;
  const vel = sliderVelocityAt(bm.timingPoints, main.time, bm.difficulty.sliderMultiplier);
  if (eff < 4 || vel <= 0 || red.beatLength <= 0) { warnings.push('主滑条行程过短'); return none; }

  // 每条规则: 采样点列 {d, rule, 模板段, 模板头, 模板切线角}
  interface Stamp { d: number; rule: AnchorStampRule; step: number; segs: BezierSeg[]; head: Vec2; thetaT: number; rot: number; erase: number }
  const stamps: Stamp[] = [];
  for (const rule of params.rules) {
    const tpl = resolveTemplate(bm, rule);
    if (!tpl || tpl.points.length < 2) { warnings.push(`优先级${rule.priority}: 未设置模板 (跳过)`); continue; }
    const stepMs = red.beatLength * rule.intervalNum / Math.max(1, rule.intervalDen);
    const step = stepMs * vel;
    if (step < 1) { warnings.push(`优先级${rule.priority}: 间隔过小 (跳过)`); continue; }
    const tObj: HitObject = { ...main, x: tpl.points[0].x, y: tpl.points[0].y, curveType: tpl.curveType, curvePoints: tpl.points.slice(1) };
    const tSegs = sliderToBezierSegments(tObj);
    if (!tSegs.length) { warnings.push(`优先级${rule.priority}: 模板路径无效 (跳过)`); continue; }
    const tm = measureSegments(tSegs);
    const thetaT = tangentAt(tm, 0);
    // v488: 额外偏转角 (旧存档无 rotate 字段 → 回退 90° 垂直默认)
    const rot = (Number.isFinite(rule.rotate) ? rule.rotate : 90) * Math.PI / 180;
    const erase = red.beatLength * rule.eraseNum / Math.max(1, rule.eraseDen) * vel;
    // v489: 时间偏移 (相位; 旧存档无 offset 字段 → 0; d<1px 的头部点跳过, offset=0 时行为同 v486 从 1 间隔起)
    const offNum = Number.isFinite(rule.offsetNum) ? rule.offsetNum : 0;
    const offDen = Number.isFinite(rule.offsetDen) ? rule.offsetDen : 4;
    const offset = red.beatLength * offNum / Math.max(1, offDen) * vel;
    for (let d = offset; d < eff - 1e-6; d += step) {
      if (d < 1) continue;
      stamps.push({ d, rule, step, segs: tSegs, head: tpl.points[0], thetaT, rot, erase });
    }
  }
  if (!stamps.length) { warnings.push('无可插入的锚点 (检查模板与间隔)'); return none; }

  // 优先级去重: d 升序贪心, 冲突窗 (min 两者间隔 /2) 内保留 priority 小者
  stamps.sort((a, b) => a.d - b.d || a.rule.priority - b.rule.priority);
  const kept: Stamp[] = [];
  for (const s of stamps) {
    const clash = kept.some(k => Math.abs(k.d - s.d) < Math.min(k.step, s.step) / 2 && k.rule.priority <= s.rule.priority);
    if (!clash) kept.push(s);
  }

  // 组装: 原路径段与模板段交替, 吞除区间跳过; 被上一印章吞掉的插入点丢弃
  const out: BezierSeg[] = [];
  let cursor = 0, used = 0;
  for (const s of kept) {
    if (s.d < cursor - 1e-6) continue; // 落在前一印章的吞除区
    out.push(...extractRange(m, cursor, s.d));
    const theta = tangentAt(m, s.d);
    out.push(...transformTemplate(s.segs, s.head, theta - s.thetaT + s.rot, posAt(m, s.d)));
    cursor = s.d + s.erase;
    used++;
  }
  out.push(...extractRange(m, cursor, eff));
  if (!used) { warnings.push('插入点全部被吞除区覆盖'); return none; }

  // 写回: 取整 (.osu 惯例; 重复点同源取整仍相等, 红锚点语义保持)
  const pts = segmentsToPoints(out).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  if (pts.length < 2) { warnings.push('结果路径退化'); return none; }
  const newLen = sliderGeometryLength('B', pts);
  const object: HitObject = {
    ...main, id: genId(), curveType: 'B', x: pts[0].x, y: pts[0].y,
    curvePoints: pts.slice(1), length: newLen,
  };

  // SV 保持时长: 原时长 = eff × slides / velocity; svReq 反解, 越界钳 + 警告
  let svLines: TimingPoint[] = [], applyTiming: TimingPoint[] | null = null, svPreview: AnchorStampResult['svPreview'] = null;
  if (params.keepDuration) {
    const slides = main.slides ?? 1;
    const dur0 = eff * slides / vel;
    const svReq = svForDurationRaw(newLen, slides, red.beatLength, bm.difficulty.sliderMultiplier, dur0);
    if (svReq !== null && Number.isFinite(svReq)) {
      const svTo = Math.min(SV_MAX, Math.max(SV_MIN, svReq));
      if (svTo !== svReq) warnings.push(`所需 SV ${svReq.toFixed(2)} 超出 ${SV_MIN}~${SV_MAX}, 已钳制 (时长会变化)`);
      const svFrom = svAt(bm.timingPoints, main.time);
      svPreview = { from: svFrom, to: svTo };
      const headGreen = greenLineAt(bm.timingPoints, main.time);
      const headLine: TimingPoint = headGreen
        ? { ...headGreen, beatLength: beatLengthForSv(svTo) }
        : { time: main.time, beatLength: beatLengthForSv(svTo), meter: red.meter, sampleSet: red.sampleSet, sampleIndex: red.sampleIndex, volume: red.volume, uninherited: false, effects: 0 };
      svLines = [headLine];
      // 恢复线: 后续滑条头时刻, 且 (尾, 该头] 无其他红/绿线遮挡 (svRestoreTargetAt v454 决策)
      const endMs = main.time + dur0;
      const restoreAt = svRestoreTargetAt(bm.timingPoints, bm.hitObjects.filter(o => o.id !== main.id), endMs);
      let restoreLine: TimingPoint | null = null;
      if (restoreAt !== null) {
        const svBack = svAt(bm.timingPoints, restoreAt);
        restoreLine = { time: restoreAt, beatLength: beatLengthForSv(svBack), meter: red.meter, sampleSet: red.sampleSet, sampleIndex: red.sampleIndex, volume: red.volume, uninherited: false, effects: 0 };
        svLines.push(restoreLine);
      }
      // 全量替换数组: 头绿线有则改 (原位替换) 无则插 (同刻红线之后), 恢复线按时间插入;
      // 构造时保持同刻红先绿后 (svPointAt 顺序扫描语义), applyConversion 稳定排序不打乱
      applyTiming = bm.timingPoints.slice();
      if (headGreen) {
        const idx = applyTiming.findIndex(p => p === headGreen);
        applyTiming[idx] = headLine;
      } else {
        const redIdx = applyTiming.findIndex(p => p.uninherited && Math.round(p.time) === Math.round(main.time));
        const pos = redIdx >= 0 ? redIdx + 1 : applyTiming.findIndex(p => p.time > main.time);
        applyTiming.splice(pos >= 0 ? pos : applyTiming.length, 0, headLine);
      }
      if (restoreLine) {
        const at = restoreLine.time;
        const pos = applyTiming.findIndex(p => p.time > at || (Math.round(p.time) === Math.round(at) && !p.uninherited));
        applyTiming.splice(pos >= 0 ? pos : applyTiming.length, 0, restoreLine);
      }
    } else {
      warnings.push('SV 反解失败 (时长参数非法), 未生成绿线');
    }
  }
  return { object, svLines, applyTiming, svPreview, stamps: used, warnings };
}

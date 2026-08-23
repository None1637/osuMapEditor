// F3: 多个物件合并为滑条 (>=2 个物件 -> 1 条滑条)
// 语义 (用户需求规格):
//   - 按 time 升序把选中物件连接成一条新滑条 (无视堆叠偏移, 直接用逻辑坐标):
//     单点(circle)/转盘(spinner): 贡献其位置点 (o.x, o.y), 与前一段直线连接
//     滑条(slider): 保留其完整路径形状拼入 — 统一转贝塞尔段序列 (bezierPath.ts sliderToBezierSegments,
//                   圆弧/卡特姆转贝塞尔确保形状不变), 段序列首尾接入
//   - 物件之间的接缝 = 红锚点 (重复点) 分段; 相邻物件位置完全相同 (或滑条尾与下一物件头重合) 时去重, 避免零长接缝
//   - 新滑条: head = 第一个物件位置, time = 第一个物件的 time, curveType 'B', slides=1
//   - 长度: 由几何全长决定 (与节点编辑一致, 不拉伸/压缩到尾部物件时间), resnapSliderLength 吸附节拍
//   - hitsound: 仅保留第一个物件的 hitSound/hitSampleRaw/newCombo 到新滑条头部, 其余物件采样 (含边缘音) 全部丢弃
//   - 边界: 有效物件 <2 个, 或合并后路径总长 ≈0 (全部位置重合) 时返回 null (不动作)
import type { Beatmap, HitObject, Vec2 } from '../parser';
import { genId } from '../parser';
import { resnapSliderLength } from '../sliderPath';
import { measureSegments, segmentsToPoints, sliderToBezierSegments, type BezierSeg } from './bezierPath';

/** 两点重合判定 (位置完全相同即去重; 坐标为整数, 小容差即可) */
const samePos = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const roundPt = (p: Vec2) => ({ x: Math.round(p.x), y: Math.round(p.y) });

/**
 * 多物件合并为一条滑条 (纯函数, 不改原物件)。
 * @param objects 选中的物件 (任意顺序, 内部按 time 升序)
 * @param beatSnap 节拍吸附分割 (默认取谱面 editor.beatDivisor, 与 store.beatSnap 同语义)
 * @returns 新滑条 (未入谱面), 或 null (不满足合并条件)
 */
export function computeMerge(bm: Beatmap, objects: HitObject[], beatSnap?: number): HitObject | null {
  const sorted = objects
    .filter(o => o.type === 'circle' || o.type === 'slider' || o.type === 'spinner')
    .slice()
    .sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return null;

  // 依次把每个物件的贡献拼成贝塞尔段序列; 物件间补直线接缝, 重合处去重
  const segs: BezierSeg[] = [];
  let lastPt: Vec2 | null = null; // 当前已拼路径的末端点
  for (const o of sorted) {
    // 滑条: 完整路径 -> 贝塞尔段序列; 控制点不足 (退化的滑条按头部点处理)
    const sub = o.type === 'slider' ? sliderToBezierSegments(o) : [];
    if (o.type === 'slider' && sub.length > 0) {
      const head: Vec2 = { x: o.x, y: o.y };
      // 与上一段的直线接缝 (滑条头与上一段末重合则去重)
      if (lastPt && !samePos(lastPt, head)) segs.push([{ ...lastPt }, { ...head }]);
      segs.push(...sub);
      const tail = sub[sub.length - 1];
      lastPt = tail[tail.length - 1];
    } else {
      const p: Vec2 = { x: o.x, y: o.y };
      // 与上一段的直线接缝 (重合则去重; 首物件仅记录起点)
      if (lastPt && !samePos(lastPt, p)) segs.push([{ ...lastPt }, { ...p }]);
      lastPt = p;
    }
  }
  if (!segs.length) return null; // 全部位置重合: 无任何有效段

  // 路径总长 ≈0 不动作
  if (measureSegments(segs).total < 1) return null;

  const pts = segmentsToPoints(segs); // 跨段接缝自动写重复点 (红锚点)
  const first = sorted[0];
  const slider: HitObject = {
    id: genId(), type: 'slider',
    x: Math.round(pts[0].x), y: Math.round(pts[0].y),
    time: first.time,
    curveType: 'B', curvePoints: pts.slice(1).map(roundPt),
    slides: 1, length: 0, // 长度由几何全长决定, 下面 resnap 写回
    hitSound: first.hitSound ?? 0,          // 仅保留第一个物件的头部采样
    newCombo: !!first.newCombo,             // newCombo 也只看第一个物件
    comboSkip: first.comboSkip ?? 0,
  };
  if (first.hitSampleRaw !== undefined) slider.hitSampleRaw = first.hitSampleRaw;
  // 长度 = 几何全长按节拍吸附 (与节点编辑同一 resnapSliderLength, 不对齐尾部物件时间)
  resnapSliderLength(bm, slider, beatSnap ?? bm.editor?.beatDivisor ?? 4);
  return slider;
}

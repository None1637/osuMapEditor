// v75: 反转选中物件 (lazer OsuSelectionHandler.HandleReverse + SliderPathExtensions.Reverse 对齐)
//  - 多选: 时间镜像 o.time = selectionEnd - (o.end - selectionStart); newCombo 的时序位置保持;
//  - 滑条: 路径反向 — 新头 = PositionAt(length) (截断后的真尾端), 控制点列整体反转;
//    截断滑条 (几何全长 > length) 先丢尾端超出 length 的整段 (保留跨界段);
//    'P' 单段截断时重算中点 = PositionAt(length/2) 且末点 = 真尾端, 保持弧形;
//  - edgeSoundsRaw/edgeSetsRaw 按 '|' 分段反转 (端点 i <-> slides - i)。
// stable 单 curveType 模型下 lazer 的段类型前向传播不需要: 红锚点重复对反转后仍是重复对, 分段位置不变。
import type { Beatmap, HitObject, Vec2 } from './parser';
import { hitObjectDuration } from './lifecycle';
import { SliderPath, sliderGeometryLength } from './sliderPath';

const samePt = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/** 丢尾端超出 length 的整段 (按红锚点重复对分段; 保留首个累计几何 >= length 的跨界段); 单段无段可丢 */
function dropTrailingSegments(curveType: string, pts: Vec2[], length: number): Vec2[] {
  const segments: Vec2[][] = [];
  let seg: Vec2[] = [];
  for (const p of pts) {
    if (seg.length > 0 && samePt(p, seg[seg.length - 1])) { segments.push(seg); seg = []; }
    seg.push(p);
  }
  segments.push(seg);
  if (segments.length === 1) return pts;
  let acc = 0, keepCount = segments.length;
  for (let i = 0; i < segments.length; i++) {
    acc += sliderGeometryLength(curveType, segments[i]);
    if (acc >= length) { keepCount = i + 1; break; }
  }
  if (keepCount >= segments.length) return pts;
  // 相邻段共享边界点, 直接拼接即自动形成红锚点重复对
  const out: Vec2[] = [];
  for (let i = 0; i < keepCount; i++) out.push(...segments[i]);
  return out;
}

/**
 * 单条滑条路径反向 (原地写回 x/y/curvePoints/edgeSoundsRaw/edgeSetsRaw, 坐标取整);
 * length/slides/curveType 不变; 调用方负责 invalidatePath。
 */
export function reverseSlider(o: HitObject): void {
  if (o.type !== 'slider') return;
  const pts: Vec2[] = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  if (pts.length < 2) return;
  const curveType = o.curveType ?? 'L';
  const length = o.length ?? 100;
  const path = new SliderPath(curveType, pts, length);
  const end = path.positionAt(length); // 截断后的真尾端 (lazer: positionalOffset = PositionAt(1))
  let kept = pts;
  if (sliderGeometryLength(curveType, pts) - length > 1) {
    kept = curveType === 'P' && pts.length === 3
      // 'P' 单段截断: 重算中点保形 (lazer: controlPoints[^2] = PositionAt((lastSegmentStart+1)/2))
      ? [pts[0], path.positionAt(length / 2), end]
      : dropTrailingSegments(curveType, pts, length);
  }
  // 整体反转: 新头 = 真尾端 (lazer 把最末控制点移到 PositionAt(1) 处, 即替换为 end), 旧头部成为最末控制点
  o.x = Math.round(end.x);
  o.y = Math.round(end.y);
  o.curvePoints = kept.slice(0, kept.length - 1).reverse().map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  // 端点 hitsound 随方向反转 (边 i <-> slides - i)
  if (o.edgeSoundsRaw !== undefined) o.edgeSoundsRaw = o.edgeSoundsRaw.split('|').reverse().join('|');
  if (o.edgeSetsRaw !== undefined) o.edgeSetsRaw = o.edgeSetsRaw.split('|').reverse().join('|');
}

/**
 * 反转选区 (lazer OsuSelectionHandler.HandleReverse):
 *  - 多选: 时间镜像 (duration 用镜像前的时间求值); 转盘 lazer 只改 StartTime 不动 EndTime, 同款;
 *  - 每个滑条路径反向;
 *  - 反转后按新时间重排, newCombo 标志的时序位置保持不变 (combo 数字位置不随物件反转)。
 * 返回被改动的滑条 (调用方负责 invalidatePath + beatmap 重排序)。
 */
export function reverseSelection(bm: Beatmap, objs: HitObject[]): HitObject[] {
  const sorted = [...objs].sort((a, b) => a.time - b.time);
  const ends = sorted.map(o => o.time + hitObjectDuration(bm, o));
  const startTime = sorted[0].time;
  const endTime = Math.max(...ends);
  const newComboOrder = sorted.map(o => o.newCombo);
  const moreThanOne = sorted.length > 1;
  const sliders: HitObject[] = [];
  sorted.forEach((o, i) => {
    if (moreThanOne) o.time = Math.round(endTime - (ends[i] - startTime));
    if (o.type === 'slider') { reverseSlider(o); sliders.push(o); }
  });
  const reSorted = [...sorted].sort((a, b) => a.time - b.time);
  reSorted.forEach((o, i) => { o.newCombo = newComboOrder[i]; });
  return sliders;
}

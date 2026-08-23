// v86: pattern 缩略图 — 复用游玩区渲染管线 (renderPlayfield + 皮肤), 黑底无网格, 包围盒适配
import { csToRadius, type Beatmap, type HitObject } from '@/osu/parser';
import { computeCombos, renderPlayfield } from '@/osu/renderer';
import type { Skin } from '@/osu/skin';
import type { StoredPattern } from '@/osu/patternLibrary';

/** v93: 缩略图合成物件的 id 段起点 — 按 pattern.id 哈希派生负 id (真实物件 id 为正, 不冲突);
 * 同 pattern 多次重绘 id 稳定 => pathCache/bodyCache 命中正确; 不同 pattern id 段不同 => 不串形 */
export function thumbBaseId(patternId: string): number {
  let h = 0;
  for (let i = 0; i < patternId.length; i++) h = (h * 31 + patternId.charCodeAt(i)) | 0;
  return -((h === -0x80000000 ? 0 : Math.abs(h)) % 1_000_000) * 4096 - 1;
}

/** 把 pattern 物件按收藏时原样 (不应用对齐选项) 渲染到 canvas (黑底, 包围盒缩放适配) */
export function renderPatternThumbnail(
  canvas: HTMLCanvasElement, pattern: StoredPattern, bmBase: Beatmap, skin: Skin,
): void {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  if (!pattern.objects.length) return;

  // 事例化到相对坐标 (首物件为原点), 时间用序号 (互相可见性互不影响: 逐物件 time=o.time+1 渲染)
  // v93: id 用 thumbBaseId 派生的负 id 段 — sliderPath/renderer 的 pathCache/bodyCache 按 o.id 缓存且
  // key 不含几何, 若沿用 i+1 会撞真实物件与其他 pattern 的缓存项 (症状: 后续滑条缩略图 = 第一个的偏移)
  const base = thumbBaseId(pattern.id);
  const objs: HitObject[] = pattern.objects.map((po, i) => {
    const o: HitObject = {
      id: base - i, type: po.type, x: po.dx, y: po.dy, time: i * 600,
      hitSound: po.hitSound, newCombo: po.newCombo, comboSkip: po.comboSkip,
      hitSampleRaw: po.hitSampleRaw, edgeSoundsRaw: po.edgeSoundsRaw, edgeSetsRaw: po.edgeSetsRaw,
    };
    if (po.type === 'slider') {
      o.curveType = po.curveType;
      o.curvePoints = (po.curvePoints ?? []).map(p => ({ x: po.dx + p.x, y: po.dy + p.y }));
      o.slides = po.slides ?? 1;
      o.length = po.pixelLength ?? 0;
    } else if (po.type === 'spinner') {
      o.endTime = o.time + 600;
    }
    return o;
  });
  const bm: Beatmap = { ...bmBase, hitObjects: objs };

  // 包围盒 (含圆圈半径外扩)
  const r = csToRadius(bmBase.difficulty.cs);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const eat = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of objs) {
    eat(o.x, o.y);
    for (const p of o.curvePoints ?? []) eat(p.x, p.y);
  }
  x0 -= r; y0 -= r; x1 += r; y1 += r;
  const pad = 4;
  const scale = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
  g.translate(w / 2, h / 2);
  g.scale(scale, scale);
  g.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

  const comboInfo = computeCombos(bm);
  const empty = new Map<number, { dx: number; dy: number }>();
  // 逐物件满alpha渲染 (time = o.time + 1: 无缩圈/无淡出), combo 数字颜色按完整列表
  for (const o of objs) {
    renderPlayfield(
      { g, bm: { ...bm, hitObjects: [o] }, skin, time: o.time + 1, selected: new Set(), comboInfo, stackOffsets: empty },
    );
  }
}

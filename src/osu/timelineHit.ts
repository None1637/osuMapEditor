// v79: 上方时间轴物件命中 (纯函数, 从 Timelines.tsx 抽出以便单测)
// 头圆/尾圆 (半径 rad+3 css px) 最近者胜出; 连体条中段不命中 — v50 教训: 长滑条/转盘的
// 连体条覆盖物件行大部分区域, 若中段可命中则空白处点击总被条抢走, 框选永远进不去
export interface TimelineObjLike { id: number; time: number }

// v162: 同刻物件纵向堆叠 (文件顺序, 从下往上; level 0 = 文件中靠前者 = 最下)
// count = 同 time 物件数 (>1 才堆叠); objects 须按文件顺序传入
// v189: 同刻判定回到精确相等 (撤销 v188 的 ±2ms) — 1ms 偏移的叠放改由
//       Timelines.tsx 的"按时间倒序画 (早物件压上层)"解决可见性, 不动堆叠分组
export function stackInfo<T extends TimelineObjLike>(objects: T[]): Map<number, { level: number; count: number }> {
  const counts = new Map<number, number>();
  for (const o of objects) counts.set(o.time, (counts.get(o.time) ?? 0) + 1);
  const seen = new Map<number, number>();
  const out = new Map<number, { level: number; count: number }>();
  for (const o of objects) {
    const lv = seen.get(o.time) ?? 0;
    seen.set(o.time, lv + 1);
    out.set(o.id, { level: lv, count: counts.get(o.time) ?? 1 });
  }
  return out;
}

// v162: 堆叠布局 — 非堆叠 (count<=1) 原样 (rad0, 行居中); 堆叠时最下层贴行底 (留 2px), 往上逐层抬升, 顶层不超行顶
// v189: 堆叠不再缩小半径 (rad 恒为 rad0), 仅压缩层距 — 缩小后圆上的 combo 数字/颜色难辨认
export function stackLayout(count: number, objH: number, rad0: number): { rad: number; yOf: (level: number) => number } {
  if (count <= 1) return { rad: rad0, yOf: () => objH / 2 };
  const STEP = Math.min(10, rad0 * 0.45);
  const rad = rad0;
  const step = Math.min(STEP, (objH - 2 * rad - 4) / (count - 1));
  const bottom = objH - 2 - rad;
  return { rad, yOf: (lv) => bottom - lv * step };
}

export function timelineMarkerHit<T extends TimelineObjLike>(
  objects: T[],
  endOf: (o: T) => number,
  t0: number, win: number, width: number, px: number, rad: number,
  py?: number, geom?: (o: T) => { y: number; rad: number } | undefined,
): number | null {
  let best: number | null = null, bestD = Infinity;
  for (const o of objects) {
    const end = endOf(o);
    if (end < t0 || o.time > t0 + win) continue;
    // v162: geom 仅对堆叠件返回几何 (2D 距离跟着堆叠位置/缩小半径); 非堆叠返回 undefined = 旧 x-only 行为
    const gm = geom?.(o);
    const or = gm?.rad ?? rad;
    const dist = (mx: number) => {
      const dx = mx - px;
      return gm !== undefined && py !== undefined ? Math.hypot(dx, gm.y - py) : Math.abs(dx);
    };
    const dHead = dist(((o.time - t0) / win) * width);
    if (dHead < or + 3 && dHead < bestD) { bestD = dHead; best = o.id; }
    // 尾圆与头圆同为命中目标 (v79: 点尾圆应能选中/右键删除)
    if (end - o.time > 1) {
      const dTail = dist(((end - t0) / win) * width);
      if (dTail < or + 3 && dTail < bestD) { bestD = dTail; best = o.id; }
    }
  }
  return best;
}

// v80: 连体条命中兜底 — 单击(未拖动)选中/右键删除落空时调用;
// v142: mousedown 中段命中也走本函数 (选中 + 按住拖动改时间) — 框选从物件行空白处/行下方全高度起手,
//       v50 教训由"中段不参与 mousedown"改由"全高度框选"化解 (长滑条条占满行时仍有起手区域)
// 多条重叠时取 time 最晚者 (绘制顺序 = 时间序, 最晚的画在最上层)
// v162: geom 对堆叠件返回 {y, rad} — 条带垂直厚度跟着堆叠半径; 非堆叠 undefined = 旧行为 (行内任意 y)
// v213: 滑条节点命中 (折返点/尾端圆, k=1..slides; 不含头 — 头圆走 timelineMarkerHit 的物件级选中)
// spansOf 返回滑条折返数 (非滑条返回 0 跳过); 命中返回 { id, edge } (edge = 节点下标, slides = 尾)
export function timelineNodeHit<T extends TimelineObjLike>(
  objects: T[],
  endOf: (o: T) => number,
  spansOf: (o: T) => number,
  t0: number, win: number, width: number, px: number, rad: number,
  py?: number, geom?: (o: T) => { y: number; rad: number } | undefined,
): { id: number; edge: number } | null {
  let best: { id: number; edge: number } | null = null, bestD = Infinity;
  for (const o of objects) {
    const slides = spansOf(o);
    if (slides < 1) continue;
    const end = endOf(o);
    if (end < t0 || o.time > t0 + win || end - o.time <= 1) continue;
    const gm = geom?.(o);
    const or = gm?.rad ?? rad;
    for (let k = 1; k <= slides; k++) {
      const mx = ((o.time + (end - o.time) * k / slides - t0) / win) * width;
      const dx = mx - px;
      const d = gm !== undefined && py !== undefined ? Math.hypot(dx, gm.y - py) : Math.abs(dx);
      if (d < or + 3 && d < bestD) { bestD = d; best = { id: o.id, edge: k }; }
    }
  }
  return best;
}

export function timelineBarHit<T extends TimelineObjLike>(
  objects: T[],
  endOf: (o: T) => number,
  t0: number, win: number, width: number, px: number,
  py?: number, geom?: (o: T) => { y: number; rad: number } | undefined,
): number | null {
  let best: number | null = null, bestTime = -Infinity;
  for (const o of objects) {
    const end = endOf(o);
    if (end - o.time <= 1) continue; // 无时长 (单点) 无连体条
    if (end < t0 || o.time > t0 + win) continue;
    const sx = ((o.time - t0) / win) * width, ex = ((end - t0) / win) * width;
    if (px < sx || px > ex) continue;
    if (geom && py !== undefined) {
      const gm = geom(o);
      if (gm && Math.abs(py - gm.y) > gm.rad) continue;
    }
    if (o.time >= bestTime) { bestTime = o.time; best = o.id; }
  }
  return best;
}


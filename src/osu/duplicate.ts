// v65: 批量复制 — 选中物件复制 N 份放到后续时间 (lazer 无此功能, 自研; 用户确认参数集)
// 每份相对源: 时间 +i×间隔拍 (逐红线段换算, BPM 变化下保持各物件拍位), 绕锚点旋转 i×角度, 平移 i×向量
// 锚点三模式与普通旋转相同: 选区包围盒中心 / 游玩区中心 (256,192) / 自定义点
import type { Beatmap, HitObject, TimingPoint } from './parser';
import { genId, sliderVelocityAt } from './parser';
import { selectionCenter, type Pt } from './transform';
import { defaultNewPoint } from './timingEdit';

export interface DuplicateParams {
  count: number;         // 复制次数 1-99
  intervalBeats: number; // 相邻两份间隔 (拍, 可小数)
  rotateDeg: number;     // 每份递增旋转角 (度, 顺时针为正)
  dx: number;            // 每份递增平移 (osu px)
  dy: number;
  copyGreenLines: boolean; // v68: 同时复制物件时间范围内的绿线 (滑条 = 整条 [头,尾] 内全部绿线)
  scalePerCopy: number;    // v116: 每份递增缩放 — 第 i 份 = 1 + i×此值 (0.1 => 1.1x/1.2x..., -0.1 => 0.9x/0.8x...)
  scaleSlidersGreenLines: boolean; // v116: 勾选后滑条参与几何缩放并添加补偿绿线 (头 SV×s / 尾还原, 时长不变); 否则滑条不缩放
}
export const DEFAULT_DUPLICATE_PARAMS: DuplicateParams = {
  count: 2, intervalBeats: 1, rotateDeg: 0, dx: 0, dy: 0,
  copyGreenLines: false, scalePerCopy: 0, scaleSlidersGreenLines: false,
};
export type DuplicateOrigin = 'selection' | 'playfield' | Pt;

const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** 从 from 前进 beats 拍 (逐红线段换算 ms; 跨 BPM 变化时保持拍位) */
export function advanceByBeats(points: TimingPoint[], from: number, beats: number): number {
  const reds = points.filter(p => p.uninherited);
  if (!reds.length || beats <= 0) return from;
  let ri = 0;
  while (ri < reds.length - 1 && reds[ri + 1].time <= from + 1e-6) ri++;
  let t = from, rem = beats;
  for (;;) {
    const red = reds[ri];
    const next = reds[ri + 1];
    if (!next) return t + rem * red.beatLength;
    const avail = (next.time - t) / red.beatLength;
    if (rem <= avail + 1e-9) return t + rem * red.beatLength;
    rem -= avail; t = next.time; ri++;
  }
}

/**
 * 生成批量副本 (纯函数; 源物件不动 — 预览/应用由调用方决定)。
 * 转盘位置固定 (256,192) 不做几何变换 (同 transform.ts 规则), 只随时间平移。
 * 锚点解析失败 (选区无有效点, 如只选转盘) => 返回 []。
 */
export function computeDuplicate(bm: Beatmap, objs: HitObject[], origin: DuplicateOrigin, p: DuplicateParams): HitObject[] {
  if (!objs.length || p.count < 1) return [];
  const c = origin === 'playfield' ? { x: 256, y: 192 }
    : origin === 'selection' ? selectionCenter(objs)
    : origin;
  if (!c) return [];
  const sorted = [...objs].sort((a, b) => a.time - b.time);
  const out: HitObject[] = [];
  for (let i = 1; i <= p.count; i++) {
    const r = (p.rotateDeg * i * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const tx = p.dx * i, ty = p.dy * i;
    // v116: 第 i 份几何缩放 s = 1 + i×scalePerCopy (下限 0.1 防负缩放); 先绕锚点缩放再旋转再平移
    const s = Math.max(0.1, 1 + p.scalePerCopy * i);
    const rot = (p0: Pt, k: number): Pt => ({
      x: c.x + (p0.x - c.x) * k * cos - (p0.y - c.y) * k * sin + tx,
      y: c.y + (p0.x - c.x) * k * sin + (p0.y - c.y) * k * cos + ty,
    });
    for (const o of sorted) {
      const cl = deepCopy(o);
      cl.id = genId();
      cl.time = Math.round(advanceByBeats(bm.timingPoints, o.time, p.intervalBeats * i));
      if (cl.endTime !== undefined) cl.endTime = Math.round(advanceByBeats(bm.timingPoints, o.endTime ?? o.time, p.intervalBeats * i));
      if (o.type !== 'spinner') {
        // v116: 滑条仅在勾选「添加绿线缩放滑条」时参与缩放 (k=s), 否则只旋转+平移 (k=1)
        const k = o.type === 'slider' && !p.scaleSlidersGreenLines ? 1 : s;
        const h = rot(o, k);
        cl.x = Math.round(h.x); cl.y = Math.round(h.y);
        if (o.type === 'slider') {
          cl.curvePoints = (o.curvePoints ?? []).map(pt => {
            const q = rot(pt, k);
            return { ...pt, x: Math.round(q.x), y: Math.round(q.y) };
          });
          // 像素长度同步缩放 (路径随控制点变长; 时长由补偿绿线保持, 见 computeDuplicateScaleTiming)
          if (k !== 1) cl.length = Math.round((o.length ?? 0) * k * 100) / 100;
        }
      }
      out.push(cl);
    }
  }
  return out;
}

/**
 * v68: 批量复制的绿线副本 (纯函数)。
 * 源 = 落在任一源物件时间范围 [time, endTime] 内的未继承点 (绿线);
 * 单点/转盘只有 time 一刻 (该刻绿线随物件走), 滑条覆盖整条 duration。
 * 每份按与物件相同的逐红线段拍偏移平移; 多个源物件共享的绿线只复制一次,
 * 同份内目标时刻撞车 (取整/不同源同拍位) 保留后者。
 */
export function computeDuplicateTiming(bm: Beatmap, objs: HitObject[], p: DuplicateParams): TimingPoint[] {
  if (!p.copyGreenLines || !objs.length || p.count < 1) return [];
  const greens = bm.timingPoints.filter(t => !t.uninherited);
  if (!greens.length) return [];
  const src = greens.filter(g => objs.some(o => g.time >= o.time && g.time <= (o.endTime ?? o.time)));
  if (!src.length) return [];
  const out: TimingPoint[] = [];
  for (let i = 1; i <= p.count; i++) {
    const byTime = new Map<number, TimingPoint>();
    for (const g of src) {
      const t = Math.round(advanceByBeats(bm.timingPoints, g.time, p.intervalBeats * i));
      byTime.set(t, { ...g, time: t });
    }
    out.push(...byTime.values());
  }
  return out;
}

/**
 * v116: 「添加绿线缩放滑条」的补偿绿线 (纯函数; 勾选且第 i 份缩放 s≠1 时, 对该份每条滑条生成两条)。
 * 几何缩放 s 使滑条像素长度变 s 倍 → 时长变 s 倍; 在滑条头加 SV = 生效SV×s 的绿线、
 * 尾加还原生效SV的绿线, 拷贝滑条时长与原件一致 (mapping 常用的几何缩放+SV补偿手法)。
 * base = computeDuplicateTiming 的绿线副本 (复制绿线勾选时), 生效 SV 判定基于谱面绿线 + base;
 * 同刻冲突头部绿线优先 (下一条滑条已经开始)。绿线字段克隆该时刻生效绿线 (lazer addNew 克隆语义)。
 */
export function computeDuplicateScaleTiming(bm: Beatmap, objs: HitObject[], p: DuplicateParams, base: TimingPoint[]): TimingPoint[] {
  if (!p.scaleSlidersGreenLines || !objs.length || p.count < 1) return [];
  const sliders = objs.filter(o => o.type === 'slider').sort((a, b) => a.time - b.time);
  if (!sliders.length) return [];
  const sm = bm.difficulty.sliderMultiplier;
  const basePts = [...bm.timingPoints, ...base].sort((a, b) => a.time - b.time);
  const svAt = (t: number) => {
    let sv = 1;
    for (const q of basePts) {
      if (q.time > t + 1e-6) break;
      // v148: 红线不重置 SV (lazer DifficultyPoint 与 TimingPoint 分表独立查询)
      if (!q.uninherited && q.beatLength < 0) sv = -100 / q.beatLength;
    }
    return sv;
  };
  const green = (time: number, sv: number): TimingPoint => {
    const g = defaultNewPoint(basePts, time, false);
    g.time = Math.round(time);
    g.beatLength = -100 / sv;
    return g;
  };
  const restores = new Map<number, TimingPoint>(), heads = new Map<number, TimingPoint>();
  for (let i = 1; i <= p.count; i++) {
    const s = Math.max(0.1, 1 + p.scalePerCopy * i);
    if (Math.abs(s - 1) < 1e-9) continue;
    for (const o of sliders) {
      const head = Math.round(advanceByBeats(bm.timingPoints, o.time, p.intervalBeats * i));
      const hg = green(head, svAt(head) * s);
      heads.set(hg.time, hg);
      // 尾 = 头 + slides×(s×length)/vel(头部生效 SV×s 下), 与原件在该红线段下的时长一致
      const merged = [...basePts, ...heads.values()].sort((a, b) => a.time - b.time);
      const vel = sliderVelocityAt(merged, head, sm);
      const tail = head + ((o.slides ?? 1) * (o.length ?? 0) * s) / vel;
      restores.set(Math.round(tail), green(tail, svAt(tail)));
    }
  }
  // 同刻冲突: 头部绿线覆盖还原绿线 (下一条滑条已开始, 需要缩放后 SV)
  return [...new Map<number, TimingPoint>([...restores, ...heads]).values()];
}

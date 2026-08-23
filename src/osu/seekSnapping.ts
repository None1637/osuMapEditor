// 方向性节拍吸附 seek: 移植 lazer EditorClock.seek (osu.Game/Screens/Edit/EditorClock.cs, 暂停时 snapped=true)
// 与 Editor.cs 的 seek 入口配合: 左右键 = 1 拍 (Shift = 4 拍), 步长 = 当前红线 beatLength / beatDivisor
import type { TimingPoint } from './parser';

/**
 * 按节拍网格向前/向后移动一个吸附步 (对齐 lazer EditorClock.seek):
 *  - 步长 = 红线 beatLength / divisor * amount; 落点吸附到该红线节拍网格 (向前 floor / 向后 ceil);
 *  - 向后且恰在红线边界时, 用目标侧红线的 beatLength 计算步长;
 *  - 向前不越过下一条红线; 向后不越过本红线起点 (首条红线除外, 可退到 0);
 *  - 吸附后落回原地 (已在网格点上) 时, 沿方向多走一拍。
 */
export function seekByBeats(points: TimingPoint[], divisor: number, current: number, direction: 1 | -1, amount = 1): number {
  const reds = points.filter(p => p.uninherited);
  if (!reds.length || divisor <= 0 || amount <= 0) return current;
  const redAt = (t: number) => {
    let r = reds[0];
    for (const p of reds) { if (p.time > t + 1e-6) break; r = p; }
    return r;
  };
  let tp = redAt(current);
  if (direction < 0 && Math.abs(tp.time - current) < 1e-6) tp = redAt(current - 1);
  const seekAmount = (tp.beatLength / divisor) * amount;
  if (!(seekAmount > 0)) return current;
  const rel = current + seekAmount * direction - tp.time;
  let beat = direction > 0
    ? Math.floor(rel / seekAmount + 1e-6)
    : Math.ceil(rel / seekAmount - 1e-6);
  let seekTime = tp.time + beat * seekAmount;
  const next = reds.find(p => p.time > tp.time + 1e-6);
  if (next && seekTime > next.time) seekTime = next.time;
  if (Math.abs(seekTime - current) < 0.5) {
    beat += direction > 0 ? 1 : -1;
    seekTime = tp.time + beat * seekAmount;
  }
  if (seekTime < tp.time && tp !== reds[0]) seekTime = tp.time;
  return Math.max(0, seekTime);
}

// ---- v193: 滚轮 seek (对齐 lazer Editor.OnScroll + EditorClock.seek) ----

/**
 * 播放中滚轮步长 (lazer Editor.cs seek 播放分支 + EditorClock.seek):
 *   amount = beatDivisor × (BPM/120), EditorClock 再 ×(1 + 250/(int)BeatLength) (C# 整数除法);
 *   乘回 BeatLength/divisor 后净步长 = BeatLength × (BPM/120) × factor — 墙钟基准恒定 500ms,
 *   >240bpm 时 factor=2 (1000ms), >480bpm 时 3, 以此类推; 播放中不吸附网格。
 */
export function playingWheelStepMs(points: TimingPoint[], current: number): number {
  const reds = points.filter(p => p.uninherited);
  if (!reds.length) return 500;
  let red = reds[0];
  for (const p of reds) { if (p.time > current + 1e-6) break; red = p; }
  const bl = red.beatLength;
  if (!(bl > 0)) return 500;
  const bpm = 60000 / bl;
  return bl * (bpm / 120) * (1 + Math.floor(250 / Math.floor(bl)));
}

/** 滚轮累积器状态 (lazer Editor.scrollAccumulation; 一处全局共享, 触摸板精密滚动也按刻度触发) */
export interface WheelAccum { acc: number }

/** 一个滚轮刻度对应的像素量 (Chromium 滚轮一格 deltaY=120; lazer precision=1 对应框架归一化刻度) */
export const WHEEL_PRECISION = 120;

/**
 * 累积滚轮增量并返回本次应触发的有符号步数 (lazer Editor.OnScroll):
 *  - deltaMode 归一 (0=px, 1=行 ×33, 2=页 ×800);
 *  - 反向滚动时把累积量折返, 保持响应性;
 *  - 每凑满一个刻度触发一步, 余量保留。
 */
export function wheelSteps(st: WheelAccum, deltaY: number, deltaMode: number): number {
  const norm = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  if (!norm) return 0;
  const dir = Math.sign(norm);
  if (st.acc !== 0 && Math.sign(st.acc) !== dir) st.acc = dir * (WHEEL_PRECISION - Math.abs(st.acc));
  st.acc += norm;
  let steps = 0;
  while (Math.abs(st.acc) >= WHEEL_PRECISION) {
    steps += Math.sign(st.acc);
    st.acc = st.acc < 0 ? Math.min(0, st.acc + WHEEL_PRECISION) : Math.max(0, st.acc - WHEEL_PRECISION);
  }
  return steps;
}

// v391: 游玩区旋转正/逆变换 — 绕游玩区中心 (256,192), 单位度; 纯函数 (verifier 可测, 无 React 依赖)
import type { Pt } from './objectSnap';

/** 游玩区中心 (osu 坐标系 512×384) */
export const PF_CX = 256, PF_CY = 192;

/** 正变换 F(x) = c + R(θ)(x−c); deg=0 原样返回 (零开销路径) */
export function pfRotFwd(p: Pt, deg: number): Pt {
  if (!deg) return p;
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dx = p.x - PF_CX, dy = p.y - PF_CY;
  return { x: PF_CX + dx * cos - dy * sin, y: PF_CY + dx * sin + dy * cos };
}

/** 逆变换 = 反向转角 (R(−θ) 与 R(θ) 互逆) */
export function pfRotInv(p: Pt, deg: number): Pt { return pfRotFwd(p, -deg); }

// v294: 测试游玩 Mod — 对齐 lazer (本地源码核对):
//   OsuModHardRock.cs: HP/OD/AR ×1.4 封顶 10, CS ×1.3 封顶 10, 物件垂直翻转 (ReflectVerticallyAlongPlayfield)
//   OsuModEasy.cs / ModEasy.cs: CS/AR/HP/OD ×0.5
//   ModDoubleTime.cs 1.5x / ModHalfTime.cs 0.75x (ModRateAdjust 只调时钟, 不改 difficulty;
//   判定窗按地图时钟不变 — 墙钟窗口随 rate 自然收紧, 与 lazer 等效)
//   ModRelax.cs (免按键, 光标到圈即自动击打, 按实际 delta 判 300/100/50)
//   OsuModAutopilot.cs (免瞄准, 光标自动) / ModAutoplay.cs (两者合体)
// 取舍: 现代 lazer 标准化计分 ScoreMultiplier 全 1 → 本项目线性标准分不做倍率;
//   NF 不提供 (测试游玩本就永不失败, lazer EditorPlayer CheckModsAllowFailure=false);
//   HD/FL 等视觉 mod 暂不支持; DT/HT 用项目现成不变调变速引擎 (v60), 不做 Frequency 变调。
import type { Beatmap } from '../parser';

export type TestModId = 'EZ' | 'HR' | 'HT' | 'DT' | 'RX' | 'AP' | 'AT';
export const TEST_MODS: readonly TestModId[] = ['EZ', 'HR', 'HT', 'DT', 'RX', 'AP', 'AT'];

/** 互斥表: EZ↔HR, HT↔DT, AT 与 RX/AP 互斥 (AT = RX+AP 合体) */
const CONFLICTS: Record<TestModId, TestModId[]> = {
  EZ: ['HR'], HR: ['EZ'], HT: ['DT'], DT: ['HT'],
  RX: ['AT'], AP: ['AT'], AT: ['RX', 'AP'],
};

/** 切换 mod: 已开则关; 开启时清掉互斥项 */
export function toggleMod(mods: TestModId[], id: TestModId): TestModId[] {
  if (mods.includes(id)) return mods.filter(m => m !== id);
  return [...mods.filter(m => !CONFLICTS[id].includes(m)), id];
}

/** 难度调整 (lazer 比率): EZ 全项 ×0.5; HR: hp/od/ar ×1.4 min10, cs ×1.3 min10 */
export function adjustDifficulty(d: Beatmap['difficulty'], mods: TestModId[]): Beatmap['difficulty'] {
  let { hp, cs, od, ar } = d;
  if (mods.includes('EZ')) { hp *= 0.5; cs *= 0.5; od *= 0.5; ar *= 0.5; }
  if (mods.includes('HR')) {
    hp = Math.min(hp * 1.4, 10);
    od = Math.min(od * 1.4, 10);
    ar = Math.min(ar * 1.4, 10);
    cs = Math.min(cs * 1.3, 10); // lazer: CS 用 1.3 比率
  }
  return { ...d, hp, cs, od, ar };
}

/** 时钟倍率: DT 1.5 / HT 0.75 / 否则 1 */
export function clockRate(mods: TestModId[]): number {
  return mods.includes('DT') ? 1.5 : mods.includes('HT') ? 0.75 : 1;
}

export function isRelax(mods: TestModId[]): boolean { return mods.includes('RX') || mods.includes('AT'); }
export function isAutopilot(mods: TestModId[]): boolean { return mods.includes('AP') || mods.includes('AT'); }

/** HR 垂直翻转: 浅克隆 bm, hitObjects 逐个克隆 y → 384−y (curvePoints 同步; 原 bm 不变) */
export function applyHardRockFlip(bm: Beatmap): Beatmap {
  return {
    ...bm,
    hitObjects: bm.hitObjects.map(o => ({
      ...o,
      y: 384 - o.y,
      curvePoints: o.curvePoints?.map(p => ({ x: p.x, y: 384 - p.y })),
    })),
  };
}

// ---- localStorage 持久化 ----
const LS_KEY = 'osu-editor:testplay-mods';

export function loadTestMods(): TestModId[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(m => (TEST_MODS as readonly string[]).includes(m));
  } catch { return []; }
}

export function saveTestMods(mods: TestModId[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(mods)); } catch { /* 配额满忽略 */ }
}

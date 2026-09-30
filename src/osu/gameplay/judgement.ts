// v287: 测试游玩判定/计分/血量 — 移植 lazer
//   osu.Game.Rulesets.Osu/Scoring/OsuHitWindows.cs (判定窗)
//   osu.Game/Rulesets/Judgements/Judgement.cs (NumericResultFor / HealthIncreaseFor, DEFAULT_MAX_HEALTH_INCREASE=0.05)
//   osu.Game/Rulesets/Scoring/HitResult.cs (AffectsCombo)
//   osu.Game.Rulesets.Osu/Objects/Spinner.cs (SpinsRequired/MaximumBonusSpins) + DrawableSpinner.cs (结束判定)
// 已知取舍: 分数为线性标准分 100万×已得/满分, 不做 lazer ScoreProcessor 的 0.7 combo + 0.3 acc 加权。
import { difficultyRange } from '../starrating/preprocessing';

/** lazer OsuHitWindows: great/ok/meh 窗口 (ms, 单边); miss 固定 400 (不用于 osu! 判定, 仅记录) */
export interface HitWindows { great: number; ok: number; meh: number; miss: number }

/** v287: 对应 lazer OsuHitWindows.SetDifficulty — floor(DifficultyRange(od, range)) - 0.5 */
export function hitWindows(od: number): HitWindows {
  return {
    great: Math.floor(difficultyRange(od, 80, 50, 20)) - 0.5,
    ok: Math.floor(difficultyRange(od, 140, 100, 60)) - 0.5,
    meh: Math.floor(difficultyRange(od, 200, 150, 100)) - 0.5,
    miss: 400,
  };
}

/** 主判定结果 (circle/slider头/spinner 结束) */
export type MainResult = 'great' | 'ok' | 'meh' | 'miss';
/** 滑条 nested 判定结果 (tick=小, repeat=大, tail=尾) */
export type NestedResult = 'smallTickHit' | 'smallTickMiss' | 'largeTickHit' | 'largeTickMiss' | 'sliderTailHit' | 'sliderTailMiss';
export type JudgeResult = MainResult | NestedResult;

/** v287: 按 |delta| 判定 (delta = 点击时间 - 物件时间); 超出 meh 窗口返回 null (过早点击忽略, lazer DrawableHitCircle 语义) */
export function judgeDelta(deltaMs: number, win: HitWindows): MainResult | null {
  const a = Math.abs(deltaMs);
  if (a <= win.great) return 'great';
  if (a <= win.ok) return 'ok';
  if (a <= win.meh) return 'meh';
  return null;
}

// v287: lazer Judgement.NumericResultFor
export const NUMERIC_SCORE: Record<JudgeResult, number> = {
  great: 300, ok: 100, meh: 50, miss: 0,
  smallTickHit: 10, smallTickMiss: 0,
  largeTickHit: 30, largeTickMiss: 0,
  sliderTailHit: 150, sliderTailMiss: 0,
};

// v287: lazer Judgement.HealthIncreaseFor (DEFAULT_MAX_HEALTH_INCREASE=0.05)
export const HEALTH_DELTA: Record<JudgeResult, number> = {
  great: 0.05, ok: 0.025, meh: 0.0025, miss: -0.10,
  smallTickHit: 0.025, smallTickMiss: -0.025,
  largeTickHit: 0.05, largeTickMiss: -0.05,
  sliderTailHit: 0.05, sliderTailMiss: -0.05,
};

// v287: lazer HitResult.AffectsCombo (SmallTick 不影响 combo)
export const AFFECTS_COMBO: Record<JudgeResult, boolean> = {
  great: true, ok: true, meh: true, miss: true,
  smallTickHit: false, smallTickMiss: false,
  largeTickHit: true, largeTickMiss: true,
  sliderTailHit: true, sliderTailMiss: false, // lazer 尾漏不断 combo (尾判定为 SliderTail 系, miss 侧不列入 AffectsCombo)
};

const IS_HIT: Record<JudgeResult, boolean> = {
  great: true, ok: true, meh: true, miss: false,
  smallTickHit: true, smallTickMiss: false,
  largeTickHit: true, largeTickMiss: false,
  sliderTailHit: true, sliderTailMiss: false,
};

/** 各判定对应的满分 (maxResult) — prefill 与 maxBaseScore 用 */
export const MAX_OF: Record<JudgeResult, JudgeResult> = {
  great: 'great', ok: 'great', meh: 'great', miss: 'great',
  smallTickHit: 'smallTickHit', smallTickMiss: 'smallTickHit',
  largeTickHit: 'largeTickHit', largeTickMiss: 'largeTickHit',
  sliderTailHit: 'sliderTailHit', sliderTailMiss: 'sliderTailHit',
};

/** v287: 对应 lazer Spinner.ApplyDefaultsToSelf — CLEAR_RPM(90,150,225) / COMPLETE_RPM(250,380,430), gap=2 */
export function spinnerRequired(od: number, durationMs: number): { spinsRequired: number; maxBonusSpins: number } {
  const minRps = difficultyRange(od, 90, 150, 225) / 60;
  const maxRps = difficultyRange(od, 250, 380, 430) / 60;
  const sec = durationMs / 1000;
  const spinsRequired = Math.floor(minRps * sec + 0.0001); // lazer (int) 截断
  const maxBonusSpins = Math.max(0, Math.floor(maxRps * sec + 0.0001) - spinsRequired - 2);
  return { spinsRequired, maxBonusSpins };
}

/** v287: 对应 lazer DrawableSpinner 结束判定 (Progress = 完成圈数 / SpinsRequired) */
export function spinnerResult(progress: number): MainResult {
  if (progress >= 1) return 'great';
  if (progress > 0.9) return 'ok';
  if (progress > 0.75) return 'meh';
  return 'miss';
}

/** 转盘每圈 tick 得分 (lazer: 要求内圈 SpinnerTick=SmallTickHit 10 分; 超出圈 SpinnerBonusTick=LargeBonus 50 分) */
export const SPIN_TICK_SCORE = 10;
export const SPIN_BONUS_SCORE = 50;

/**
 * v287: 测试游玩计分器 — lazer ScoreProcessor 简化版
 * score = 1,000,000 × baseScore / maxBaseScore (线性标准分, 不做 0.7combo+0.3acc 加权, 见 README);
 * acc = baseScore / maxBaseScore (判定数值加权, 同 lazer accuracy 语义);
 * combo: AffectsCombo 的 hit +1 / miss 清零; hp 钳 [0,1] 永不失败 (lazer EditorPlayer CheckModsAllowFailure=false)。
 */
export class TestScore {
  baseScore = 0;
  maxBaseScore = 0;
  combo = 0;
  maxCombo = 0;
  hp = 1;
  counts: Record<MainResult, number> = { great: 0, ok: 0, meh: 0, miss: 0 };

  /** 判定前必须先登记该判定的满分 (判定发生顺序 = max 登记顺序) */
  apply(r: JudgeResult) {
    this.maxBaseScore += NUMERIC_SCORE[MAX_OF[r]];
    this.baseScore += NUMERIC_SCORE[r];
    this.hp = Math.min(1, Math.max(0, this.hp + HEALTH_DELTA[r]));
    if (AFFECTS_COMBO[r]) {
      if (IS_HIT[r]) { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
      else this.combo = 0;
    }
    if (r === 'great' || r === 'ok' || r === 'meh' || r === 'miss') this.counts[r]++;
  }

  /** 转盘圈 tick (不计 combo/hp/acc 主判定, 仅分数; lazer SpinnerTick=SmallBonus 语义简化: 直接加固定分) */
  applySpinTick(bonus: boolean) {
    const v = bonus ? SPIN_BONUS_SCORE : SPIN_TICK_SCORE;
    this.maxBaseScore += v;
    this.baseScore += v;
  }

  /** lazer EditorPlayer.markPreviousObjectsHit — editorTime 前结束的判定按满分预填 */
  prefill(r: JudgeResult) {
    this.maxBaseScore += NUMERIC_SCORE[MAX_OF[r]];
    this.baseScore += NUMERIC_SCORE[MAX_OF[r]];
    this.hp = Math.min(1, Math.max(0, this.hp + HEALTH_DELTA[MAX_OF[r]]));
    if (AFFECTS_COMBO[r]) { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
    this.counts.great++; // 预填全部按 great 计入 (lazer MaxResult)
  }

  get accuracy(): number { return this.maxBaseScore > 0 ? this.baseScore / this.maxBaseScore : 1; }
  get score(): number { return Math.round(1_000_000 * this.accuracy); }
}

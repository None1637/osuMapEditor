// v167: osu!standard 星数 (Star Rating) — 移植 lazer osu.Game.Rulesets.Osu/Difficulty/OsuDifficultyCalculator.cs (Version 20260706)
// 无 mod 简化 (clockRate=1):
//   - 不算 Flashlight (不进 skills), flashlightRating=0, SumCognitionDifficulty(reading, 0) = reading
//   - 不算 LegacyScoreSimulator/LegacyScoreUtils 相关 attributes (NestedScorePerObject 等), 只算 StarRating
//   - CreateSkills = Aim(with sliders) / Aim(without) / Speed / Reading
// 模块结构:
//   starrating/diffUtils.ts      — lazer DiffUtils.cs (Pow/Norm/Smoothstep/ReverseLerp/Logistic 等)
//   starrating/preprocessing.ts  — lazer OsuDifficultyHitObject.cs + DifficultyHitObject.cs + SliderEventGenerator.cs + Slider.cs
//   starrating/evaluators.ts     — lazer Evaluators/{SnapAim,Agility,FlowAim,Speed,Rhythm,Reading}Evaluator.cs
//   starrating/skills.ts         — lazer Skills/{Aim,Speed,Reading}.cs + {Skill,HarmonicSkill,VariableLengthStrainSkill}.cs
import type { Beatmap } from './parser';
import { computeStackOffsets } from './stacking';
import { norm, pow } from './starrating/diffUtils';
import { OsuDifficultyHitObject, makeDifficultyCtx } from './starrating/preprocessing';
import { Aim, Reading, Speed } from './starrating/skills';

// v167: 对应 lazer OsuPerformanceCalculator 常量
const PERFORMANCE_BASE_MULTIPLIER = 1.12;
const PERFORMANCE_NORM_EXPONENT = 1.1;

// v167: 对应 lazer OsuPerformanceCalculator.DifficultyToPerformance / HarmonicSkill.DifficultyToPerformance (同式)
const difficultyToPerformance = (difficulty: number) => 4.0 * pow(difficulty, 3);

export interface StarRatingAttributes {
  starRating: number;
  aimDifficulty: number;
  speedDifficulty: number;
  readingDifficulty: number;
  flashlightDifficulty: number; // 无 FL mod 恒 0
  sliderFactor: number;
  aimDifficultStrainCount: number;
  speedDifficultStrainCount: number;
  readingDifficultNoteCount: number;
  aimTopWeightedSliderFactor: number;
  speedTopWeightedSliderFactor: number;
  aimDifficultSliderCount: number;
  speedNoteCount: number;
}

// v167: 对应 lazer OsuDifficultyCalculator.calculateAimDifficultyRating
const calculateAimDifficultyRating = (difficultyValue: number) => pow(difficultyValue, 0.63) * 0.02275;
// v167: 对应 lazer OsuDifficultyCalculator.calculateDifficultyRating
const calculateDifficultyRating = (difficultyValue: number) => Math.sqrt(difficultyValue) * 0.0675;
// v167: 对应 lazer OsuDifficultyCalculator.calculateStarRating
const calculateStarRating = (basePerformance: number) => Math.cbrt(basePerformance * PERFORMANCE_BASE_MULTIPLIER);

/**
 * 计算谱面星数 (无 mod)。空谱面/无物件 -> 0。纯函数、同步。
 * 注意: 复用 getSliderPath 的路径缓存 — 滑条几何编辑后须先 invalidateSliderPath (编辑器已有此惯例)。
 */
export function computeStarRating(bm: Beatmap): number {
  return computeStarRatingAttributes(bm).starRating;
}

/** v167: 对应 lazer OsuDifficultyCalculator.CreateDifficultyAttributes 主流程 (返回中间量供测试/对账) */
export function computeStarRatingAttributes(bm: Beatmap): StarRatingAttributes {
  // v167: 对应 lazer CreateDifficultyAttributes: 无物件提前返回 (StarRating=0)
  if (bm.hitObjects.length === 0) {
    return {
      starRating: 0, aimDifficulty: 0, speedDifficulty: 0, readingDifficulty: 0, flashlightDifficulty: 0,
      sliderFactor: 1, aimDifficultStrainCount: 0, speedDifficultStrainCount: 0, readingDifficultNoteCount: 0,
      aimTopWeightedSliderFactor: 0, speedTopWeightedSliderFactor: 0, aimDifficultSliderCount: 0, speedNoteCount: 0,
    };
  }

  const ctx = makeDifficultyCtx(bm, computeStackOffsets(bm));

  // v167: 对应 lazer CreateDifficultyHitObjects: 首个跳由谱面头两个物件组成 (i 从 1 起)
  const difficultyObjects: OsuDifficultyHitObject[] = [];
  for (let i = 1; i < bm.hitObjects.length; i++) {
    difficultyObjects.push(new OsuDifficultyHitObject(bm, ctx, bm.hitObjects[i], bm.hitObjects[i - 1], difficultyObjects, difficultyObjects.length));
  }

  // v167: 对应 lazer CreateSkills (无 FL mod 不创建 Flashlight)
  const aim = new Aim(true);
  const aimWithoutSliders = new Aim(false);
  const speed = new Speed();
  const reading = new Reading();

  // v167: 对应 lazer DifficultyCalculator.Calculate: 逐物件过全部技能
  for (const d of difficultyObjects) {
    aim.process(d);
    aimWithoutSliders.process(d);
    speed.process(d);
    reading.process(d);
  }

  const aimDifficultyValue = aim.difficultyValue();
  const aimNoSlidersDifficultyValue = aimWithoutSliders.difficultyValue();
  const speedDifficultyValue = speed.difficultyValue();
  const readingDifficultyValue = reading.difficultyValue();

  const aimDifficultStrainCount = aim.countTopWeightedStrains(aimDifficultyValue);
  const speedDifficultStrainCount = speed.countTopWeightedObjectDifficulties(speedDifficultyValue);
  const readingDifficultNoteCount = reading.countTopWeightedObjectDifficulties(readingDifficultyValue);

  const speedNotes = speed.relevantObjectCount();

  const aimNoSlidersTopWeightedSliderCount = aimWithoutSliders.countTopWeightedSliders(aimNoSlidersDifficultyValue);
  const aimNoSlidersDifficultStrainCount = aimWithoutSliders.countTopWeightedStrains(aimNoSlidersDifficultyValue);

  const aimTopWeightedSliderFactor = aimNoSlidersTopWeightedSliderCount / Math.max(1, aimNoSlidersDifficultStrainCount - aimNoSlidersTopWeightedSliderCount);

  const speedTopWeightedSliderCount = speed.countTopWeightedSliders(speedDifficultyValue);
  const speedTopWeightedSliderFactor = speedTopWeightedSliderCount / Math.max(1, speedDifficultStrainCount - speedTopWeightedSliderCount);

  const difficultSliders = aim.getDifficultSliders();

  const sliderFactor = aimDifficultyValue > 0
    ? calculateAimDifficultyRating(aimNoSlidersDifficultyValue) / calculateAimDifficultyRating(aimDifficultyValue)
    : 1;

  const aimRating = calculateAimDifficultyRating(aimDifficultyValue);
  const speedRating = calculateDifficultyRating(speedDifficultyValue);
  const readingRating = calculateDifficultyRating(readingDifficultyValue);

  const flashlightRating = 0.0; // 无 FL mod

  const baseAimPerformance = difficultyToPerformance(aimRating);
  const baseSpeedPerformance = difficultyToPerformance(speedRating);
  const baseReadingPerformance = difficultyToPerformance(readingRating);
  const baseFlashlightPerformance = 25 * pow(flashlightRating, 2); // v167: 对应 lazer Flashlight.DifficultyToPerformance
  // v167: 对应 lazer SumCognitionDifficulty: flashlight<=0 -> 返回 reading
  const baseCognitionPerformance = baseReadingPerformance <= 0 ? baseFlashlightPerformance
    : baseFlashlightPerformance <= 0 ? baseReadingPerformance
      : norm(PERFORMANCE_NORM_EXPONENT, baseReadingPerformance, baseFlashlightPerformance * Math.min(1, Math.max(0.25, baseFlashlightPerformance / baseReadingPerformance)));

  const basePerformance = norm(PERFORMANCE_NORM_EXPONENT, baseAimPerformance, baseSpeedPerformance, baseCognitionPerformance);

  const starRating = calculateStarRating(basePerformance);

  return {
    starRating,
    aimDifficulty: aimRating,
    speedDifficulty: speedRating,
    readingDifficulty: readingRating,
    flashlightDifficulty: flashlightRating,
    sliderFactor,
    aimDifficultStrainCount,
    speedDifficultStrainCount,
    readingDifficultNoteCount,
    aimTopWeightedSliderFactor,
    speedTopWeightedSliderFactor,
    aimDifficultSliderCount: difficultSliders,
    speedNoteCount: speedNotes,
  };
}

// v167: 技能 — 逐字移植 lazer
//   osu.Game.Rulesets.Osu/Difficulty/Skills/Aim.cs (VariableLengthStrainSkill 派生)
//   osu.Game.Rulesets.Osu/Difficulty/Skills/Speed.cs, Reading.cs (HarmonicSkill 派生)
//   osu.Game/Rulesets/Difficulty/Skills/Skill.cs / HarmonicSkill.cs / VariableLengthStrainSkill.cs
// 无 mod 简化: mods 恒空
import { OsuDifficultyHitObject } from './preprocessing';
import { logistic, logisticExp, norm, pow, lerp, clamp } from './diffUtils';
import {
  agilityEvaluate, flowAimEvaluate, readingEvaluate, rhythmEvaluate, snapAimEvaluate, speedEvaluate,
} from './evaluators';

// ---------- v167: 对应 lazer HarmonicSkill (Speed/Reading 基类) ----------
abstract class HarmonicSkill {
  objectDifficulties: number[] = [];
  objectWeightSum = 0;

  protected abstract harmonicScale: number; // Speed=20, Reading=1(默认)
  protected readonly decayExponent = 0.9;

  protected abstract objectDifficultyOf(current: OsuDifficultyHitObject): number;

  process(current: OsuDifficultyHitObject): void {
    this.objectDifficulties.push(this.objectDifficultyOf(current));
  }

  // v167: 对应 lazer HarmonicSkill.GetTransformedDifficulties (默认恒等; Reading 覆写)
  protected getTransformedDifficulties(difficulties: number[]): number[] { return difficulties; }

  difficultyValue(): number {
    this.objectWeightSum = 0;
    if (this.objectDifficulties.length === 0) return 0;

    const difficulties = this.getTransformedDifficulties(this.objectDifficulties);
    if (difficulties.length === 0) return 0;

    let difficulty = 0;
    let index = 0;

    const sorted = difficulties.filter(v => v > 0).sort((a, b) => b - a);
    for (const obj of sorted) {
      // 调和级数加权: 最难的物件权重最大
      const weight = (1 + (this.harmonicScale / (1 + index))) / (pow(index, this.decayExponent) + 1 + (this.harmonicScale / (1 + index)));
      this.objectWeightSum += weight;
      difficulty += obj * weight;
      index += 1;
    }

    return difficulty;
  }

  // v167: 对应 lazer HarmonicSkill.CountTopWeightedObjectDifficulties
  countTopWeightedObjectDifficulties(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0) return 0;
    if (this.objectWeightSum === 0) return 0;
    const consistentTopObject = difficultyValue / this.objectWeightSum;
    if (consistentTopObject === 0) return 0;
    return this.objectDifficulties.reduce((s, d) => s + logistic(d / consistentTopObject, 0.88, 10, 1.1), 0);
  }
}

// ---------- v167: 对应 lazer Aim (VariableLengthStrainSkill, decayWeight=0.9, maxSectionLength=400) ----------
interface StrainPeak { value: number; sectionLength: number } // lazer StrainPeak (SectionLength 构造时 Math.Round)

function makePeak(value: number, sectionLength: number): StrainPeak {
  return { value, sectionLength: Math.round(sectionLength) };
}

export class Aim {
  readonly includeSliders: boolean;
  objectDifficulties: number[] = [];

  private currentStrain = 0;
  private readonly sliderStrains: number[] = [];

  // VariableLengthStrainSkill 状态
  private readonly decayWeight = 0.9;
  private readonly maxSectionLength = 400;
  private readonly maxStoredLength = 11 / (1 - 0.9); // 保留 >=99.999% 难度值所需的节数
  private strainPeaks: StrainPeak[] = []; // AddInPlace 维持按 value 降序
  private totalLength = 0;
  private currentSectionPeak = 0;
  private currentSectionBegin = 0;
  private currentSectionEnd = 0;
  private queuedStrains: { strainValue: number; startTime: number }[] = [];
  private finalPeak: StrainPeak | null = null;

  constructor(includeSliders: boolean) { this.includeSliders = includeSliders; }

  private strainDecay(ms: number): number { return pow(0.2, ms / 1000); }

  private addPeakInPlace(peak: StrainPeak): void {
    // lazer ListExtensions.AddInPlace: 按 StrainPeak.CompareTo (value 降序) 二分插入
    let lo = 0, hi = this.strainPeaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.strainPeaks[mid].value >= peak.value) lo = mid + 1; else hi = mid;
    }
    this.strainPeaks.splice(lo, 0, peak);
  }

  process(current: OsuDifficultyHitObject): void {
    this.objectDifficulties.push(this.processInternal(current));
  }

  // v167: 对应 lazer VariableLengthStrainSkill.ProcessInternal
  private processInternal(current: OsuDifficultyHitObject): number {
    if (current.index === 0) {
      this.currentSectionBegin = current.startTime;
      this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
      this.currentSectionPeak = this.strainValueAt(current);
      return this.currentSectionPeak;
    }

    this.backfillPeaks(current);

    const currentStrain = this.strainValueAt(current);

    if (currentStrain > this.currentSectionPeak) {
      // 新峰: 队列内应变不再贡献难度, 清空
      this.queuedStrains = [];
      this.saveCurrentPeak(current.startTime - this.currentSectionBegin);
      this.currentSectionBegin = current.startTime;
      this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
      this.currentSectionPeak = currentStrain;
    } else {
      // 队列中比当前小的元素不再相关, 剔除
      while (this.queuedStrains.length > 0 && this.queuedStrains[this.queuedStrains.length - 1].strainValue < currentStrain)
        this.queuedStrains.pop();
      this.queuedStrains.push({ strainValue: currentStrain, startTime: current.startTime });
    }

    return currentStrain;
  }

  // v167: 对应 lazer VariableLengthStrainSkill.backfillPeaks
  private backfillPeaks(current: OsuDifficultyHitObject): void {
    while (current.startTime > this.currentSectionEnd) {
      this.saveCurrentPeak(this.currentSectionEnd - this.currentSectionBegin);
      this.currentSectionBegin = this.currentSectionEnd;

      if (this.queuedStrains.length > 0) {
        const { strainValue, startTime } = this.queuedStrains.shift()!;
        // 新节以该队列应变为影响源, 节尾在其后 MaxSectionLength
        this.currentSectionEnd = startTime + this.maxSectionLength;
        this.startNewSectionFrom(this.currentSectionBegin, current);
        this.currentSectionPeak = Math.max(this.currentSectionPeak, strainValue);
      } else {
        this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
        this.startNewSectionFrom(this.currentSectionBegin, current);
      }
    }
  }

  private saveCurrentPeak(sectionLength: number): void {
    if (this.finalPeak !== null) {
      const i = this.strainPeaks.indexOf(this.finalPeak);
      if (i >= 0) this.strainPeaks.splice(i, 1);
      this.finalPeak = null;
    }

    const peak = makePeak(this.currentSectionPeak, sectionLength);
    this.addPeakInPlace(peak);
    this.totalLength += sectionLength;

    // 过深不再贡献难度的节从尾部移除
    while (this.totalLength > this.maxStoredLength * this.maxSectionLength) {
      this.totalLength -= this.strainPeaks[this.strainPeaks.length - 1].sectionLength;
      this.strainPeaks.pop();
    }
  }

  private startNewSectionFrom(time: number, current: OsuDifficultyHitObject): void {
    this.currentSectionPeak = this.calculateInitialStrain(time, current);
  }

  // v167: 对应 lazer Aim.CalculateInitialStrain
  private calculateInitialStrain(time: number, current: OsuDifficultyHitObject): number {
    return this.currentStrain * this.strainDecay(time - current.previous(0)!.startTime);
  }

  // v167: 对应 lazer Aim.StrainValueAt
  private strainValueAt(current: OsuDifficultyHitObject): number {
    const decay = this.strainDecay(current.adjustedDeltaTime);

    this.currentStrain *= decay;
    this.currentStrain += this.calculateAdjustedDifficulty(current) * (1 - decay);

    if (current.base.type === 'slider')
      this.sliderStrains.push(this.currentStrain);

    return this.currentStrain;
  }

  // v167: 对应 lazer Aim.calculateAdjustedDifficulty
  private calculateAdjustedDifficulty(current: OsuDifficultyHitObject): number {
    const skill_multiplier_snap = 70.9;
    const skill_multiplier_agility = 2.35;
    const skill_multiplier_flow = 242.0;

    const snapDifficulty = snapAimEvaluate(current, this.includeSliders) * skill_multiplier_snap;
    const agilityDifficulty = agilityEvaluate(current) * skill_multiplier_agility;
    const flowDifficulty = flowAimEvaluate(current, this.includeSliders) * skill_multiplier_flow;

    let totalDifficulty = this.calculateTotalValue(snapDifficulty, agilityDifficulty, flowDifficulty);

    totalDifficulty *= 0.985 + pow(Math.max(0, current.overallDifficulty), 2) / 4000;

    return totalDifficulty;
  }

  // v167: 对应 lazer Aim.calculateTotalValue
  private calculateTotalValue(snapDifficulty: number, agilityDifficulty: number, flowDifficulty: number): number {
    const skill_multiplier_total = 1.12;
    const combined_snap_norm_exponent = 1.2;

    // flow 与 snap+agility 联合比较 (snap 单独在连打上超不过 flow)
    const combinedSnapDifficulty = norm(combined_snap_norm_exponent, snapDifficulty, agilityDifficulty);

    const pSnap = calculateSnapFlowProbability(flowDifficulty / combinedSnapDifficulty);
    const pFlow = 1 - pSnap;

    const totalDifficulty = combinedSnapDifficulty * pSnap + flowDifficulty * pFlow;

    return totalDifficulty * skill_multiplier_total;
  }

  // v167: 对应 lazer Aim.GetDifficultSliders
  getDifficultSliders(): number {
    if (this.sliderStrains.length === 0) return 0;
    const maxSliderStrain = Math.max(...this.sliderStrains);
    if (maxSliderStrain === 0) return 0;
    return this.sliderStrains.reduce((s, strain) => s + 1.0 / (1.0 + Math.exp(-(strain / maxSliderStrain * 12.0 - 6.0))), 0);
  }

  // v167: 对应 lazer Aim.CountTopWeightedSliders
  countTopWeightedSliders(difficultyValue: number): number {
    if (this.sliderStrains.length === 0) return 0;
    const consistentTopStrain = difficultyValue * (1 - this.decayWeight);
    if (consistentTopStrain === 0) return 0;
    return this.sliderStrains.reduce((s, v) => s + logistic(v / consistentTopStrain, 0.88, 10, 1.1), 0);
  }

  // v167: 对应 lazer Aim.DifficultyValue (覆写: 带节长的连续加权和)
  difficultyValue(): number {
    let difficulty = 0;
    let time = 0;

    const strains = this.getReducedStrainPeaks();

    for (const strain of strains) {
      // 权重函数 = DecayWeight^x 在 [startTime, endTime] 上的积分 (变体, 见 lazer 注释)
      const startTime = time;
      const endTime = time + strain.sectionLength / this.maxSectionLength;

      const weight = pow(this.decayWeight, startTime) - pow(this.decayWeight, endTime);

      difficulty += strain.value * weight;
      time = endTime;
    }

    return difficulty / (1 - this.decayWeight);
  }

  // v167: 对应 lazer VariableLengthStrainSkill.GetCurrentStrainPeaks (含当前节 finalPeak)
  private getCurrentStrainPeaks(): StrainPeak[] {
    if (this.finalPeak === null) {
      this.finalPeak = makePeak(this.currentSectionPeak, this.currentSectionEnd - this.currentSectionBegin);
      this.addPeakInPlace(this.finalPeak);
    }
    return this.strainPeaks;
  }

  // v167: 对应 lazer Aim.getReducedStrainPeaks (最高应变节按时间削减)
  private getReducedStrainPeaks(): StrainPeak[] {
    const reducedSectionTime = 4000;
    const reduced_strain_baseline = 0.727;

    // 0 应变的节排除 (不影响难度)
    const strains = this.getCurrentStrainPeaks().filter(p => p.value > 0);

    const chunk_size = 20;
    let time = 0;
    let skipCount = 0;

    while (strains.length > skipCount && time < reducedSectionTime) {
      const strain = strains[skipCount];

      for (let addedTime = 0; addedTime < strain.sectionLength; addedTime += chunk_size) {
        const scale = Math.log10(lerp(1, 10, clamp((time + addedTime) / reducedSectionTime, 0, 1)));
        strains.push(makePeak(
          strain.value * lerp(reduced_strain_baseline, 1.0, scale),
          Math.min(chunk_size, strain.sectionLength - addedTime),
        ));
      }

      time += strain.sectionLength;
      skipCount++;
    }

    return strains.slice(skipCount).sort((a, b) => b.value - a.value);
  }

  // v167: 对应 lazer VariableLengthStrainSkill.CountTopWeightedStrains
  countTopWeightedStrains(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0) return 0;
    const consistentTopStrain = difficultyValue * (1 - this.decayWeight);
    if (consistentTopStrain === 0) return this.objectDifficulties.length;
    return this.objectDifficulties.reduce((s, v) => s + 1.1 / (1 + Math.exp(-10 * (v / consistentTopStrain - 0.88))), 0);
  }
}

// snap/flow 概率分配 logistic 函数 (约束见 lazer 注释)
// v167: 对应 lazer Aim.calculateSnapFlowProbability
function calculateSnapFlowProbability(ratio: number): number {
  const k = 7.27;
  if (ratio === 0) return 0;
  if (Number.isNaN(ratio)) return 1;
  return logisticExp(-k * Math.log(ratio));
}

// ---------- v167: 对应 lazer Speed ----------
export class Speed extends HarmonicSkill {
  protected readonly harmonicScale = 20;

  private readonly sliderStrains: number[] = [];
  private currentStrain = 0;

  private strainDecay(ms: number): number { return pow(0.3, ms / 1000); }

  // v167: 对应 lazer Speed.ObjectDifficultyOf
  protected objectDifficultyOf(current: OsuDifficultyHitObject): number {
    const skill_multiplier = 1.16;

    const decay = this.strainDecay(current.adjustedDeltaTime);

    this.currentStrain *= decay;
    this.currentStrain += speedEvaluate(current) * (1 - decay) * skill_multiplier;

    const currentRhythm = rhythmEvaluate(current);

    const totalStrain = this.currentStrain * currentRhythm;

    if (current.base.type === 'slider')
      this.sliderStrains.push(totalStrain);

    return totalStrain;
  }

  // v167: 对应 lazer Speed.RelevantObjectCount
  relevantObjectCount(): number {
    if (this.objectDifficulties.length === 0) return 0;
    const maxStrain = Math.max(...this.objectDifficulties);
    if (maxStrain === 0) return 0;
    return this.objectDifficulties.reduce((s, strain) => s + 1.0 / (1.0 + Math.exp(-(strain / maxStrain * 12.0 - 6.0))), 0);
  }

  // v167: 对应 lazer Speed.CountTopWeightedSliders
  countTopWeightedSliders(difficultyValue: number): number {
    if (this.sliderStrains.length === 0) return 0;
    if (this.objectWeightSum === 0) return 0;
    const consistentTopObject = difficultyValue / this.objectWeightSum;
    if (consistentTopObject === 0) return 0;
    return this.sliderStrains.reduce((s, v) => s + logistic(v / consistentTopObject, 0.88, 10, 1.1), 0);
  }
}

// ---------- v167: 对应 lazer Reading ----------
export class Reading extends HarmonicSkill {
  protected readonly harmonicScale = 1.0; // lazer HarmonicSkill 默认值

  private readonly objectList: OsuDifficultyHitObject[] = [];
  private currentStrain = 0;

  private strainDecay(ms: number): number { return pow(0.8, ms / 1000); }

  // v167: 对应 lazer Reading.ObjectDifficultyOf (无 HD: hasHiddenMod=false)
  protected objectDifficultyOf(current: OsuDifficultyHitObject): number {
    const skill_multiplier = 2.5;

    this.objectList.push(current);

    const decay = this.strainDecay(current.deltaTime); // 注意: 用 DeltaTime (非 Adjusted)

    this.currentStrain *= decay;
    this.currentStrain += this.calculateAdjustedDifficulty(current) * (1 - decay) * skill_multiplier;

    return this.currentStrain;
  }

  // v167: 对应 lazer Reading.calculateAdjustedDifficulty
  private calculateAdjustedDifficulty(current: OsuDifficultyHitObject): number {
    let difficulty = readingEvaluate(current);
    difficulty *= 0.825 + pow(Math.max(0, current.overallDifficulty), 2.2) / 1125.0;
    return difficulty;
  }

  // v167: 对应 lazer Reading.GetTransformedDifficulties (前 60 秒视为已背板, 按序削弱 — 在排序前的原始顺序上操作)
  protected getTransformedDifficulties(difficulties: number[]): number[] {
    const filtered = difficulties.filter(v => v > 0);

    const reduced_difficulty_base_line = 0.0; // 开头几秒视为完全背板

    const reducedNoteCount = this.calculateReducedNoteCount();

    for (let i = 0; i < Math.min(filtered.length, reducedNoteCount); i++) {
      const scale = Math.log10(lerp(1, 10, clamp(i / reducedNoteCount, 0, 1)));
      filtered[i] *= lerp(reduced_difficulty_base_line, 1.0, scale);
    }

    return filtered;
  }

  // v167: 对应 lazer Reading.calculateReducedNoteCount (前 60 秒内的物件数)
  private calculateReducedNoteCount(): number {
    const reduced_difficulty_duration = 60 * 1000;

    if (this.objectList.length === 0) return 0;

    const reducedDuration = this.objectList[0].startTime + reduced_difficulty_duration;

    let reducedNoteCount = 0;

    for (const hitObject of this.objectList) {
      if (hitObject.startTime > reducedDuration) break;
      reducedNoteCount++;
    }

    return reducedNoteCount;
  }

  // v167: 对应 lazer Reading.CountTopWeightedObjectDifficulties (覆写: logistic 参数 1.15/5)
  override countTopWeightedObjectDifficulties(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0) return 0;
    if (this.objectWeightSum === 0) return 0;
    const consistentTopNote = difficultyValue / this.objectWeightSum;
    if (consistentTopNote === 0) return 0;
    return this.objectDifficulties.reduce((s, d) => s + logistic(d / consistentTopNote, 1.15, 5, 1.1), 0);
  }
}

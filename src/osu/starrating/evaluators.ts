// v167: 难度评估器 — 逐字移植 lazer osu.Game.Rulesets.Osu/Difficulty/Evaluators/*
//   Aim/SnapAimEvaluator.cs, Aim/AgilityEvaluator.cs, Aim/FlowAimEvaluator.cs
//   Speed/SpeedEvaluator.cs, Speed/RhythmEvaluator.cs, ReadingEvaluator.cs
// 无 mod 简化: Autopilot/Relax/Magnetised/TouchDevice/Hidden 分支均不进入
import {
  MIN_DELTA_TIME, NORMALISED_DIAMETER, NORMALISED_RADIUS, OsuDifficultyHitObject,
} from './preprocessing';
import {
  bpmToMilliseconds, clamp, logistic, millisecondsToBPM, pow, reverseLerp,
  smootherstep, smoothstep, smoothstepBellCurve,
} from './diffUtils';

const DEG = Math.PI / 180;

// ---------- v167: 对应 lazer SnapAimEvaluator ----------
export function snapAimEvaluate(current: OsuDifficultyHitObject, withSliderTravelDistance: boolean): number {
  if (current.base.type === 'spinner' || current.index <= 1 || current.previous(0)!.base.type === 'spinner')
    return 0;

  const wide_angle_multiplier = 9.67;
  const acute_angle_multiplier = 2.41;
  const slider_multiplier = 1.5;
  const velocity_change_multiplier = 0.9;
  // WARNING: 该倍率超过 1.02 会导致距离越远难度越低 (见 lazer 注释)
  const wiggle_multiplier = 1.02;

  const osuCurrObj = current;
  const osuLastObj = current.previous(0)!;
  const osuLast2Obj = current.previous(2);

  const radius = NORMALISED_RADIUS;
  const diameter = NORMALISED_DIAMETER;

  let currDistance = withSliderTravelDistance ? osuCurrObj.lazyJumpDistance : osuCurrObj.jumpDistance;
  let currVelocity = currDistance / osuCurrObj.adjustedDeltaTime;

  // 上个物件是滑条: 滑行速度延续进当前物件
  if (osuLastObj.base.type === 'slider' && withSliderTravelDistance) {
    const sliderDistance = osuLastObj.lazyTravelDistance + osuCurrObj.lazyJumpDistance;
    currVelocity = Math.max(currVelocity, sliderDistance / osuCurrObj.adjustedDeltaTime);
  }

  const prevDistance = withSliderTravelDistance ? osuLastObj.lazyJumpDistance : osuLastObj.jumpDistance;
  const prevVelocity = prevDistance / osuLastObj.adjustedDeltaTime;

  let snapDifficulty = currVelocity;

  // 角度重复惩罚
  snapDifficulty *= vectorAngleRepetition(osuCurrObj, osuLastObj);

  if (osuCurrObj.angle !== null && osuLastObj.angle !== null) {
    const currAngle = osuCurrObj.angle;
    const lastAngle = osuLastObj.angle;

    // 角度加成取较小速度为基础
    const velocityInfluence = Math.min(currVelocity, prevVelocity);

    let acuteAngleBonus = 0;

    // 节奏相同才给锐角加成
    if (Math.max(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime) < 1.25 * Math.min(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime)) {
      acuteAngleBonus = calcAngleAcuteness(currAngle);

      // 角度重复惩罚 (在任何乘算之前, 因比较的是原始锐度)
      acuteAngleBonus *= 0.08 + 0.92 * (1 - Math.min(acuteAngleBonus, pow(calcAngleAcuteness(lastAngle), 3)));

      // 300BPM 1/2 以上且距离超一个直径才应用锐角加成
      acuteAngleBonus *= velocityInfluence * smootherstep(millisecondsToBPM(osuCurrObj.adjustedDeltaTime, 2), 300, 400)
        * smootherstep(currDistance, 0, diameter * 2);
    }

    let wideAngleBonus = calcAngleWideness(currAngle);

    // 角度重复惩罚 (同上, 乘速度之前)
    wideAngleBonus *= 0.25 + 0.75 * (1 - Math.min(wideAngleBonus, pow(calcAngleWideness(lastAngle), 3)));

    // 广角加成的时间重标定
    const wide_angle_time_scale = 1.45;
    let wideAngleCurrVelocity = currDistance / pow(osuCurrObj.adjustedDeltaTime, wide_angle_time_scale);
    const wideAnglePrevVelocity = prevDistance / pow(osuLastObj.adjustedDeltaTime, wide_angle_time_scale);

    if (osuLastObj.base.type === 'slider' && withSliderTravelDistance) {
      const sliderDistance = osuLastObj.lazyTravelDistance + osuCurrObj.lazyJumpDistance;
      wideAngleCurrVelocity = Math.max(wideAngleCurrVelocity, sliderDistance / pow(osuCurrObj.adjustedDeltaTime, wide_angle_time_scale));
    }

    wideAngleBonus *= Math.min(wideAngleCurrVelocity, wideAnglePrevVelocity);

    if (osuLast2Obj !== null) {
      // 经中点往返的移动: 广角加成打折
      // 用 Previous(2)/Previous(0): 角度始终以"前一个物件"为中心点
      const distance = Math.hypot(
        osuLast2Obj.stackedPos(osuLast2Obj.base).x - osuLastObj.stackedPos(osuLastObj.base).x,
        osuLast2Obj.stackedPos(osuLast2Obj.base).y - osuLastObj.stackedPos(osuLastObj.base).y,
      );
      if (distance < 1) {
        wideAngleBonus *= 1 - 0.55 * (1 - distance);
      }
    }

    // 锐角/广角加成取大者
    snapDifficulty += Math.max(acuteAngleBonus * acute_angle_multiplier, wideAngleBonus * wide_angle_multiplier);

    // wiggle 加成: 距离 [radius, 3*diameter] 且角度 < 110° 的跳
    const wiggleBonus = velocityInfluence
      * smootherstep(currDistance, radius, diameter)
      * pow(reverseLerp(currDistance, diameter * 3, diameter), 1.8)
      * smootherstep(currAngle, 110 * DEG, 60 * DEG)
      * smootherstep(prevDistance, radius, diameter)
      * pow(reverseLerp(prevDistance, diameter * 3, diameter), 1.8)
      * smootherstep(lastAngle, 110 * DEG, 60 * DEG);

    snapDifficulty += wiggleBonus * wiggle_multiplier;
  }

  if (Math.max(prevVelocity, currVelocity) !== 0) {
    if (withSliderTravelDistance) {
      // 奖励速度差时只用纯跳速度 (不含滑行速度)
      currVelocity = currDistance / osuCurrObj.adjustedDeltaTime;
    }

    const distRatio = smoothstep(Math.abs(prevVelocity - currVelocity) / Math.max(prevVelocity, currVelocity), 0, 1);

    // 重叠区速度仍在变化的奖励 (上限 1.25 直径 / 时间)
    const overlapVelocityBuff = Math.min(diameter * 1.25 / Math.min(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime), Math.abs(prevVelocity - currVelocity));

    let velocityChangeBonus = overlapVelocityBuff * distRatio;

    // 节奏变化惩罚
    velocityChangeBonus *= pow(Math.min(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime) / Math.max(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime), 2);

    snapDifficulty += velocityChangeBonus * velocity_change_multiplier;
  }

  // 按速度奖励滑条
  if (osuCurrObj.base.type === 'slider' && withSliderTravelDistance) {
    const sliderBonus = osuCurrObj.travelDistance / osuCurrObj.travelTime;
    snapDifficulty += (sliderBonus < 1 ? sliderBonus : pow(sliderBonus, 0.75)) * slider_multiplier;
  }

  snapDifficulty *= osuCurrObj.smallCircleBonus;
  snapDifficulty *= snapHighBpmBonus(osuCurrObj.adjustedDeltaTime);

  return snapDifficulty;
}

function snapHighBpmBonus(ms: number): number { return 1 / (1 - pow(0.03, pow(ms / 1000, 0.65))); }

function vectorAngleRepetition(current: OsuDifficultyHitObject, previous: OsuDifficultyHitObject): number {
  if (current.angle === null || previous.angle === null) return 1;

  const note_limit = 6;
  const maximum_repetition_nerf = 0.15;
  const maximum_vector_influence = 0.5;

  let constantAngleCount = 0;

  for (let index = 0; index < note_limit; index++) {
    const prevObj = current.previous(index);
    if (prevObj === null) break;

    // 只考虑同一跳段内的向量; 节奏改变则停止
    if (Math.max(current.adjustedDeltaTime, prevObj.adjustedDeltaTime) > 1.1 * Math.min(current.adjustedDeltaTime, prevObj.adjustedDeltaTime))
      break;

    if (prevObj.normalisedVectorAngle !== null && current.normalisedVectorAngle !== null) {
      const angleDifference = Math.abs(current.normalisedVectorAngle - prevObj.normalisedVectorAngle);
      // 常数须精确以保持在 [0,1] (见 lazer 注释 desmos)
      constantAngleCount += Math.cos(8 * Math.min(11.25 * DEG, angleDifference));
    }
  }

  const vectorRepetition = pow(Math.min(0.5 / constantAngleCount, 1), 2);

  const stackFactor = smootherstep(current.lazyJumpDistance, 0, NORMALISED_DIAMETER);

  const currAngle = current.angle;
  const lastAngle = previous.angle;

  const angleDifferenceAdjusted = Math.cos(2 * Math.min(45 * DEG, Math.abs(currAngle - lastAngle) * stackFactor));

  const baseNerf = 1 - maximum_repetition_nerf * calcAngleAcuteness(lastAngle) * angleDifferenceAdjusted;

  return pow(baseNerf + (1 - baseNerf) * vectorRepetition * maximum_vector_influence * stackFactor, 2);
}

function calcAngleWideness(angle: number): number { return smoothstep(angle, 40 * DEG, 140 * DEG); }
export function calcAngleAcuteness(angle: number): number { return smoothstep(angle, 140 * DEG, 40 * DEG); }

// ---------- v167: 对应 lazer AgilityEvaluator ----------
export function agilityEvaluate(current: OsuDifficultyHitObject): number {
  if (current.base.type === 'spinner') return 0;

  const distance_cap = NORMALISED_DIAMETER * 1.2; // 1.2 个圆圈心距

  const osuCurrObj = current;
  const osuPrevObj = current.index > 0 ? current.previous(0) : null;

  const travelDistance = osuPrevObj?.lazyTravelDistance ?? 0;
  const distance = travelDistance + osuCurrObj.lazyJumpDistance;

  const distanceScaled = Math.min(distance, distance_cap) / distance_cap;

  let agilityDifficulty = distanceScaled * 1000 / osuCurrObj.adjustedDeltaTime;

  agilityDifficulty *= pow(osuCurrObj.smallCircleBonus, 1.5);
  agilityDifficulty *= agilityHighBpmBonus(osuCurrObj.adjustedDeltaTime);

  return agilityDifficulty;
}

function agilityHighBpmBonus(ms: number): number { return 1 / (1 - pow(0.2, ms / 1000)); }

// ---------- v167: 对应 lazer FlowAimEvaluator ----------
export function flowAimEvaluate(current: OsuDifficultyHitObject, withSliderTravelDistance: boolean): number {
  if (current.base.type === 'spinner' || current.index <= 1 || current.previous(0)!.base.type === 'spinner')
    return 0;

  const velocity_change_multiplier = 0.52;

  const osuCurrObj = current;
  const osuLastObj = current.previous(0)!;
  const osuLastLastObj = current.previous(1);

  const currDistance = withSliderTravelDistance ? osuCurrObj.lazyJumpDistance : osuCurrObj.jumpDistance;
  const prevDistance = withSliderTravelDistance ? osuLastObj.lazyJumpDistance : osuLastObj.jumpDistance;

  let currVelocity = currDistance / osuCurrObj.adjustedDeltaTime;

  if (osuLastObj.base.type === 'slider' && withSliderTravelDistance) {
    const sliderDistance = osuLastObj.lazyTravelDistance + osuCurrObj.lazyJumpDistance;
    currVelocity = Math.max(currVelocity, sliderDistance / osuCurrObj.adjustedDeltaTime);
  }

  const prevVelocity = prevDistance / osuLastObj.adjustedDeltaTime;

  let flowDifficulty = currVelocity;

  // 基础速度先吃缩水的 CS 加成 (该加成原为本评估器之外的 d/t 标定设计)
  flowDifficulty *= Math.sqrt(osuCurrObj.smallCircleBonus);

  // 节奏变化更难 flow
  flowDifficulty *= 1 + Math.min(0.25,
    pow((Math.max(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime) - Math.min(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime)) / 50, 4));

  if (osuCurrObj.angle !== null && osuLastObj.angle !== null) {
    const angleDifference = Math.abs(osuCurrObj.angle - osuLastObj.angle);
    const angleDifferenceAdjusted = Math.sin(angleDifference / 2) * 180.0;
    const angularVelocity = angleDifferenceAdjusted / (osuCurrObj.adjustedDeltaTime * 0.1);

    // 低角速度 (角度一致) 的 flow 比杂乱的更容易跟
    flowDifficulty *= 0.8 + Math.sqrt(angularVelocity / 270.0);
  }

  // 三物全重叠时不给加成 (无需额外移动)
  let overlappedNotesWeight = 1;

  if (current.index > 2) {
    const o1 = calculateOverlapFactor(osuCurrObj, osuLastObj);
    const o2 = calculateOverlapFactor(osuCurrObj, osuLastLastObj!);
    const o3 = calculateOverlapFactor(osuLastObj, osuLastLastObj!);
    overlappedNotesWeight = 1 - o1 * o2 * o3;
  }

  if (osuCurrObj.angle !== null) {
    // 锐角同样难 flow
    flowDifficulty += currVelocity * calcAngleAcuteness(osuCurrObj.angle) * overlappedNotesWeight;
  }

  if (Math.max(prevVelocity, currVelocity) !== 0) {
    if (withSliderTravelDistance) {
      currVelocity = currDistance / osuCurrObj.adjustedDeltaTime;
    }

    const distRatio = smoothstep(Math.abs(prevVelocity - currVelocity) / Math.max(prevVelocity, currVelocity), 0, 1);

    const overlapVelocityBuff = Math.min(NORMALISED_DIAMETER * 1.25 / Math.min(osuCurrObj.adjustedDeltaTime, osuLastObj.adjustedDeltaTime),
      Math.abs(prevVelocity - currVelocity));

    flowDifficulty += overlapVelocityBuff * distRatio * overlappedNotesWeight * velocity_change_multiplier;
  }

  if (osuCurrObj.base.type === 'slider' && withSliderTravelDistance) {
    // 计入滑条速度使 flow 与 snap 的速度口径一致
    flowDifficulty += osuCurrObj.travelDistance / osuCurrObj.travelTime;
  }

  // 最终速度取幂: flow 随距离与时间同时增长更快
  flowDifficulty = pow(flowDifficulty, 1.45);

  // 间距低于半径恒为 flow, 低间距减难度
  return flowDifficulty * smootherstep(currDistance, 0, NORMALISED_RADIUS);
}

function calculateOverlapFactor(first: OsuDifficultyHitObject, second: OsuDifficultyHitObject): number {
  const firstPos = first.stackedPos(first.base);
  const secondPos = second.stackedPos(second.base);
  const objectRadius = first.ctxRadius();
  const distance = Math.hypot(firstPos.x - secondPos.x, firstPos.y - secondPos.y);
  return clamp(1 - pow(Math.max(distance - objectRadius, 0) / objectRadius, 2), 0, 1);
}

// ---------- v167: 对应 lazer SpeedEvaluator ----------
export function speedEvaluate(current: OsuDifficultyHitObject): number {
  if (current.base.type === 'spinner') return 0;

  const min_speed_bonus = 200; // 200 BPM 1/4
  const speed_balancing_factor = 40;

  const osuCurrObj = current;

  let strainTime = osuCurrObj.adjustedDeltaTime;
  const doubleTapFeasibility = 1.0 - osuCurrObj.calculateDoubleTapFeasibility(osuCurrObj.next(0));

  // deltaTime 封顶到 OD 300 判定窗
  // 0.93 保证 260bpm OD8 连打不被狠削, 0.92 限制封顶影响
  strainTime /= clamp((strainTime / osuCurrObj.hitWindowGreat) / 0.93, 0.92, 1);

  // BPM < 200 时 speedBonus 为 0
  let speedBonus = 0.0;

  if (millisecondsToBPM(strainTime) > min_speed_bonus)
    speedBonus = 0.75 * pow((bpmToMilliseconds(min_speed_bonus) - strainTime) / speed_balancing_factor, 2);

  let speedDifficulty = (1 + speedBonus) * 1000 / strainTime;

  speedDifficulty *= speedHighBpmBonus(osuCurrObj.adjustedDeltaTime);

  // 双押可糊惩罚
  return speedDifficulty * doubleTapFeasibility;
}

function speedHighBpmBonus(ms: number): number { return 1 / (1 - pow(0.3, ms / 1000)); }

// ---------- v167: 对应 lazer RhythmEvaluator ----------
class Island {
  delta: number;
  deltaCount = 1;
  occurrences = 1;

  constructor(delta: number) {
    this.delta = Math.max(delta, MIN_DELTA_TIME);
  }

  addDelta(delta: number): void {
    if (this.delta === Number.MAX_SAFE_INTEGER) this.delta = Math.max(delta, MIN_DELTA_TIME);
    this.deltaCount++;
  }

  isSimilarPolarity(other: Island, epsilon: number): boolean {
    // 单 delta 岛不参与比较
    if (this.deltaCount <= 1 || other.deltaCount <= 1) return false;
    return Math.abs(this.delta - other.delta) < epsilon && this.deltaCount % 2 === other.deltaCount % 2;
  }

  almostEquals(other: Island, epsilon: number): boolean {
    return Math.abs(this.delta - other.delta) < epsilon && this.deltaCount === other.deltaCount;
  }
}

function rhythmGetEffectiveDifficulty(deltaDifferenceRatio: number): number {
  const rhythm_ratio_difficulty_multiplier = 26.0;
  // 只取小数部分 — 只惩罚倍数关系
  const deltaDifferenceFraction = deltaDifferenceRatio - Math.trunc(deltaDifferenceRatio);
  return 1.0 + rhythm_ratio_difficulty_multiplier * Math.min(0.5, smoothstepBellCurve(deltaDifferenceFraction));
}

export function rhythmEvaluate(current: OsuDifficultyHitObject): number {
  if (current.base.type === 'spinner') return 0;

  const history_time_max = 5 * 1000; // 5 秒
  const history_objects_max = 32;
  const rhythm_overall_multiplier = 0.95;

  let rhythmComplexitySum = 0;

  const deltaDifferenceEpsilon = current.hitWindowGreat * 0.3;

  let island = new Island(Number.MAX_SAFE_INTEGER); // lazer 用 int.MaxValue 作哨兵
  let previousIsland = new Island(Number.MAX_SAFE_INTEGER);

  const islands: Island[] = [];

  let startDifficulty = 0; // 当前岛起始难度, 用于更紧凑节奏的加成

  let firstDeltaSwitch = false;

  const historicalNoteCount = Math.min(current.index, history_objects_max);

  let rhythmStart = 0;

  while (rhythmStart < historicalNoteCount - 2 && current.startTime - current.previous(rhythmStart)!.startTime < history_time_max)
    rhythmStart++;

  let prevObj = current.previous(rhythmStart)!;
  let prevPrevObj = current.previous(rhythmStart + 1);

  // 从最远的物件回到当前物件
  for (let i = rhythmStart; i > 0; i--) {
    const currObj = current.previous(i - 1)!;

    if (currObj.base.type === 'spinner') continue;

    // 时间衰减: 历史 -> 现在 从 0 到 1
    const timeDecay = (history_time_max - (current.startTime - currObj.startTime)) / history_time_max;
    const noteDecay = (historicalNoteCount - i) / historicalNoteCount;

    const currHistoricalDecay = Math.min(noteDecay, timeDecay); // 受时间或物件数限制

    // 自定义下限保证此处 delta time 非零
    const delta_min_value = 1e-7;

    const currDelta = Math.max(currObj.deltaTime, delta_min_value);
    const prevDelta = Math.max(prevObj.deltaTime, delta_min_value);

    const deltaDifference = Math.abs(prevDelta - currDelta);

    // 确保岛已初始化 (否则要到下一次节奏变化才初始化)
    if (island.delta === Number.MAX_SAFE_INTEGER)
      island = new Island(Math.trunc(currDelta));

    // delta 差异应得多少节奏加成 — 惩罚倍数关系 (如 100 与 200)
    const deltaDifferenceRatio = Math.max(prevDelta, currDelta) / Math.min(prevDelta, currDelta);

    // 差异过大时削减比率加成
    const differenceMultiplier = clamp(2.0 - deltaDifferenceRatio / 8.0, 0, 1);

    const windowPenalty = clamp((deltaDifference - deltaDifferenceEpsilon) / deltaDifferenceEpsilon, 0, 1);

    let effectiveDifficulty = rhythmGetEffectiveDifficulty(deltaDifferenceRatio) * windowPenalty * differenceMultiplier;

    // 前物件是滑条可能更好按 (不用完整按键动作)
    if (prevObj.base.type === 'slider') {
      const sliderLazyEndDelta = currObj.minimumJumpTime;
      const sliderLazyDeltaDifferenceRatio = Math.max(sliderLazyEndDelta, currDelta) / Math.min(sliderLazyEndDelta, currDelta);

      const sliderRealEndDelta = currObj.lastObjectEndDeltaTime;
      const sliderRealDeltaDifferenceRatio = Math.max(sliderRealEndDelta, currDelta) / Math.min(sliderRealEndDelta, currDelta);

      const sliderEffectiveDifficulty = Math.min(rhythmGetEffectiveDifficulty(sliderLazyDeltaDifferenceRatio), rhythmGetEffectiveDifficulty(sliderRealDeltaDifferenceRatio));
      effectiveDifficulty = Math.min(sliderEffectiveDifficulty, effectiveDifficulty);
    }

    if (deltaDifference < deltaDifferenceEpsilon) {
      // 岛仍在延续
      island.addDelta(Math.trunc(currDelta));
    }

    if (firstDeltaSwitch) {
      if (deltaDifference > deltaDifferenceEpsilon) {
        // bpm 变化落进滑条, 判定窗宽松
        if (currObj.base.type === 'slider')
          effectiveDifficulty *= 0.5;

        // 重复岛极性 (2 -> 4, 3 -> 5)
        if (island.isSimilarPolarity(previousIsland, deltaDifferenceEpsilon))
          effectiveDifficulty *= 0.5;

        // 一次变化前刚增过速 (1/1->1/2-1/4), 不应加成
        if (Math.max(prevPrevObj!.deltaTime, delta_min_value) > prevDelta + deltaDifferenceEpsilon && prevDelta > currDelta + deltaDifferenceEpsilon)
          effectiveDifficulty *= 0.125;

        // 重复岛长度 (如 三连 -> 三连)
        // TODO: lazer 注释 — 仅为平衡保留
        if (previousIsland.deltaCount === island.deltaCount)
          effectiveDifficulty *= 0.5;

        const isSpeedingUp = prevDelta > currDelta + deltaDifferenceEpsilon;

        if (isSpeedingUp)
          effectiveDifficulty *= 0.65;

        let found = false;

        for (const existingIsland of islands) {
          if (existingIsland.almostEquals(island, deltaDifferenceEpsilon)) {
            // 仅当岛连续出现时才增加次数
            if (previousIsland.almostEquals(island, deltaDifferenceEpsilon))
              existingIsland.occurrences++;

            // 重复岛 (如 三连 -> 三连)
            const power = logistic(island.delta, 58.33, 0.24, 2.75);
            effectiveDifficulty *= Math.min(3.0 / existingIsland.occurrences, pow(1.0 / existingIsland.occurrences, power));

            found = true;
            break;
          }
        }

        if (!found && island.deltaCount > 0)
          islands.push(island);

        // 可双押时缩减难度
        effectiveDifficulty *= 1 - prevObj.calculateDoubleTapFeasibility(currObj) * 0.75;

        if (island.deltaCount > 1) {
          rhythmComplexitySum += Math.sqrt(effectiveDifficulty * startDifficulty) * currHistoricalDecay;
        } else {
          // 单音岛固定难度
          rhythmComplexitySum += 0.7 * currHistoricalDecay;
        }

        startDifficulty = effectiveDifficulty;

        if (prevDelta + deltaDifferenceEpsilon < currDelta) // 正在减速, 停止计数
          firstDeltaSwitch = false; // 若正在加速则保持 true, 继续计岛长度

        previousIsland = island;
        island = new Island(Math.trunc(currDelta));
      }
    } else if (prevDelta > currDelta + deltaDifferenceEpsilon) { // 正在加速
      // 开始计岛直到再次变速
      firstDeltaSwitch = true;

      // bpm 变化落进滑条, 判定窗宽松
      if (currObj.base.type === 'slider')
        effectiveDifficulty *= 0.6;

      // bpm 变化起自滑条, 通常比 圆->圆 更容易
      if (prevObj.base.type === 'slider')
        effectiveDifficulty *= 0.6;

      startDifficulty = effectiveDifficulty;

      island = new Island(Math.trunc(currDelta));
    }

    prevPrevObj = prevObj;
    prevObj = currObj;
  }

  // 当前岛过长时削减总和影响
  rhythmComplexitySum *= reverseLerp(island.deltaCount, 22, 3);

  return Math.sqrt(4 + rhythmComplexitySum * rhythm_overall_multiplier) / 2.0; // 输出乘数, 范围 [1, inf)
}

// ---------- v167: 对应 lazer ReadingEvaluator (无 HD: hiddenDifficulty 恒 0) ----------
const reading_window_size = 3000; // 3 秒
const distance_influence_threshold = NORMALISED_DIAMETER * 1.5; // 1.5 个圆圈心距

export function readingEvaluate(current: OsuDifficultyHitObject): number {
  if (current.base.type === 'spinner' || current.index === 0) return 0;

  const currObj = current;
  const nextObj = current.next(0);

  const velocity = Math.max(1, currObj.lazyJumpDistance / currObj.adjustedDeltaTime); // 只允许速度加成

  const currentVisibleObjectDensity = retrieveCurrentVisibleObjectDensity(currObj);
  const pastObjectDifficultyInfluence = getPastObjectDifficultyInfluence(currObj);

  const constantAngleNerfFactor = getConstantAngleNerfFactor(currObj);

  const noteDensityDifficulty = calculateDensityDifficulty(nextObj, velocity, constantAngleNerfFactor, pastObjectDifficultyInfluence, currentVisibleObjectDensity);

  // 无 Hidden mod: hiddenDifficulty = 0
  const preemptDifficulty = calculatePreemptDifficulty(velocity, constantAngleNerfFactor, currObj.preempt);

  // v167: 对应 lazer DiffUtils.Norm(1.5, preempt, hidden=0, density)
  let readingDifficulty = norm15(preemptDifficulty, 0, noteDensityDifficulty);

  // 处理信息的时间越少越难
  readingDifficulty *= readingHighBpmBonus(currObj.adjustedDeltaTime);

  return readingDifficulty;
}

function norm15(a: number, b: number, c: number): number {
  return pow(pow(a, 1.5) + pow(b, 1.5) + pow(c, 1.5), 1 / 1.5);
}

function calculateDensityDifficulty(nextObj: OsuDifficultyHitObject | null, velocity: number, constantAngleNerfFactor: number,
  pastObjectDifficultyInfluence: number, currentVisibleObjectDensity: number): number {
  const density_multiplier = 2.4;
  const density_difficulty_base = 2.5;

  // 也考虑未来密度 (光标路径更不清晰)
  let futureObjectDifficultyInfluence = Math.sqrt(currentVisibleObjectDensity);

  if (nextObj !== null) {
    // 到下一件移动小则减难度
    futureObjectDifficultyInfluence *= smootherstep(nextObj.lazyJumpDistance, 15, distance_influence_threshold);
  }

  // 密度按指数计值
  let noteDensityDifficulty = pow(pastObjectDifficultyInfluence + futureObjectDifficultyInfluence, 1.7) * 0.4 * constantAngleNerfFactor * velocity;

  // 只奖励密度高于平均的谱面
  noteDensityDifficulty = Math.max(0, noteDensityDifficulty - density_difficulty_base);

  // 软上限 (部分背板)
  noteDensityDifficulty = pow(noteDensityDifficulty, 0.45) * density_multiplier;

  return noteDensityDifficulty;
}

function calculatePreemptDifficulty(velocity: number, constantAngleNerfFactor: number, preempt: number): number {
  const preempt_balancing_factor = 140000;
  const preempt_starting_point = 500; // AR 9.66 对应的 ms

  // AR 升高时 preempt 难度的任意曲线 (见 lazer 注释 desmos)
  let preemptDifficulty = pow((preempt_starting_point - preempt + Math.abs(preempt - preempt_starting_point)) / 2, 2.5) / preempt_balancing_factor;

  preemptDifficulty *= constantAngleNerfFactor * velocity;

  return preemptDifficulty;
}

function getPastObjectDifficultyInfluence(currObj: OsuDifficultyHitObject): number {
  let pastObjectDifficultyInfluence = 0;

  for (const loopObj of retrievePastVisibleObjects(currObj)) {
    let loopDifficulty = currObj.opacityAt(loopObj.base.time, false);

    // 距离小意味着前物件可被糊, 排列是否混乱无所谓
    loopDifficulty *= smootherstep(loopObj.lazyJumpDistance, 15, distance_influence_threshold);

    // 接近 reading 窗口上限的物件权重更低
    const timeBetweenCurrAndLoopObj = currObj.startTime - loopObj.startTime;
    const timeNerfFactor = getTimeNerfFactor(timeBetweenCurrAndLoopObj);

    loopDifficulty *= timeNerfFactor;
    pastObjectDifficultyInfluence += loopDifficulty;
  }

  return pastObjectDifficultyInfluence;
}

// 当前物件出现时屏幕上可见的物件
function* retrievePastVisibleObjects(current: OsuDifficultyHitObject): Generator<OsuDifficultyHitObject> {
  for (let i = 0; i < current.index; i++) {
    const hitObject = current.previous(i);

    if (hitObject === null ||
      current.startTime - hitObject.startTime > reading_window_size ||
      hitObject.startTime < current.startTime - current.preempt) // 物件需被点击时当前物件尚不可见
      break;

    yield hitObject;
  }
}

// 当前物件需被点击时可见物件的密度 (按 reading 窗口截断)
function retrieveCurrentVisibleObjectDensity(current: OsuDifficultyHitObject): number {
  let visibleObjectCount = 0;

  let hitObject = current.next(0);

  while (hitObject !== null) {
    if (hitObject.startTime - current.startTime > reading_window_size ||
      current.startTime < hitObject.startTime - hitObject.preempt) // 当前物件需被点击时该物件尚不可见
      break;

    const timeBetweenCurrAndLoopObj = hitObject.startTime - current.startTime;
    const timeNerfFactor = getTimeNerfFactor(timeBetweenCurrAndLoopObj);

    visibleObjectCount += hitObject.opacityAt(current.base.time, false) * timeNerfFactor;

    hitObject = hitObject.next(0);
  }

  return visibleObjectCount;
}

// 当前物件角度在一定时间窗内重复的次数因子 (见 lazer 注释 desmos)
function getConstantAngleNerfFactor(current: OsuDifficultyHitObject): number {
  const minimum_angle_relevancy_time = 2000; // 2 秒
  const maximum_angle_relevancy_time = 200;

  let constantAngleCount = 0;
  let index = 0;
  let currentTimeGap = 0;

  let loopObjPrev0: OsuDifficultyHitObject = current;
  let loopObjPrev1: OsuDifficultyHitObject | null = null;
  let loopObjPrev2: OsuDifficultyHitObject | null = null;

  while (currentTimeGap < minimum_angle_relevancy_time) {
    const loopObj = current.previous(index);

    if (loopObj === null) break;

    // 接近时间上限的物件权重更低
    const longIntervalFactor = 1 - reverseLerp(loopObj.adjustedDeltaTime, maximum_angle_relevancy_time, minimum_angle_relevancy_time);

    if (loopObj.angle !== null && current.angle !== null) {
      const angleDifference = Math.abs(current.angle - loopObj.angle);
      let angleDifferenceAlternating = Math.PI;

      if (loopObjPrev0.angle !== null && loopObjPrev1 !== null && loopObjPrev1.angle !== null && loopObjPrev2 !== null && loopObjPrev2.angle !== null) {
        angleDifferenceAlternating = Math.abs(loopObjPrev1.angle - loopObj.angle);
        angleDifferenceAlternating += Math.abs(loopObjPrev2.angle - loopObjPrev0.angle);

        let weight = 1.0;

        // 确保一个角很锐而另一个很宽
        weight *= reverseLerp(Math.min(loopObj.angle, loopObjPrev0.angle) * 180 / Math.PI, 20, 5);
        weight *= reverseLerp(Math.max(loopObj.angle, loopObjPrev0.angle) * 180 / Math.PI, 60, 120);

        // 在最大角差与重标定的交替角差之间插值 (更狠的标定)
        angleDifferenceAlternating = lerp2(Math.PI, 0.1 * angleDifferenceAlternating, weight);
      }

      const stackFactor = smootherstep(loopObj.lazyJumpDistance, 0, NORMALISED_RADIUS);

      constantAngleCount += Math.cos(3 * Math.min(30 * DEG, Math.min(angleDifference, angleDifferenceAlternating) * stackFactor)) * longIntervalFactor;
    }

    currentTimeGap = current.startTime - loopObj.startTime;
    index++;

    loopObjPrev2 = loopObjPrev1;
    loopObjPrev1 = loopObjPrev0;
    loopObjPrev0 = loopObj;
  }

  return clamp(2 / constantAngleCount, 0.2, 1);
}

function lerp2(a: number, b: number, t: number): number { return a + (b - a) * t; } // double.Lerp

// 物件时间上相距甚远时对 reading 影响的削弱因子
function getTimeNerfFactor(deltaTime: number): number {
  return clamp(2 - deltaTime / (reading_window_size / 2), 0, 1);
}

function readingHighBpmBonus(ms: number): number { return 1 / (1 - pow(0.8, ms / 1000)); }

// v167: 难度物件预处理 — 逐字移植 lazer
//   osu.Game.Rulesets.Osu/Difficulty/Preprocessing/OsuDifficultyHitObject.cs
//   osu.Game/Rulesets/Difficulty/Preprocessing/DifficultyHitObject.cs
//   osu.Game/Rulesets/Objects/SliderEventGenerator.cs (osu ruleset 的 nested 序列: Head/Tick/Repeat/Tail, 不生成 LegacyLastTick)
//   osu.Game.Rulesets.Osu/Objects/Slider.cs (Velocity/TickDistance/SpanDuration/CreateNestedHitObjects)
// 无 mod 简化: clockRate 恒 1
import type { Beatmap, HitObject, Vec2 } from '../parser';
import { csToRadius, sliderVelocityAt, timingAt } from '../parser';
import { getSliderPath } from '../sliderPath';

// v167: 对应 lazer OsuDifficultyHitObject.NORMALISED_RADIUS / MIN_DELTA_TIME / maximum_slider_radius / assumed_slider_radius
export const NORMALISED_RADIUS = 50;
export const NORMALISED_DIAMETER = NORMALISED_RADIUS * 2;
export const MIN_DELTA_TIME = 25;
const MAXIMUM_SLIDER_RADIUS = NORMALISED_RADIUS * 2.4;
const ASSUMED_SLIDER_RADIUS = NORMALISED_RADIUS * 1.8;

// v167: 对应 lazer SliderEventGenerator.TAIL_LENIENCY (滑条尾部判定宽限 -36ms)
const TAIL_LENIENCY = -36;

// v167: lazer OsuHitObject.Radius = 64 * Scale, Scale = (1 - 0.7*(cs-5)/5)/2 * 1.00041 (broken_gamefield_rounding_allowance)
//   展开后 = (54.4 - 4.48*cs) * 1.00041 = 工程 csToRadius(cs) * 1.00041 (LegacyRulesetExtensions.CalculateScaleFromCircleSize)
function osuRadius(cs: number): number { return csToRadius(cs) * 1.00041; }

// v167: 对应 lazer IBeatmapDifficultyInfo.DifficultyRange(difficulty, min, mid, max) (两段线性)
function difficultyRange(difficulty: number, min: number, mid: number, max: number): number {
  const r = (difficulty - 5) / 5;
  if (difficulty > 5) return mid + (max - mid) * r;
  if (difficulty < 5) return mid + (mid - min) * r;
  return mid;
}

// v167: 对应 lazer OsuHitWindows.SetDifficulty great 窗口: floor(DifficultyRange(od, 80, 50, 20)) - 0.5
//   DifficultyHitObject.HitWindowGreat = 2 * rawWindow / clockRate (clockRate=1)
function hitWindowGreat(od: number): number {
  return 2 * (Math.floor(difficultyRange(od, 80, 50, 20)) - 0.5);
}

// v167: 对应 lazer OsuHitObject.ApplyDefaultsToSelf: TimePreempt = DifficultyRangeInt(ar, (1800,1200,450)) ((int) 截断)
//   与工程 arToPreempt 同公式, 仅多整数截断
function timePreempt(ar: number): number {
  return Math.trunc(difficultyRange(ar, 1800, 1200, 450));
}

/** 谱面级常量上下文 (一次计算, 全物件共享) */
export interface DifficultyCtx {
  radius: number;          // lazer OsuHitObject.Radius (含 1.00041 fudge)
  preempt: number;         // TimePreempt (clockRate=1)
  hitWindowGreat: number;  // DifficultyHitObject.HitWindowGreat (= 2*rawGreat)
  stackOffsets: Map<number, { dx: number; dy: number }>; // lazer StackedPosition = Position + StackOffset
}

/** v167: 构建谱面级上下文 (stackOffsets 由调用方注入 — 来自 stacking.ts, 即 lazer StackedPosition 的来源) */
export function makeDifficultyCtx(bm: Beatmap, stackOffsets: Map<number, { dx: number; dy: number }>): DifficultyCtx {
  return {
    radius: osuRadius(bm.difficulty.cs),
    preempt: timePreempt(bm.difficulty.ar),
    hitWindowGreat: hitWindowGreat(bm.difficulty.od),
    stackOffsets,
  };
}

/** 滑条 nested 事件 (v167: 对应 lazer SliderEventGenerator 的 Head/Tick/Repeat/Tail, 坐标为 StackedPosition) */
export interface SliderNested {
  kind: 'head' | 'tick' | 'repeat' | 'tail';
  time: number;
  x: number;
  y: number;
}

/** 滑条难度数据 (v167: 对应 lazer Slider 的 Velocity/SpanDuration/Duration/NestedHitObjects) */
export interface SliderData {
  duration: number;      // ms
  spanDuration: number;  // ms (= duration / slides)
  nested: SliderNested[];
}

// v167: 对应 lazer Slider.ApplyDefaultsToSelf + CreateNestedHitObjects (无 mod, clockRate=1)
//   Velocity = 100*sliderMultiplier/GetPrecisionAdjustedBeatLength — 工程 sliderVelocityAt 同公式
//   (差异: lazer 把 SV 钳制到 [0.1,10] 且经 float 精度调整, 工程未钳制; 常规谱面无差异, 见 v167 README)
//   TickDistance = Velocity * 红线beatLength / sliderTickRate (Generate 内再 clamp 到 [0, length])
//   off = 滑条的堆叠偏移 (lazer StackOffset): nested 与滑条同一 StackHeight => 所有 nested 统一加该偏移
function buildSliderData(bm: Beatmap, o: HitObject, off: { dx: number; dy: number }): SliderData {
  const slides = o.slides ?? 1; // .osu slides = lazer SpanCount (= RepeatCount + 1)
  const length = o.length ?? 0;
  const velocity = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
  const spanDuration = velocity > 0 ? length / velocity : 0;
  const duration = spanDuration * slides;

  // v167: 对应 lazer SliderEventGenerator.Generate
  const path = getSliderPath(bm, o);
  const posAt = (progress: number): Vec2 => {
    const p = path.positionAt(Math.min(1, Math.max(0, progress)) * length); // lazer progressToDistance = clamp(progress,0,1)*Distance
    return { x: p.x + 0, y: p.y + 0 };
  };

  const nested: SliderNested[] = [];
  nested.push({ kind: 'head', time: o.time, x: o.x + off.dx, y: o.y + off.dy });

  const len = Math.min(100000, length); // lazer max_length = 100000
  const { red } = timingAt(bm.timingPoints, o.time);
  const scoringDistance = velocity * red.beatLength; // lazer: scoringDistance = Velocity * timingPoint.BeatLength (红线拍长, 不含 SV)
  const tickRate = bm.difficulty.sliderTickRate;
  let tickDistance = tickRate > 0 ? scoringDistance / tickRate : Number.POSITIVE_INFINITY;
  tickDistance = Math.min(Math.max(tickDistance, 0), len);
  const minDistanceFromEnd = velocity * 10; // lazer: minDistanceFromEnd = velocity * 10

  for (let span = 0; span < slides; span++) {
    const spanStartTime = o.time + span * spanDuration;
    const reversed = span % 2 === 1;

    if (tickDistance !== 0 && spanDuration > 0) {
      const ticks: SliderNested[] = [];
      for (let d = tickDistance; d <= len; d += tickDistance) {
        if (d >= len - minDistanceFromEnd) break;
        const pathProgress = d / len;
        const timeProgress = reversed ? 1 - pathProgress : pathProgress;
        const p = posAt(pathProgress);
        ticks.push({ kind: 'tick', time: spanStartTime + timeProgress * spanDuration, x: p.x, y: p.y });
      }
      if (reversed) ticks.reverse(); // lazer: repeat span 的 ticks 反序回时间升序
      nested.push(...ticks);
    }

    if (span < slides - 1) {
      const p = posAt((span + 1) % 2); // lazer Repeat.PathProgress = (span+1)%2
      nested.push({ kind: 'repeat', time: spanStartTime + spanDuration, x: p.x, y: p.y });
    }
  }

  const tailP = posAt(1); // lazer Tail: Position = EndPosition (路径几何末端)
  nested.push({ kind: 'tail', time: o.time + duration, x: tailP.x + off.dx, y: tailP.y + off.dy });
  // ticks/repeat 统一加偏移 (head/tail 上面已加)
  for (const n of nested) {
    if (n.kind === 'tick' || n.kind === 'repeat') { n.x += off.dx; n.y += off.dy; }
  }
  return { duration, spanDuration, nested };
}

/** 物件结束时间 (v167: 对应 lazer HitObject.GetEndTime; circle=time, slider=time+duration, spinner=endTime) */
function endTimeOf(bm: Beatmap, o: HitObject): number {
  if (o.type === 'slider') {
    const vel = sliderVelocityAt(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier);
    return vel > 0 ? o.time + ((o.length ?? 0) / vel) * (o.slides ?? 1) : o.time;
  }
  if (o.type === 'spinner') return o.endTime ?? o.time;
  return o.time;
}

/**
 * v167: 对应 lazer OsuDifficultyHitObject (无 mod, clockRate=1)
 * 构造顺序与 C# 一致: 基础字段 -> AdjustedDeltaTime/LastObjectEndDeltaTime -> computeSliderCursorPosition -> setDistances
 */
export class OsuDifficultyHitObject {
  readonly index: number;
  readonly base: HitObject;
  readonly last: HitObject;
  private readonly list: OsuDifficultyHitObject[];
  private readonly bm: Beatmap;
  private readonly ctx: DifficultyCtx;

  readonly deltaTime: number;          // DeltaTime (clockRate=1)
  readonly startTime: number;          // StartTime
  readonly endTime: number;            // EndTime
  readonly hitWindowGreat: number;     // HitWindowGreat
  readonly adjustedDeltaTime: number;  // AdjustedDeltaTime (>= MIN_DELTA_TIME)
  readonly lastObjectEndDeltaTime: number;

  // OsuDifficultyHitObject 字段
  jumpDistance = 0;
  lazyJumpDistance = 0;
  minimumJumpDistance = 0;
  minimumJumpTime = 0;
  travelDistance = 0;
  travelTime = 0;
  lazyEndPosition: Vec2 | null = null;
  lazyTravelDistance = 0;
  lazyTravelTime = 0;
  angle: number | null = null;
  normalisedVectorAngle: number | null = null;
  sliderData: SliderData | null = null; // lazer Slider 本体数据 (nested/spanDuration)

  constructor(bm: Beatmap, ctx: DifficultyCtx, obj: HitObject, last: HitObject, list: OsuDifficultyHitObject[], index: number) {
    this.bm = bm; this.ctx = ctx;
    this.base = obj; this.last = last; this.list = list; this.index = index;

    this.deltaTime = obj.time - last.time; // clockRate=1
    this.startTime = obj.time;
    this.endTime = endTimeOf(bm, obj);
    this.hitWindowGreat = ctx.hitWindowGreat;

    this.adjustedDeltaTime = Math.max(this.deltaTime, MIN_DELTA_TIME);
    const prev = this.previous(0);
    this.lastObjectEndDeltaTime = prev ? Math.max(this.startTime - prev.endTime, MIN_DELTA_TIME) : this.adjustedDeltaTime;

    this.computeSliderCursorPosition();
    this.setDistances();
  }

  // v167: 对应 lazer DifficultyHitObject.Previous/Next
  previous(skipCount = 0): OsuDifficultyHitObject | null {
    const i = this.index - (skipCount + 1);
    return i >= 0 && i < this.list.length ? this.list[i] : null;
  }
  next(skipCount = 0): OsuDifficultyHitObject | null {
    const i = this.index + (skipCount + 1);
    return i >= 0 && i < this.list.length ? this.list[i] : null;
  }

  /** StackedPosition = Position + StackOffset */
  stackedPos(o: HitObject): Vec2 {
    const off = this.ctx.stackOffsets.get(o.id) ?? { dx: 0, dy: 0 };
    return { x: o.x + off.dx, y: o.y + off.dy };
  }

  /** lazer OsuHitObject.Radius (评估器用, 未归一化) */
  ctxRadius(): number { return this.ctx.radius; }

  get smallCircleBonus(): number { // v167: 对应 lazer OsuDifficultyHitObject.SmallCircleBonus
    return Math.max(1.0, 1.0 + (30 - this.ctx.radius) / 70);
  }
  get overallDifficulty(): number { // v167: 对应 lazer OsuDifficultyHitObject.OverallDifficulty
    return (79.5 - this.hitWindowGreat / 2) / 6;
  }
  get preempt(): number { return this.ctx.preempt; } // Preempt = TimePreempt / clockRate

  // v167: 对应 lazer OsuDifficultyHitObject.OpacityAt (hidden=false 分支; hidden 恒 false — 无 HD mod)
  opacityAt(time: number, hidden: boolean): number {
    if (time > this.base.time) return 0;
    const fadeInStartTime = this.base.time - this.ctx.preempt;
    const fadeInDuration = 400 * Math.min(1, this.ctx.preempt / 450); // PREEMPT_MIN=450; 无 HD 调整
    void hidden; // 无 Hidden mod, 不进入 hidden 分支
    return Math.min(1, Math.max(0, (time - fadeInStartTime) / fadeInDuration));
  }

  // v167: 对应 lazer OsuDifficultyHitObject.CalculateDoubleTapFeasibility
  calculateDoubleTapFeasibility(nextObj: OsuDifficultyHitObject | null): number {
    if (nextObj === null) return 0;
    const currDeltaTime = Math.max(1, this.deltaTime);
    const nextDeltaTime = Math.max(1, nextObj.deltaTime);
    const deltaDifference = Math.abs(nextDeltaTime - currDeltaTime);
    const speedRatio = currDeltaTime / Math.max(currDeltaTime, deltaDifference);
    const windowRatio = Math.pow(Math.min(1, currDeltaTime / this.hitWindowGreat), 5);
    const distanceFactor = Math.pow(
      Math.min(1, Math.max(0, (this.lazyJumpDistance - NORMALISED_DIAMETER) / (NORMALISED_RADIUS - NORMALISED_DIAMETER))), 2); // ReverseLerp(lazyJumpDistance, diameter, radius)
    return 1.0 - Math.pow(speedRatio, distanceFactor * (1 - windowRatio));
  }

  // v167: 对应 lazer OsuDifficultyHitObject.computeSliderCursorPosition
  private computeSliderCursorPosition(): void {
    if (this.base.type !== 'slider') return;
    if (this.lazyEndPosition !== null) return;

    const bm = this.bm;
    const o = this.base;
    const stacked = this.stackedPos(o);
    const off = this.ctx.stackOffsets.get(o.id) ?? { dx: 0, dy: 0 };
    const sd = buildSliderData(bm, o, off);
    this.sliderData = sd;

    const sliderStart = o.time;
    const sliderDuration = sd.duration;
    const spanDuration = sd.spanDuration;

    let trackingEndTime = Math.max(
      sliderStart + sliderDuration + TAIL_LENIENCY,
      sliderStart + sliderDuration / 2,
    );

    let nestedObjects = sd.nested;

    let lastRealTick: SliderNested | null = null;
    for (const n of sd.nested) if (n.kind === 'tick') lastRealTick = n;

    if (lastRealTick !== null && lastRealTick.time > trackingEndTime) {
      trackingEndTime = lastRealTick.time;
      // lazer: 把 lastRealTick 移到末尾 (保持已知 diffcalc 输出的怪异排序)
      const reordered = nestedObjects.filter(n => n !== lastRealTick);
      reordered.push(lastRealTick);
      nestedObjects = reordered;
    }

    this.lazyTravelTime = trackingEndTime - sliderStart;

    let endTimeMin = spanDuration > 0 ? this.lazyTravelTime / spanDuration : 0;
    if (endTimeMin % 2 >= 1) endTimeMin = 1 - (endTimeMin % 1);
    else endTimeMin = endTimeMin % 1;

    const length = o.length ?? 0;
    const path = getSliderPath(bm, o);
    const lazyP = path.positionAt(endTimeMin * length);
    this.lazyEndPosition = { x: stacked.x + (lazyP.x - o.x), y: stacked.y + (lazyP.y - o.y) };
    // 注: lazer LazyEndPosition = slider.StackedPosition + Path.PositionAt(endTimeMin) (相对路径偏移)

    let currCursorPosition: Vec2 = { x: stacked.x, y: stacked.y };
    const scalingFactor = NORMALISED_RADIUS / this.ctx.radius;

    for (let i = 1; i < nestedObjects.length; i++) {
      const currMovementObj = nestedObjects[i];

      let currMovement: Vec2 = { x: currMovementObj.x - currCursorPosition.x, y: currMovementObj.y - currCursorPosition.y };
      let currMovementLength = scalingFactor * Math.hypot(currMovement.x, currMovement.y);

      let requiredMovement = ASSUMED_SLIDER_RADIUS;

      if (i === nestedObjects.length - 1) {
        // 滑条末尾: lazy end 与真实 end 取更省力的移动
        const lazyMovement: Vec2 = { x: this.lazyEndPosition.x - currCursorPosition.x, y: this.lazyEndPosition.y - currCursorPosition.y };
        if (Math.hypot(lazyMovement.x, lazyMovement.y) < Math.hypot(currMovement.x, currMovement.y)) {
          currMovement = lazyMovement;
        }
        currMovementLength = scalingFactor * Math.hypot(currMovement.x, currMovement.y);
      } else if (currMovementObj.kind === 'repeat') {
        // repeat 用更紧的阈值
        requiredMovement = NORMALISED_RADIUS;
      }

      if (currMovementLength > requiredMovement) {
        const k = (currMovementLength - requiredMovement) / currMovementLength;
        currCursorPosition = { x: currCursorPosition.x + currMovement.x * k, y: currCursorPosition.y + currMovement.y * k };
        currMovementLength *= k;
        this.lazyTravelDistance += currMovementLength;
      }

      if (i === nestedObjects.length - 1) this.lazyEndPosition = currCursorPosition;
    }
  }

  // v167: 对应 lazer OsuDifficultyHitObject.setDistances (clockRate=1)
  private setDistances(): void {
    if (this.base.type === 'slider' && this.sliderData) {
      // 折返滑条加成 (repeatCount = slides - 1)
      this.travelDistance = this.lazyTravelDistance * Math.max(1, Math.pow((this.base.slides ?? 1) - 1, 0.3));
      this.travelTime = Math.max(this.lazyTravelTime, MIN_DELTA_TIME); // /clockRate=1
    }

    this.minimumJumpTime = this.adjustedDeltaTime;

    // 任一端是转盘则不算距离/角度
    if (this.base.type === 'spinner' || this.last.type === 'spinner') return;

    const scalingFactor = NORMALISED_RADIUS / this.ctx.radius;

    const lastDifficultyObject = this.previous(0);
    const lastLastDifficultyObject = this.previous(1);

    const lastCursorPosition: Vec2 = lastDifficultyObject !== null
      ? this.getEndCursorPosition(lastDifficultyObject)
      : this.stackedPos(this.last);

    const currStacked = this.stackedPos(this.base);
    const lastStacked = this.stackedPos(this.last);

    this.jumpDistance = Math.hypot(lastStacked.x - currStacked.x, lastStacked.y - currStacked.y) * scalingFactor;
    this.lazyJumpDistance = Math.hypot(currStacked.x - lastCursorPosition.x, currStacked.y - lastCursorPosition.y) * scalingFactor;
    this.minimumJumpDistance = this.lazyJumpDistance;

    if (this.last.type === 'slider' && lastDifficultyObject !== null) {
      const lastTravelTime = Math.max(lastDifficultyObject.lazyTravelTime, MIN_DELTA_TIME); // /clockRate=1
      this.minimumJumpTime = Math.max(this.adjustedDeltaTime - lastTravelTime, MIN_DELTA_TIME);

      // anti-flow / flow 两种滑条出跳路径取最小 (见 lazer 注释)
      const tail = lastDifficultyObject.sliderData!.nested[lastDifficultyObject.sliderData!.nested.length - 1]; // TailCircle.StackedPosition
      const tailJumpDistance = Math.hypot(tail.x - currStacked.x, tail.y - currStacked.y) * scalingFactor;
      this.minimumJumpDistance = Math.max(0, Math.min(
        this.lazyJumpDistance - (MAXIMUM_SLIDER_RADIUS - ASSUMED_SLIDER_RADIUS),
        tailJumpDistance - MAXIMUM_SLIDER_RADIUS,
      ));
    }

    if (lastLastDifficultyObject !== null && lastLastDifficultyObject.base.type !== 'spinner') {
      let jumpFrom = lastCursorPosition;
      if (lastDifficultyObject!.base.type === 'slider' && lastDifficultyObject!.travelDistance > 0) {
        jumpFrom = lastDifficultyObject!.stackedPos(lastDifficultyObject!.base); // prevSlider.HeadCircle.StackedPosition
      }

      const lastLastCursorPosition = this.getEndCursorPosition(lastLastDifficultyObject);

      const angle = this.calculateAngle(currStacked, jumpFrom, lastLastCursorPosition);
      const sliderAngle = this.calculateSliderAngle(lastDifficultyObject!, lastLastCursorPosition);

      const vx = currStacked.x - jumpFrom.x, vy = currStacked.y - jumpFrom.y;
      this.normalisedVectorAngle = Math.atan2(Math.abs(vy), Math.abs(vx));

      this.angle = Math.min(angle, sliderAngle);
    }
  }

  // v167: 对应 lazer OsuDifficultyHitObject.calculateSliderAngle
  private calculateSliderAngle(lastDifficultyObject: OsuDifficultyHitObject, lastLastCursorPosition: Vec2): number {
    const lastCursorPosition = this.getEndCursorPosition(lastDifficultyObject);

    if (lastDifficultyObject.base.type === 'slider' && lastDifficultyObject.travelDistance > 0) {
      const nested = lastDifficultyObject.sliderData!.nested;
      const secondLast = nested[nested.length - 2]; // prevSlider.NestedHitObjects[^2]
      lastLastCursorPosition = { x: secondLast.x, y: secondLast.y };
    }

    return this.calculateAngle(this.stackedPos(this.base), lastCursorPosition, lastLastCursorPosition);
  }

  // v167: 对应 lazer OsuDifficultyHitObject.calculateAngle
  private calculateAngle(currentPosition: Vec2, lastPosition: Vec2, lastLastPosition: Vec2): number {
    const v1x = lastLastPosition.x - lastPosition.x, v1y = lastLastPosition.y - lastPosition.y;
    const v2x = currentPosition.x - lastPosition.x, v2y = currentPosition.y - lastPosition.y;
    const dot = v1x * v2x + v1y * v2y;
    const det = v1x * v2y - v1y * v2x;
    return Math.abs(Math.atan2(det, dot));
  }

  // v167: 对应 lazer OsuDifficultyHitObject.getEndCursorPosition
  getEndCursorPosition(d: OsuDifficultyHitObject): Vec2 {
    return d.lazyEndPosition ?? this.stackedPos(d.base);
  }
}

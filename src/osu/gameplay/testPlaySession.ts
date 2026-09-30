// v287: 测试游玩会话运行时 — 判定状态机 (渲染/输入数据层, 无 React/DOM)
// 对齐 lazer:
//   EditorPlayer.cs (editorTime 前物件满分预填/不判 Miss; 完成后返回编辑器)
//   DrawableHitCircle.cs (过早点击忽略; 过 meh 窗口未点判 Miss)
//   SliderInputManager.cs (tracking = 光标在 2.4r 跟随圈内且按住击打键)
//   SliderEventGenerator.cs (head/tick/repeat/tail 判定序列, tail -36ms 宽限)
//   DrawableSpinner.cs (光标绕心转角累计, 结束按 Progress 判定)
import type { Beatmap, HitObject, Vec2 } from '../parser';
import { csToRadius } from '../parser';
import { getSliderPath } from '../sliderPath';
import { buildSliderData, endTimeOf, TAIL_LENIENCY, type SliderNested } from '../starrating/preprocessing';
import {
  hitWindows, judgeDelta, spinnerRequired, spinnerResult, TestScore,
  type HitWindows, type MainResult,
} from './judgement';

/** 时钟起点相对编辑器时间的回退量 (用户需求: 从当前时间的前几秒开始游玩) */
export const TESTPLAY_LEAD_BACK = 3000;

export interface JudgePopup { x: number; y: number; at: number; result: MainResult }

type NestedRt = { n: SliderNested; state: 'pending' | 'hit' | 'miss' | 'prehit' };

interface CircleRt { kind: 'circle'; state: 'pending' | 'hit' | 'miss' | 'prehit'; hitAt: number; result: MainResult | null }
interface SliderRt {
  kind: 'slider'; head: 'pending' | 'hit' | 'miss' | 'prehit'; headAt: number; headResult: MainResult | null;
  nested: NestedRt[]; tracking: boolean; done: boolean;
}
interface SpinnerRt {
  kind: 'spinner'; state: 'pending' | 'done' | 'prehit'; result: MainResult | null;
  accum: number; lastAngle: number | null; ticksGiven: number; spins: number;
}
type ObjRt = CircleRt | SliderRt | SpinnerRt;

/** 渲染层消费 (renderer.ts gameplay 分支) */
export interface GameplayObjRender {
  state: 'pending' | 'hit' | 'miss' | 'prehit' | 'done';
  hitAt: number;                 // circle/head 实际命中时刻 (爆炸锚点)
  tracking: boolean;             // slider: 是否画跟随圈
  ticks: Map<number, 'hit' | 'miss' | 'pending'>; // slider: tickTimeMs → 状态
  spinRotation: number;          // spinner: 累计转角 (rad)
}

export class TestPlaySession {
  readonly bm: Beatmap;
  readonly editorTime: number;
  readonly startTime: number;    // 时钟起点 (editorTime - LEAD_BACK, 钳 0; editorTime 在首物件前则从头)
  readonly lastEnd: number;      // 末物件结束时间
  readonly radius: number;       // csToRadius(cs)
  readonly win: HitWindows;
  readonly score = new TestScore();
  readonly popups: JudgePopup[] = [];

  private rt = new Map<number, ObjRt>();
  private spinReq = new Map<number, { spinsRequired: number; maxBonusSpins: number }>();
  private renderCache = new Map<number, GameplayObjRender>();
  private stackOffsets?: Map<number, { dx: number; dy: number }>;

  constructor(bm: Beatmap, editorTime: number, stackOffsets?: Map<number, { dx: number; dy: number }>) {
    this.stackOffsets = stackOffsets;
    this.bm = bm;
    this.editorTime = editorTime;
    const first = bm.hitObjects.length ? Math.min(...bm.hitObjects.map(o => o.time)) : 0;
    this.startTime = editorTime <= first ? 0 : Math.max(0, editorTime - TESTPLAY_LEAD_BACK);
    this.lastEnd = bm.hitObjects.length ? Math.max(...bm.hitObjects.map(o => endTimeOf(bm, o))) : 0;
    this.radius = csToRadius(bm.difficulty.cs);
    this.win = hitWindows(bm.difficulty.od);

    for (const o of bm.hitObjects) {
      const end = endTimeOf(bm, o);
      if (o.type === 'slider') {
        const off = this.off(o.id);
        const data = buildSliderData(bm, o, off);
        const rt: SliderRt = {
          kind: 'slider', head: 'pending', headAt: o.time, headResult: null,
          nested: data.nested.filter(n => n.kind !== 'head').map(n => ({ n, state: 'pending' })),
          tracking: false, done: false,
        };
        // lazer markPreviousObjectsHit: editorTime 前结束的整体预填; 跨越的按 nested 时间逐项预填
        if (end < editorTime) {
          rt.head = 'prehit'; rt.done = true;
          this.score.prefill('great');
          for (const t of rt.nested) { t.state = 'prehit'; this.score.prefill(this.prefillOf(t.n.kind)); }
        } else {
          if (o.time < editorTime) { rt.head = 'prehit'; this.score.prefill('great'); }
          for (const t of rt.nested) if (t.n.time < editorTime) { t.state = 'prehit'; this.score.prefill(this.prefillOf(t.n.kind)); }
        }
        this.rt.set(o.id, rt);
      } else if (o.type === 'spinner') {
        const req = spinnerRequired(bm.difficulty.od, (o.endTime ?? o.time) - o.time);
        this.spinReq.set(o.id, req);
        const rt: SpinnerRt = { kind: 'spinner', state: 'pending', result: null, accum: 0, lastAngle: null, ticksGiven: 0, spins: 0 };
        if (end < editorTime) {
          rt.state = 'prehit'; rt.result = 'great';
          this.score.prefill('great');
          for (let i = 0; i < req.spinsRequired; i++) this.score.applySpinTick(false); // 预填要求圈 (base=max, 即满分)
        }
        this.rt.set(o.id, rt);
      } else {
        const rt: CircleRt = { kind: 'circle', state: 'pending', hitAt: o.time, result: null };
        if (end < editorTime) { rt.state = 'prehit'; rt.result = 'great'; this.score.prefill('great'); }
        this.rt.set(o.id, rt);
      }
    }
  }

  private off(id: number) { return this.stackOffsets?.get(id) ?? { dx: 0, dy: 0 }; }
  pos(o: HitObject): Vec2 { const d = this.off(o.id); return { x: o.x + d.dx, y: o.y + d.dy }; }
  private prefillOf(kind: SliderNested['kind']) {
    return kind === 'tick' ? 'smallTickHit' : kind === 'repeat' ? 'largeTickHit' : 'sliderTailHit';
  }

  /** 击打动作 (Z/X/鼠标按下): 判 meh 窗口内且光标在物件半径内的最近物件; 过早点击忽略 (lazer 语义) */
  hit(time: number, p: Vec2) {
    let best: { o: HitObject; rt: ObjRt; delta: number; result: MainResult } | null = null;
    for (const o of this.bm.hitObjects) {
      const rt = this.rt.get(o.id)!;
      const isCircle = rt.kind === 'circle' && rt.state === 'pending';
      const isHead = rt.kind === 'slider' && rt.head === 'pending';
      if (!isCircle && !isHead) continue;
      const delta = time - o.time;
      const result = judgeDelta(delta, this.win);
      if (!result) continue; // 过早/过晚 → 该物件不吃这次点击
      const c = this.pos(o);
      if (Math.hypot(p.x - c.x, p.y - c.y) > this.radius) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { o, rt, delta, result };
    }
    if (!best) return;
    const c = this.pos(best.o);
    this.score.apply(best.result);
    this.popups.push({ x: c.x, y: c.y, at: time, result: best.result });
    if (best.rt.kind === 'circle') { best.rt.state = 'hit'; best.rt.hitAt = time; best.rt.result = best.result; }
    else if (best.rt.kind === 'slider') { best.rt.head = 'hit'; best.rt.headAt = time; best.rt.headResult = best.result; }
  }

  /** 逐帧推进 (time = store.positionMs(); cursor = osu 坐标; keyHeld = 有击打键按住; relax = v294 RX/AT 免按键自动击打+跟随) */
  update(time: number, cursor: Vec2, keyHeld: boolean, relax = false) {
    // v294: Relax — 光标在半径内且进 meh 窗口即自动击打 (按实际 delta 判 300/100/50, lazer 同款, 非全 300)
    if (relax) this.hit(time, cursor);
    for (const o of this.bm.hitObjects) {
      const rt = this.rt.get(o.id)!;
      if (rt.kind === 'circle') {
        if (rt.state === 'pending' && time - o.time > this.win.meh) {
          rt.state = 'miss'; rt.result = 'miss';
          this.score.apply('miss');
          const c = this.pos(o);
          this.popups.push({ x: c.x, y: c.y, at: time, result: 'miss' });
        }
      } else if (rt.kind === 'slider') {
        this.updateSlider(o, rt, time, cursor, keyHeld || relax); // v294: Relax 滑条免按键跟随
      } else {
        this.updateSpinner(o, rt, time, cursor);
      }
    }
  }

  /** v294: 滑条球位置 (含堆叠偏移; time 在 [o.time, end] 外返回 null) — updateSlider/autopilot 共用 */
  private sliderBallAt(o: HitObject, time: number): Vec2 | null {
    const data = buildSliderData(this.bm, o, this.off(o.id));
    const end = o.time + data.duration;
    if (time < o.time || time > end) return null;
    const vel = data.spanDuration > 0 ? (o.length ?? 0) / data.spanDuration : 0;
    const slideLen = o.length ?? 0;
    let along = 0;
    if (vel > 0 && slideLen > 0) {
      const prog = (time - o.time) * vel;
      const cycle = Math.floor(prog / slideLen);
      along = prog - cycle * slideLen;
      if (cycle % 2 === 1) along = slideLen - along;
    }
    const bp = buildSliderDataPath(this.bm, o)(along);
    const off = this.off(o.id);
    return { x: bp.x + off.dx, y: bp.y + off.dy };
  }

  /** v294: Autopilot 光标目标 — 进行中的滑条跟球; 否则跳向最近的 pending circle/head; 没有则 null (不动) */
  autoCursorPos(time: number): Vec2 | null {
    for (const o of this.bm.hitObjects) {
      const rt = this.rt.get(o.id)!;
      if (rt.kind !== 'slider' || rt.done) continue;
      const bp = this.sliderBallAt(o, time);
      if (bp) return bp;
    }
    let best: HitObject | null = null;
    for (const o of this.bm.hitObjects) {
      const rt = this.rt.get(o.id)!;
      const pend = (rt.kind === 'circle' && rt.state === 'pending') || (rt.kind === 'slider' && rt.head === 'pending');
      if (!pend) continue;
      if (!best || o.time < best.time) best = o;
    }
    return best ? this.pos(best) : null;
  }

  private updateSlider(o: HitObject, rt: SliderRt, time: number, cursor: Vec2, keyHeld: boolean) {
    if (rt.done) return;
    const data = buildSliderData(this.bm, o, this.off(o.id)); // 有缓存 (getSliderPath memo), 代价低
    const end = o.time + data.duration;
    // 头超时未点 → miss (不阻止后续 tracking, lazer 同款)
    if (rt.head === 'pending' && time - o.time > this.win.meh) {
      rt.head = 'miss'; rt.headResult = 'miss';
      this.score.apply('miss');
      const c = this.pos(o);
      this.popups.push({ x: c.x, y: c.y, at: time, result: 'miss' });
    }
    // 球位置 (与 renderer drawSlider 同公式: cycle 折返; v294: 提取 sliderBallAt 共用)
    const bp = this.sliderBallAt(o, time);
    if (bp) {
      rt.tracking = keyHeld && Math.hypot(cursor.x - bp.x, cursor.y - bp.y) <= this.radius * 2.4;
    } else {
      rt.tracking = false;
    }
    // nested 判定 (tail 有 TAIL_LENIENCY 宽限)
    for (const t of rt.nested) {
      if (t.state !== 'pending') continue;
      const judgeAt = t.n.kind === 'tail' ? t.n.time + TAIL_LENIENCY : t.n.time;
      if (time < judgeAt) continue;
      const hit = rt.tracking;
      t.state = hit ? 'hit' : 'miss';
      if (t.n.kind === 'tick') this.score.apply(hit ? 'smallTickHit' : 'smallTickMiss');
      else if (t.n.kind === 'repeat') this.score.apply(hit ? 'largeTickHit' : 'largeTickMiss');
      else this.score.apply(hit ? 'sliderTailHit' : 'sliderTailMiss');
    }
    if (time > end) { rt.done = true; rt.tracking = false; }
  }

  private updateSpinner(o: HitObject, rt: SpinnerRt, time: number, cursor: Vec2) {
    if (rt.state !== 'pending') return;
    const end = o.endTime ?? o.time;
    const req = this.spinReq.get(o.id)!;
    if (time >= o.time && time <= end) {
      const ang = Math.atan2(cursor.y - 192, cursor.x - 256);
      if (rt.lastAngle !== null) {
        let d = ang - rt.lastAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        rt.accum += d;
      }
      rt.lastAngle = ang;
      // 完成圈数 (lazer: 整圈给 SpinnerTick, 超过 SpinsRequired+gap2 的圈给 bonus)
      rt.spins = Math.floor(Math.abs(rt.accum) / (2 * Math.PI));
      const totalTicks = req.spinsRequired + 2 + req.maxBonusSpins;
      while (rt.ticksGiven < Math.min(rt.spins, totalTicks)) {
        rt.ticksGiven++;
        this.score.applySpinTick(rt.ticksGiven > req.spinsRequired + 2);
      }
    }
    if (time > end) {
      rt.state = 'done';
      const progress = req.spinsRequired > 0 ? rt.spins / req.spinsRequired : 1;
      rt.result = spinnerResult(progress);
      this.score.apply(rt.result);
      this.popups.push({ x: 256, y: 192, at: time, result: rt.result });
    }
  }

  /** 渲染层数据 (每帧重建引用不变的对象, 按物件缓存) */
  renderInfo(): Map<number, GameplayObjRender> {
    for (const [id, rt] of this.rt) {
      let gi = this.renderCache.get(id);
      if (!gi) {
        gi = { state: 'pending', hitAt: 0, tracking: false, ticks: new Map(), spinRotation: 0 };
        this.renderCache.set(id, gi);
      }
      if (rt.kind === 'circle') {
        gi.state = rt.state; gi.hitAt = rt.hitAt;
      } else if (rt.kind === 'slider') {
        gi.state = rt.done ? 'done' : rt.head; gi.hitAt = rt.headAt; gi.tracking = rt.tracking;
        gi.ticks.clear();
        for (const t of rt.nested) if (t.n.kind === 'tick') gi.ticks.set(t.n.time, t.state === 'prehit' ? 'hit' : t.state);
      } else {
        gi.state = rt.state; gi.spinRotation = rt.accum;
      }
    }
    return this.renderCache;
  }
}

// 滑条球路径定位: 返回未加堆叠偏移的点 (renderer 内 translate(stackOffset), caller 自行加 off)
function buildSliderDataPath(bm: Beatmap, o: HitObject) {
  const path = getSliderPath(bm, o);
  const len = o.length ?? path.totalLength;
  // 相对路径坐标 (renderer 内 translate(stackOffset) 后按 osu 原坐标画) — 返回未加堆叠偏移的点, caller 加 off
  return (along: number): Vec2 => path.positionAt(Math.min(along, len));
}

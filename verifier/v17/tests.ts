// 验证器 v17: hitsound 排程延迟修复 (非零时钟原点回归) + 框选/多选变换纯函数测试
import { AudioClock, type ClockTimeSources } from '../../src/osu/clock/AudioClock';
import { HitSoundScheduler } from '../../src/osu/clock/HitSoundScheduler';
import { selectionCenter, rotateObjects, flipObjects, scaleObjects, objectsInRect } from '../../src/osu/transform';
import type { HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function section(name: string) { console.log('== ' + name); }

const QUANTUM_SEC = 128 / 44100;

// ---------- 1. AudioClock: 非零时钟原点 (真实浏览器场景) ----------
// v6 mock 中 perf/ctx 两时钟同起点 (phaseSec≈0), 掩盖了 ctxTimeForMapTime 误减
// phaseSec 的 bug; 真实浏览器 ctx 时钟原点 = ctx 启动时刻 (页面加载后 N 秒, 甚至
// 首次按播放时才 resume), phaseSec ≈ -N, 旧代码把全部 hitsound 统一推迟 N 秒。
section('AudioClock: ctx 时钟原点偏移 30s 时, hitsound 排程时刻精确 (延迟 bug 回归)');
{
  // perf 时钟从 0 走; ctx 时钟在 perf=30000ms 才从零启动 (模拟 suspended->resume)
  class OffsetWorld {
    t = 29500; // perf ms, 从 ctx 启动前 0.5s 开始
    constructor(public driftPpm = 0) { }
    hwClockSec(): number { return Math.max(0, (this.t - 30000) / 1000) * (1 + this.driftPpm / 1e6); }
    ctxNow(): number { return Math.floor(this.hwClockSec() / QUANTUM_SEC) * QUANTUM_SEC; }
    perfNow(): number { return this.t; }
  }
  for (const driftPpm of [0, 500]) {
    const w = new OffsetWorld(driftPpm);
    const src: ClockTimeSources = { ctxNow: () => w.ctxNow(), perfNow: () => w.perfNow(), outputLatency: () => 0.012 };
    const clock = new AudioClock(src);
    // 预热相位跟踪 (模拟暂停期每帧 tickClock)
    for (let i = 0; i < 200; i++) { w.t += 16.6; clock.trackPhase(); }
    assert(Math.abs(clock.phaseEstimateSec) > 1, `原点偏移场景生效 (|phaseSec|=${Math.abs(clock.phaseEstimateSec).toFixed(2)}s >> 0)`);
    const offset = 4000;
    const W = w.ctxNow() + 0.02;
    clock.onStartedAtCtxTime(W, offset);
    // 变速: rate=0.75 时排程时刻 = W + (mapMs-offset)/0.75 (趁 W 尚未过去立即验证)
    clock.rate = 0.75;
    const atR = clock.ctxTimeForMapTime(offset + 7500)!;
    assert(atR !== null && Math.abs(atR - (W + 10.0)) < 1e-9, '变速 0.75x 排程换算正确');
    clock.rate = 1;
    // 播放中随机前进, 断言排程时刻 = W + (mapMs-offset)/rate, 采样级精确
    let maxErr = 0;
    for (let i = 0; i < 200; i++) {
      w.t += 8 + (i * 37 % 17);
      const mapMs = offset + 500 + i * 25;
      const at = clock.ctxTimeForMapTime(mapMs);
      if (at === null) continue;
      const expected = W + (mapMs - offset) / 1000;
      maxErr = Math.max(maxErr, Math.abs(at - expected));
    }
    assert(maxErr < 1e-9, `drift=${driftPpm}ppm: 排程时刻与 ctx 时钟线严格一致 (maxErr=${(maxErr * 1000).toFixed(3)}ms; 旧代码晚 ~${Math.abs(clock.phaseEstimateSec).toFixed(1)}s)`);
    // rawNowMs/heardNowMs 在非零下仍 <1ms (既有精度不回归)
    w.t += 100;
    const truePos = offset + (w.hwClockSec() - W) * 1000;
    assert(Math.abs(clock.rawNowMs() - truePos) < 1, `rawNowMs 精度 <1ms (实际 ${Math.abs(clock.rawNowMs() - truePos).toFixed(3)}ms)`);
    // 过去时刻返回 null
    w.t += 5000;
    assert(clock.ctxTimeForMapTime(offset - 1000) === null, '过去时刻返回 null');
  }
}

// ---------- 2. HitSoundScheduler 端到端: 非零下事件落点 ----------
section('HitSoundScheduler: 非零下事件按精确 ctx 时刻排程');
{
  class OffsetWorld {
    t = 60000;
    hwClockSec(): number { return (this.t - 60000) / 1000; }
    ctxNow(): number { return Math.floor(this.hwClockSec() / QUANTUM_SEC) * QUANTUM_SEC; }
    perfNow(): number { return this.t; }
  }
  const w = new OffsetWorld();
  const clock = new AudioClock({ ctxNow: () => w.ctxNow(), perfNow: () => w.perfNow(), outputLatency: () => 0 });
  for (let i = 0; i < 100; i++) { w.t += 16.6; clock.trackPhase(); }
  const W = w.ctxNow() + 0.02;
  clock.onStartedAtCtxTime(W, 10000);
  const scheduled: { at: number; id: string }[] = [];
  const sched = new HitSoundScheduler(clock, { schedule: (at, id) => scheduled.push({ at, id }) });
  sched.setEvents([{ mapTimeMs: 10500, soundId: 'a' }, { mapTimeMs: 11000, soundId: 'b' }]);
  sched.resync();
  for (let i = 0; i < 100 && scheduled.length < 2; i++) { w.t += 16.6; sched.tick(); }
  assert(scheduled.length === 2, '两个事件都排程');
  assert(Math.abs(scheduled[0].at - (W + 0.5)) < 1e-9, `事件 a 落点精确 (误差 ${((scheduled[0].at - W - 0.5) * 1000).toFixed(3)}ms)`);
  assert(Math.abs(scheduled[1].at - (W + 1.0)) < 1e-9, `事件 b 落点精确`);
}

// ---------- 3. 选区几何变换 ----------
section('transform: 包围盒中心 (含滑条控制点, 转盘不计)');
{
  const circle: HitObject = { id: 1, type: 'circle', x: 100, y: 100, time: 0 };
  const slider: HitObject = { id: 2, type: 'slider', x: 200, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 100 };
  const spinner: HitObject = { id: 3, type: 'spinner', x: 256, y: 192, time: 0, endTime: 1000 };
  const c = selectionCenter([circle, slider, spinner])!;
  assert(c.x === 200 && c.y === 100, `中心=(200,100) 实际=(${c.x},${c.y})`);
  assert(selectionCenter([spinner]) === null, '只选转盘时无变换中心');
  assert(selectionCenter([]) === null, '空选区无变换中心');
}

section('transform: 旋转 90° (屏幕坐标顺时针)');
{
  const objs: HitObject[] = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 0 },
    { id: 2, type: 'slider', x: 200, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 100 },
    { id: 3, type: 'spinner', x: 256, y: 192, time: 0, endTime: 1000 },
  ];
  const c = { x: 200, y: 100 };
  const sliders = rotateObjects(objs, c, 90);
  // 90° 顺时针 (y 向下): (dx,dy) -> (-dy, dx)
  assert(objs[0].x === 200 && objs[0].y === 0, `单点 (100,100)->(200,0) 实际 (${objs[0].x},${objs[0].y})`);
  assert(objs[1].x === 200 && objs[1].y === 100, '滑条头在中心不动');
  assert(objs[1].curvePoints![0].x === 200 && objs[1].curvePoints![0].y === 200, `滑条控制点 (300,100)->(200,200) 实际 (${objs[1].curvePoints![0].x},${objs[1].curvePoints![0].y})`);
  assert(objs[2].x === 256 && objs[2].y === 192, '转盘位置不变');
  assert(objs[1].length === 100, '旋转不改变滑条长度');
  assert(sliders.length === 1 && sliders[0].id === 2, '返回被改动的滑条供 invalidatePath');
  // 转 360° 回原位 (取整误差 ≤1px)
  rotateObjects(objs, c, 90); rotateObjects(objs, c, 90); rotateObjects(objs, c, 90);
  assert(Math.abs(objs[0].x - 100) <= 1 && Math.abs(objs[0].y - 100) <= 1, '四次 90° 回到原位');
}

section('transform: 水平/垂直镜像');
{
  const objs: HitObject[] = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 0 },
    { id: 2, type: 'slider', x: 200, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 300, y: 120 }], slides: 1, length: 100 },
  ];
  const c = { x: 200, y: 100 };
  flipObjects(objs, c, 'h');
  assert(objs[0].x === 300 && objs[0].y === 100, '水平镜像 x 对换');
  assert(objs[1].curvePoints![0].x === 100 && objs[1].curvePoints![0].y === 120, '滑条控制点同步镜像');
  flipObjects(objs, c, 'h');
  assert(objs[0].x === 100 && objs[1].curvePoints![0].x === 300, '两次水平镜像还原');
  flipObjects(objs, c, 'v');
  assert(objs[0].x === 100 && objs[0].y === 100 && objs[1].curvePoints![0].y === 80, '垂直镜像 y 对换');
}

section('transform: 等比缩放 (滑条 length 同步)');
{
  const objs: HitObject[] = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 0 },
    { id: 2, type: 'slider', x: 200, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 110 },
  ];
  const c = { x: 200, y: 100 };
  scaleObjects(objs, c, 2);
  assert(objs[0].x === 0 && objs[0].y === 100, '单点远离中心 2 倍');
  assert(objs[1].curvePoints![0].x === 400, '滑条控制点同步缩放');
  assert(objs[1].length === 220, `滑条 length 同步 ×2 (实际 ${objs[1].length})`);
  scaleObjects(objs, c, 0.5);
  assert(objs[0].x === 100 && objs[1].length === 110, '缩小还原');
}

section('transform: 框选命中 (滑条取头部, 转盘按中心点)');
{
  const objs: HitObject[] = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 0 },
    { id: 2, type: 'circle', x: 400, y: 300, time: 0 },
    { id: 3, type: 'slider', x: 50, y: 50, time: 0, curveType: 'L', curvePoints: [{ x: 500, y: 350 }], slides: 1, length: 100 },
    { id: 4, type: 'spinner', x: 256, y: 192, time: 0, endTime: 1000 },
  ];
  const r1 = objectsInRect(objs, { minX: 0, minY: 0, maxX: 150, maxY: 150 });
  assert(r1.length === 2 && r1.includes(1) && r1.includes(3), `左下框选中单点+滑条头 (实际 ${JSON.stringify(r1)})`);
  const r2 = objectsInRect(objs, { minX: 0, minY: 0, maxX: 512, maxY: 384 });
  assert(r2.length === 4, '全框选中全部 (含转盘)');
  const r3 = objectsInRect(objs, { minX: 400, minY: 300, maxX: 512, maxY: 384 });
  assert(r3.length === 1 && r3[0] === 2, '滑条尾部在框内但头不在 -> 不选中');
}

if (failures) { console.error(`\nVERIFIER_V17_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V17_TESTS_PASSED');

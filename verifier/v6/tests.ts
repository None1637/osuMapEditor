// 验证器 v6: M0 无损往返 + M1 AudioClock/HitSoundScheduler 单元测试
import fs from 'fs';
import path from 'path';
import { parseOsu, serializeOsu, arToPreempt, arToFadeIn, csToRadius, timingAt, sliderVelocityAt } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { AudioClock, type ClockTimeSources } from '../../src/osu/clock/AudioClock';
import { HitSoundScheduler } from '../../src/osu/clock/HitSoundScheduler';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function section(name: string) { console.log('== ' + name); }

// ---------- Mock 世界: 模拟 AudioContext 量子化时钟 + 硬件漂移 ----------
const QUANTUM_SEC = 128 / 44100; // ≈2.9ms

class MockWorld {
  /** 真实 wall 时间 (ms) */
  t = 0;
  constructor(public driftPpm = 0) { }
  /** 硬件音频时钟 (秒): 随 wall 前进, 带漂移 */
  hwClockSec(): number { return (this.t / 1000) * (1 + this.driftPpm / 1e6); }
  /** ctx.currentTime: 量子化的硬件时钟 */
  ctxNow(): number { return Math.floor(this.hwClockSec() / QUANTUM_SEC) * QUANTUM_SEC; }
  perfNow(): number { return this.t; }
}

function makeSrc(w: MockWorld, latencySec = 0.012): ClockTimeSources {
  return { ctxNow: () => w.ctxNow(), perfNow: () => w.perfNow(), outputLatency: () => latencySec };
}

/** 模拟真实使用: 暂停阶段先跑 N 帧预热相位跟踪 */
function warmup(w: MockWorld, clock: AudioClock, frames = 200) {
  for (let i = 0; i < frames; i++) { w.t += 16.6; clock.trackPhase(); }
}

// 确定性伪随机
function lcg(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

// ---------- 1. AudioClock 精度仿真 ----------
section('AudioClock: 确定性锚定 + 相位跟踪, 60s 全程误差 < 1ms');
{
  for (const driftPpm of [0, 50, 500]) {
    const w = new MockWorld(driftPpm);
    const clock = new AudioClock(makeSrc(w));
    warmup(w, clock);
    const offset = 12345;
    const W = w.ctxNow() + 0.02;
    clock.onStartedAtCtxTime(W, offset);
    // 真实谱面位置: hwClock = W 时位置 = offset
    const truePos = () => offset + (w.hwClockSec() - W) * 1000;
    const rnd = lcg(42 + driftPpm);
    let maxErr = 0, maxErrFirst5 = 0;
    // 模拟 60 秒播放, 随机帧间隔 8~25ms
    for (let i = 0; i < 4000; i++) {
      w.t += 8 + rnd() * 17;
      const err = Math.abs(clock.rawNowMs() - truePos());
      if (err > maxErr) maxErr = err;
      if (i < 5 && err > maxErrFirst5) maxErrFirst5 = err;
    }
    assert(maxErr < 1, `drift=${driftPpm}ppm 60s 内最大误差 ${maxErr.toFixed(4)}ms 应 < 1ms`);
    assert(maxErrFirst5 < 1, `drift=${driftPpm}ppm 启动后前 5 帧误差 ${maxErrFirst5.toFixed(4)}ms 应 < 1ms (无启动瞬态)`);
    console.log(`  drift=${driftPpm}ppm maxErr=${maxErr.toFixed(4)}ms first5=${maxErrFirst5.toFixed(4)}ms`);
  }
}

section('AudioClock: heardNowMs = raw - outputLatency');
{
  const w = new MockWorld(0);
  const clock = new AudioClock(makeSrc(w, 0.015));
  warmup(w, clock);
  clock.onStartedAtCtxTime(w.ctxNow() + 0.02, 1000);
  w.t += 100;
  assert(Math.abs(clock.heardNowMs() - (clock.rawNowMs() - 15)) < 1e-9, 'heardNow 应补偿 15ms 输出延迟');
  clock.onStopped();
  assert(clock.heardNowMs() === clock.rawNowMs(), '暂停时不应再扣输出延迟');
}

section('AudioClock: 暂停/恢复连续性');
{
  const w = new MockWorld(100);
  const clock = new AudioClock(makeSrc(w));
  warmup(w, clock);
  const W = w.ctxNow() + 0.02;
  clock.onStartedAtCtxTime(W, 5000);
  w.t += 500.3;
  const true1 = 5000 + (w.hwClockSec() - W) * 1000;
  const posAtPause = clock.onStopped();
  assert(Math.abs(posAtPause - true1) < 1, `暂停位置误差 ${(posAtPause - true1).toFixed(4)}ms 应 < 1ms`);
  w.t += 60000; // 暂停一分钟 (相位跟踪继续, 不影响冻结位置)
  assert(clock.rawNowMs() === posAtPause, '暂停中位置冻结');
  const W2 = w.ctxNow() + 0.02;
  clock.onStartedAtCtxTime(W2, posAtPause); // 恢复
  w.t += 250.7;
  const true2 = posAtPause + (w.hwClockSec() - W2) * 1000;
  assert(Math.abs(clock.rawNowMs() - true2) < 1, `恢复后位置误差 ${(clock.rawNowMs() - true2).toFixed(4)}ms 应 < 1ms`);
}

section('AudioClock: 变速 0.5 / 0.75');
{
  for (const rate of [0.5, 0.75]) {
    const w = new MockWorld(0);
    const clock = new AudioClock(makeSrc(w));
    warmup(w, clock);
    clock.rate = rate;
    const W = w.ctxNow() + 0.02;
    clock.onStartedAtCtxTime(W, 0);
    w.t += 10000;
    const truePos = (w.hwClockSec() - W) * 1000 * rate;
    const err = Math.abs(clock.rawNowMs() - truePos);
    assert(err < 1, `rate=${rate} 误差 ${err.toFixed(4)}ms 应 < 1ms`);
  }
}

section('AudioClock: ctxTimeForMapTime 排程换算');
{
  const w = new MockWorld(0);
  const clock = new AudioClock(makeSrc(w));
  warmup(w, clock);
  const W = w.ctxNow() + 0.02;
  clock.onStartedAtCtxTime(W, 1000);
  w.t += 50;
  const nowMs = clock.rawNowMs();
  const at = clock.ctxTimeForMapTime(nowMs + 100)!;
  // 期望: mapTime=now+100 对应真实硬件时间 hwClock+0.1s; 排程值应精确到亚毫秒
  const expected = w.hwClockSec() + 0.1;
  assert(Math.abs(at - expected) < 0.001, `排程时间误差 ${(Math.abs(at - expected) * 1000).toFixed(4)}ms 应 < 1ms`);
  assert(clock.ctxTimeForMapTime(nowMs - 5000) === null, '过去时刻应返回 null');
}

// ---------- 2. HitSoundScheduler ----------
section('HitSoundScheduler: 事件恰好排程一次且时间正确');
{
  const w = new MockWorld(0);
  const clock = new AudioClock(makeSrc(w));
  warmup(w, clock);
  const scheduled: { at: number; id: string }[] = [];
  const sched = new HitSoundScheduler(clock, { schedule: (at, id) => scheduled.push({ at, id }) });
  sched.setEvents([
    { mapTimeMs: 1000, soundId: 'hitnormal' },
    { mapTimeMs: 1200, soundId: 'hitwhistle' },
    { mapTimeMs: 5000, soundId: 'hitclap' },
  ]);
  const W = w.ctxNow() + 0.02;
  clock.onStartedAtCtxTime(W, 900);
  // 逐帧推进 5 秒
  for (let i = 0; i < 300; i++) { w.t += 16.6; sched.tick(); }
  assert(scheduled.length === 3, `应排程 3 个事件, 实际 ${scheduled.length}`);
  const ev1 = scheduled.find(s => s.id === 'hitnormal')!;
  assert(ev1 && Math.abs(ev1.at - w.hwClockSec()) < 5, 'hitnormal 排程时间应在过去 5 秒内');
  assert(scheduled.filter(s => s.id === 'hitwhistle').length === 1, 'hitwhistle 只排程一次');
}

section('HitSoundScheduler: 静音与 resync');
{
  const w = new MockWorld(0);
  const clock = new AudioClock(makeSrc(w));
  warmup(w, clock);
  const scheduled: string[] = [];
  const sched = new HitSoundScheduler(clock, { schedule: (_at, id) => scheduled.push(id) });
  sched.setEvents([{ mapTimeMs: 1000, soundId: 'hitnormal' }, { mapTimeMs: 1100, soundId: 'hitclap' }]);
  clock.onStartedAtCtxTime(w.ctxNow() + 0.02, 900);
  sched.setMuted(true);
  w.t += 500; sched.tick();
  assert(scheduled.length === 0, '静音中不应排程');
  sched.setMuted(false);
  sched.resync(); // 跳过已过去事件
  sched.tick();
  assert(scheduled.length === 0, 'resync 后已过去事件不应补播');
}

// ---------- 3. 核心回归 (公式/timing/路径) ----------
section('回归: AR/CS 官方公式');
{
  assert(arToPreempt(10) === 450 && arToPreempt(0) === 1800 && arToPreempt(9) === 600, 'AR preempt 端点值');
  assert(Math.abs(arToFadeIn(10) - 300) < 1e-9 && Math.abs(arToFadeIn(0) - 1200) < 1e-9, 'AR fadeIn = 2/3 preempt');
  assert(Math.abs(csToRadius(4) - 36.48) < 1e-9, 'CS4 半径 36.48');
}
section('回归: timing 查询');
{
  const tps = parseOsu('osu file format v14\n\n[TimingPoints]\n1000,500,4,1,0,80,1,0\n2000,-50,4,2,0,60,0,1\n').timingPoints;
  assert(tps.length === 2 && !tps[1].uninherited && tps[1].effects === 1, '红绿线解析');
  const { red, green } = timingAt(tps, 2500);
  assert(red.time === 1000 && green?.time === 2000, 'timingAt 2500ms');
  assert(Math.abs(sliderVelocityAt(tps, 2500, 1.4) - (100 * 1.4 * 2) / 500) < 1e-9, 'SV 2x 速度');
}
section('回归: 滑条路径');
{
  const lin = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100);
  assert(Math.abs(lin.totalLength - 100) < 1 && Math.abs(lin.positionAt(50).x - 50) < 1, '直线中点');
  const bez = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 50, y: 100 }, { x: 150, y: 0 }], 300);
  assert(bez.totalLength > 100, '红点分段贝塞尔有长度');
}

// ---------- 4. M0: 真实谱面无损往返 ----------
section('M0: 真实谱面 round-trip (两遍深度相等 + raw sections byte 级保留)');
{
  const SONGS = process.env.OSU_SONGS_DIR ?? '';
  const files: string[] = [];
  if (fs.existsSync(SONGS)) {
    const walk = (dir: string, depth: number) => {
      if (depth > 2 || files.length >= 60) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= 60) break;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.osu')) files.push(p);
      }
    };
    walk(SONGS, 0);
  }
  console.log(`  找到 ${files.length} 个 .osu 文件`);
  if (SONGS) assert(files.length >= 10, '真实谱面样本数应 >= 10'); // 未设 $OSU_SONGS_DIR 时跳过

  const normIds = (bm: ReturnType<typeof parseOsu>) => {
    bm.hitObjects.forEach(o => { o.id = 0; });
    return bm;
  };
  const extractSection = (text: string, sec: string): string[] => {
    const out: string[] = [];
    let inSec = false;
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[') && line.endsWith(']')) { inSec = line === `[${sec}]`; continue; }
      if (inSec && line) out.push(line);
    }
    return out;
  };

  let checked = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const name = path.basename(f).slice(0, 60);
    try {
      const bm1 = parseOsu(text);
      const ser = serializeOsu(bm1);
      const bm2 = parseOsu(ser);
      // 两遍深度相等 (语义无损)
      const j1 = JSON.stringify(normIds(bm1));
      const j2 = JSON.stringify(normIds(bm2));
      assert(j1 === j2, `${name}: 两遍解析深度相等`);
      // raw sections byte 级保留: Events / Colours 及未建模 section
      for (const sec of Object.keys(bm1.rawSections ?? {})) {
        const orig = extractSection(text, sec);
        const round = extractSection(ser, sec);
        assert(JSON.stringify(orig) === JSON.stringify(round), `${name}: [${sec}] 原文保留 (${orig.length} 行 vs ${round.length} 行)`);
      }
      // hitSample / edge 原始字段保留 (抽查含非默认值的)
      for (const o of bm1.hitObjects) {
        if (o.hitSampleRaw && o.hitSampleRaw !== '0:0:0:0:') {
          assert(ser.includes(o.hitSampleRaw), `${name}: hitSample "${o.hitSampleRaw}" 保留`);
          break;
        }
      }
      checked++;
    } catch (e) {
      failures++;
      console.error(`  FAIL: ${name} 异常:`, (e as Error).message);
    }
  }
  console.log(`  round-trip 通过 ${checked}/${files.length}`);
  assert(checked === files.length, '全部谱面 round-trip 通过');
}

if (failures === 0) console.log('ALL_V6_TESTS_PASSED');
else { console.error(`${failures} 个断言失败`); process.exit(1); }

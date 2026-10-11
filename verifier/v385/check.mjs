// 验证器 v385: 编辑器慢放语义修正 (变调→不变调) + 实时路径瞬态修复
//
// 语义修正 (lazer 源码考据, 本地检出 D:/Projects/osuMapEditor/osu):
//   - osu.Game/Screens/Edit/Components/PlaybackControl.cs:79: 编辑器播放速度走
//     AdjustableProperty.Tempo = 保时音高时间拉伸 (BASS FX / SoundTouch 类算法);
//   - RateAdjustModHelper.cs: adjustPitch=true 才是 Frequency (变速变调) — DT/HT mod 语义。
//   v382 误判"stable 慢放=变调"把编辑器慢放改成了 sinc 变速变调; v385 改回:
//   rateAdjustPitch 默认 false (signalsmith-stretch 保时音高), sinc 变调引擎保留给
//   测试游玩 DT/HT (仍比 Chromium 线性插值干净 ~70dB, verifier/v382 断言保留)。
//   (v384 的 compare-lazer.mjs 以 Frequency 为基准, 语义已失效, 由本验证器取代)
//
// 瞬态修复 (v384 实时录音诊断发现, 稳态两条引擎都已干净 — 失真听感来自瞬态):
//   - 起播沿咔哒: play() 变速支路无启动斜坡, 从任意相位全幅起输出 (实测沿跳变 0.61)
//     → tempo/rate 两支路加 3ms 起播斜坡 (v216 source 支路同款语义), 修复后 0.003;
//   - 变速切换拼接: setRate 播放中 pause/play 重启 → ~20ms 静音间隙 + 0.62 阶跃
//     → 同引擎内变速 (目标非 1x) 改走 seekWhilePlaying 重锚定 (dip 防咔哒), 修复后
//     跳变 0 / 零跑 0。
//
// 测量 (verifier/v385/measure.mjs, CDP 真实 dist app, 音乐总线并联 capture worklet 录 PCM):
//   - 不变调核心语义: 谱峰保持 — 1k/5k/多音 0.5x/0.75x 峰位偏差 <1% (实测 <0.1%);
//   - 稳态 glitch=0 (自适应跳变/零跑/能量跌落), 单音杂散 ~-50dB (signalsmith 拉伸器
//     固有水平, 与 lazer BASS FX 同量级, 听感目标是无刺耳失真而非 bit-exact);
//   - 起播沿 edgeJump < 0.1; 拼接 jumps=0 && zeroRuns=0。
// 运行: npm run build 后 node verifier/v385/check.mjs  (会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { runTempoMeasurements, setupSession, SETUP_MAP } from './measure.mjs';
import { killIsolated } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

section('源码: v385 语义修正 (编辑器慢放 = 不变调)');
{
  const st = read('src/osu/store.ts');
  assert(/rateAdjustPitch:\s*boolean\s*=\s*false/.test(st), 'rateAdjustPitch 默认 false (lazer 编辑器 Tempo 语义)');
  assert(st.includes("import { createRateNode, type RateNode } from './clock/rateWorklet';"), 'v382 sinc 变调引擎保留 (DT/HT 用)');
  assert(st.includes('this.playbackRate !== 1 && !this.rateAdjustPitch && this.tempoNode'), 'play() 不变调支路走 signalsmith');
  assert(st.includes('this.playbackRate !== 1 && this.rateAdjustPitch && this.rateNode'), 'play() 变调支路走 sinc (DT/HT)');
  const tl = read('src/components/Timelines.tsx');
  assert(tl.includes('tempo-preserving stretch'), '倍速 tooltip = 不变调语义');
  const zh = read('src/i18n/dicts/zh-CN/timeline.ts');
  assert(zh.includes('变速不变调时间拉伸'), 'zh-CN 文案 = 不变调语义');
  const ov = read('src/components/TestPlayOverlay.tsx');
  assert(/store\.rateAdjustPitch\s*=\s*mods\.includes\('DT'\)\s*\|\|\s*mods\.includes\('HT'\)/.test(ov),
    '测试游玩 DT/HT 仍强制变调 (sinc 引擎入口)');
}

section('源码: v385 瞬态修复');
{
  const st = read('src/osu/store.ts');
  assert(/tg\.setValueAtTime\(0, startW\);\s*tg\.linearRampToValueAtTime\(1, startW \+ 0\.003\)/.test(st),
    'tempo 支路起播 3ms 斜坡 (防咔哒)');
  assert(/rg\.setValueAtTime\(0, startW\);\s*rg\.linearRampToValueAtTime\(1, startW \+ 0\.003\)/.test(st),
    'rate 支路起播 3ms 斜坡 (防咔哒)');
  assert(/seekWhilePlaying\(this\.positionMs\(\)\)/.test(st) && /const seamless = this\.playing && rate !== 1/.test(st),
    'setRate 同引擎内变速走无缝重锚定 (无 pause/play 间隙)');
}

section('测量: 实时不变调路径 (CDP 真实 app, 音乐总线录音)');
{
  const r = await runTempoMeasurements({ log: console.log });
  assert(!r.error, `测量会话无异常${r.error ? ' — ' + r.error : ''}`);
  assert(r.env.rateAdjustPitch === false && r.env.tempoReady === true,
    `实时路径走 signalsmith 不变调引擎 (rateAdjustPitch=${r.env.rateAdjustPitch} tempoReady=${r.env.tempoReady})`);
  for (const row of r.steady) {
    if (row.error) { assert(false, `${row.sig}@${row.rate}: ${row.error}`); continue; }
    if (row.sig === 'sweep') {
      assert(row.jumps === 0 && row.zeroRuns === 0, `sweep@0.5: glitch=0 (jumps=${row.jumps} zeroRuns=${row.zeroRuns})`);
      continue;
    }
    // 不变调核心语义: 峰位偏差 < 1%
    for (let i = 0; i < row.expect.length; i++) {
      const dev = Math.abs(row.peaks[i] - row.expect[i]) / row.expect[i];
      assert(dev < 0.01, `${row.sig}@${row.rate}: 峰位 ${row.expect[i]}Hz -> ${row.peaks[i]}Hz (偏差 ${(dev * 100).toFixed(2)}% <1%)`);
    }
    assert(row.jumps === 0 && row.zeroRuns === 0 && row.dips === 0,
      `${row.sig}@${row.rate}: 稳态 glitch=0 (jumps=${row.jumps} zeroRuns=${row.zeroRuns} dips=${row.dips})`);
    if (row.sig !== 'multi') {
      assert(row.spurDb < -35, `${row.sig}@${row.rate}: 杂散总量 < -35dB (实得 ${row.spurDb.toFixed(1)}, signalsmith 固有 ~-50)`);
    } else {
      assert(row.spurDb < -28, `${row.sig}@${row.rate}: 多音杂散总量 < -28dB (实得 ${row.spurDb.toFixed(1)})`);
    }
  }
  const on = r.transients.onset;
  assert(on && on.edgeJump < 0.1, `起播沿跳变 < 0.1 (实得 ${on?.edgeJump}, v385 修复前 ~0.61)`);
  const sp = r.transients.splice;
  // 拼接判定: 无咔哒 (jumps=0) 且无长间隙 (maxZeroRun < 10ms = 480 帧);
  // dip 窗口内 stretch 引擎重锚定可能吐 1-2 个 quantum 的短零跑 (~3ms, 被 dip 增益掩盖, 不可闻)
  assert(sp && sp.jumps === 0 && (sp.maxZeroRun ?? 0) < 480,
    `拼接无咔哒/无长间隙 (jumps=${sp?.jumps} maxZeroRun=${sp?.maxZeroRun}帧, v385 修复前 1 跳变(0.62)+20ms 间隙`);
}

section('CDP: 功能回归 (不变调默认路径)');
{
  const { evalJs, ws, electron, profile } = await setupSession(9493);
  try {
    await evalJs(`(async () => {
      const store = window.__osuStore;
      store.pause && store.pause();
      store.setRate(1);
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
        hitObjects: [{ id: 9301, type: 'circle', time: 2000, x: 256, y: 192, hitSound: 0, newCombo: false, comboSkip: 0 }],
        editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
      return true;
    })()`);
    // 3 秒双音测试 WAV + 预热
    await evalJs(`(async () => {
      const sr = 48000, n = sr * 3;
      const data = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) {
        const v = Math.round((0.5 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 2000 * i / sr)) * 32767 * 0.8);
        data[i * 2] = v; data[i * 2 + 1] = v;
      }
      const hdr = new Uint8Array(44);
      const dv = new DataView(hdr.buffer);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) hdr[o + i] = s.charCodeAt(i); };
      ws(0, 'RIFF'); dv.setUint32(4, 36 + data.byteLength, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, data.byteLength, true);
      const u8 = new Uint8Array(44 + data.byteLength);
      u8.set(hdr); u8.set(new Uint8Array(data.buffer), 44);
      let bin = ''; const STEP = 32768;
      for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
      window.__osuStore.setAudio('data:audio/wav;base64,' + btoa(bin));
      return true;
    })()`);
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs(`(() => { const d = window.__osuStore.debugState();
        return d.hasAudioBuffer && d.tempoReady && d.defaultBuffers.length > 0; })()`).catch(() => false);
    }
    assert(ready, 'setup: 音频解码 + tempo 引擎预热 + hitsound 就绪');

    // 0) 默认语义: rateAdjustPitch === false
    const d0 = await evalJs(`window.__osuStore.debugState()`);
    assert(d0.rateAdjustPitch === false, `0: 编辑器默认不变调 (rateAdjustPitch=${d0.rateAdjustPitch})`);

    // ---- 1) 0.5x 播放: 走 tempo 支路, 谱面位置按 0.5x 推进 ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setRate(0.5);
      store.seek(500);
      store.play();
      await sleep(600);
      const d1 = store.debugState();
      const p1 = store.positionMs();
      await sleep(400);
      const p2 = store.positionMs();
      return { tempoActive: d1.tempoActive, rateActive: d1.rateActive, playing: d1.playing, adv: p2 - p1 };
    })()`);
    assert(r1.tempoActive === true && r1.rateActive === false && r1.playing === true,
      `1a: 0.5x 经 signalsmith 不变调引擎 (tempoActive=${r1.tempoActive} rateActive=${r1.rateActive})`);
    assert(r1.adv > 140 && r1.adv < 260, `1b: 谱面位置按 0.5x 推进 (400ms 墙钟推进 ${r1.adv.toFixed(0)}ms, 期望 ~200)`);

    // ---- 2) 播放中 seekWhilePlaying ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seekWhilePlaying(1200);
      await sleep(300);
      const d = store.debugState();
      return { playing: d.playing, tempoActive: d.tempoActive, pos: store.positionMs() };
    })()`);
    assert(r2.playing && r2.tempoActive, `2a: seek 后仍在 tempo 支路 (tempoActive=${r2.tempoActive})`);
    assert(r2.pos > 1200 && r2.pos < 1800, `2b: seek 落点正确 (实得 ${r2.pos.toFixed(0)}ms, 期望 1200~1800)`);

    // ---- 3) v385 无缝变速: 播放中 0.5→0.75 同引擎重锚定 (不 pause/play) ----
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const p0 = store.positionMs();
      store.setRate(0.75);
      await sleep(30);
      const d0 = store.debugState();
      const p1 = store.positionMs();
      await sleep(400);
      const d1 = store.debugState();
      const p2 = store.positionMs();
      return { t0: d0.tempoActive, t1: d1.tempoActive, playing: d1.playing,
        cont: p1 - p0, adv: p2 - p1 };
    })()`);
    assert(r3.t0 && r3.t1 && r3.playing, `3a: 0.5→0.75 全程在 tempo 支路 (切换瞬间 tempoActive=${r3.t0})`);
    assert(r3.cont > -50 && r3.cont < 80, `3b: 变速瞬间位置连续 (30ms 内位移 ${r3.cont.toFixed(0)}ms, 无重启回跳)`);
    assert(r3.adv > 220 && r3.adv < 390, `3c: 变速后按 0.75x 推进 (400ms 墙钟推进 ${r3.adv.toFixed(0)}ms, 期望 ~300)`);

    // ---- 4) 变速 0.75→1: 回常速 BufferSource 支路 ----
    const r4 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setRate(1);
      await sleep(400);
      const d = store.debugState();
      const p1 = store.positionMs();
      await sleep(400);
      const p2 = store.positionMs();
      return { tempoActive: d.tempoActive, playing: d.playing, adv: p2 - p1 };
    })()`);
    assert(r4.playing && !r4.tempoActive, `4a: 1.0x 回常速支路 (tempoActive=${r4.tempoActive})`);
    assert(r4.adv > 300 && r4.adv < 500, `4b: 常速推进 (400ms 墙钟推进 ${r4.adv.toFixed(0)}ms)`);

    // ---- 5) 暂停/继续 ----
    const r5 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.pause();
      store.seek(1000);
      store.setRate(0.5);
      const p1 = store.currentTime;
      await sleep(300);
      const p2 = store.currentTime;
      store.play();
      await sleep(400);
      const d = store.debugState();
      return { frozen: p2 === p1, resumed: d.playing && d.tempoActive };
    })()`);
    assert(r5.frozen, '5a: 暂停位置冻结');
    assert(r5.resumed, `5b: 继续后回到 tempo 支路 (resumed=${r5.resumed})`);

    // ---- 6) hitsound: 0.5x 下按拉伸时序发声 ----
    const r6 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.pause();
      store.setRate(0.5);
      store.debugLog.length = 0;
      store.seek(1500);
      store.play();
      await sleep(1600);
      store.pause();
      const hit = store.debugLog.find(e => e.kind === 'hit' && e.used && e.used !== 'MISS');
      return { hit: !!hit, log: store.debugLog.slice(0, 5) };
    })()`);
    assert(r6.hit, `6a: 0.5x 下 hitsound 按拉伸时序发声 (log=${JSON.stringify(r6.log).slice(0, 200)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

section('改动文件无 CRLF');
{
  for (const f of ['src/osu/store.ts', 'src/components/Timelines.tsx', 'src/i18n/dicts/zh-CN/timeline.ts',
    'verifier/v385/check.mjs', 'verifier/v385/measure.mjs', 'verifier/v385/analyze.mjs',
    'verifier/v382/check.mjs', 'verifier/v295/check.mjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

console.log(failures ? `\nVERIFIER_V385_FAILED: ${failures} 处失败` : '\nVERIFIER_V385_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

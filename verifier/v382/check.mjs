// 验证器 v382: 慢放音质优化 — 自研窗 sinc 重采样引擎
// (src/osu/clock/rateResampler.worklet.js + rateWorklet.ts), 取代两条失真路径:
//   - 编辑器慢放原走 signalsmith-stretch 不变调拉伸 (v296) — 稳态 spur ~-50dB;
//   - 变调回退/DT/HT 原走 Chromium AudioBufferSourceNode.playbackRate 线性插值 —
//     实测 0.5x: 5kHz 杂散 -31dB / 10kHz -19dB (镜像+混叠折回), 听感 = 各频率刺耳失真。
// v385 语义修正: 编辑器慢放 = lazer 编辑器 Tempo 不变调 (rateAdjustPitch 默认 false,
//   PlaybackControl.cs:79 考据); 本 sinc 变调路径保留给测试游玩 DT/HT (Frequency 语义),
//   仍是相比 Chromium 线性插值 ~70dB 的升级。本验证器 CDP 段显式 rateAdjustPitch=true
//   专测 sinc 引擎, 断言语义不变。
// sinc 路径实测 (verifier/v382/measure.mjs, 见下"测量断言"):
//   0.5x 单音杂散总量 ~-89dB / 峰值 ~-97dB, 0.75x ~-104~-115dB, THD < 0.01% — 逼近理想重采样。
// 功能回归 (CDP 真实编辑器): 0.5x 播放走 rateActive 支路且谱面位置按 0.5x 推进;
//   播放中 seekWhilePlaying (v226 语义保留)、变速切换 (0.5→1→0.75)、暂停/继续、hitsound 拉伸时序。
// 运行: npm run build 后 node verifier/v382/check.mjs  (会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { runMeasurements, printTable } from './measure.mjs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs'; // v383: 环境归一共享 helper

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: sinc 重采样引擎接入');
{
  const st = read('src/osu/store.ts');
  assert(/rateAdjustPitch:\s*boolean\s*=\s*false/.test(st), '编辑器慢放默认不变调 (v385 语义修正: lazer 编辑器 Tempo)')
  assert(st.includes("import { createRateNode, type RateNode } from './clock/rateWorklet';"), 'store 引入 rateWorklet');
  assert(/private ensureRateNode\(\)/.test(st), 'ensureRateNode (幂等异步加载+PCM 移交)');
  assert(st.includes('this.playbackRate !== 1 && this.rateAdjustPitch && this.rateNode'), 'play() 变调支路走 sinc 引擎');
  assert(st.includes('this.playbackRate !== 1 && !this.rateAdjustPitch && this.tempoNode'), 'signalsmith 不变调支路保留 (备选)');
  assert(st.includes('this.playbackRate !== 1 && this.rateAdjustPitch && !this.rateNode'), 'worklet 未就绪回退原生 playbackRate + 就绪重进');
  assert(/else if \(this\.rateActive && this\.rateNode\)/.test(st), 'seekWhilePlaying 变速支路 (v226 dip 语义)');
  assert(/this\.rateNode\.schedule\(\{ output: startW, input: offset, rate: this\.playbackRate, active: true \}\)/.test(st), 'schedule 锚定语义同 source.start(startW, offset)');
  assert(/if \(this\.rateEndTimer\) \{ clearTimeout/.test(st) && /this\.rateActive = false;/.test(st), 'stopSource 清理 rate 引擎');
  assert(/rateReady: !!this\.rateNode/.test(st), 'debugState 暴露 rateReady/rateActive');
  const rw = read('src/osu/clock/rateWorklet.ts');
  assert(/from '\.\/rateResampler\.worklet\.js\?raw'/.test(rw), 'worklet 源码 ?raw 内联');
  assert(/numberOfInputs:\s*0/.test(rw), 'buffer 模式 (无输入连接)');
  const wp = read('src/osu/clock/rateResampler.worklet.js');
  assert(/registerProcessor\('osu-rate-resampler'/.test(wp), '处理器注册');
  assert(/Math\.sin\(Math\.PI \* sx\) \/ \(Math\.PI \* sx\)/.test(wp), 'sinc 插值核');
  assert(/const HALF = 24/.test(wp) && /const PHASES = 2048/.test(wp), '48-tap / 2048 相位');
  assert(/Math\.min\(1, 1 \/ step\)/.test(wp), '加速抗混叠截止 (cutoff=1/step)');
  assert(/if \(m\.schedule\) this\.applySchedule\(m\.schedule\)/.test(wp), 'buffers 消息可附带原子 schedule (离线背靠背丢消息防护)');
  assert(/buffers-acked/.test(wp), 'buffers 送达回执 (测量确定性)');
  const tl = read('src/components/Timelines.tsx');
  assert(tl.includes('tempo-preserving stretch'), '倍速按钮 tooltip 已恢复不变调语义 (v385)');
}

section('测量: sinc vs Chromium vs signalsmith (OfflineAudioContext, 48kHz)');
{
  const rows = await runMeasurements({ log: () => { } });
  printTable(rows);
  const get = (sig, kind, rate) => rows.find(r => r.sig === sig && r.kind === kind && r.rate === rate);
  // sinc 路径质量阈值 (实测余量 ~10dB)
  for (const sig of ['sine1k', 'sine5k', 'sine10k']) {
    for (const rate of [0.75, 0.5]) {
      const r = get(sig, 'sinc', rate);
      assert(r && !r.error, `${sig}@${rate}: sinc 渲染成功`);
      if (!r || r.error) continue;
      assert(r.spurDb < -75, `${sig}@${rate}: sinc 杂散总量 < -75dB (实得 ${r.spurDb.toFixed(1)})`);
      assert(r.maxSpurDb < -85, `${sig}@${rate}: sinc 最大杂散峰 < -85dB (实得 ${r.maxSpurDb.toFixed(1)})`);
      assert(r.thdPct !== null && r.thdPct < 0.01, `${sig}@${rate}: sinc THD < 0.01% (实得 ${r.thdPct?.toFixed(5)})`);
    }
  }
  const multi5 = get('multi', 'sinc', 0.5);
  assert(multi5 && multi5.spurDb < -75, `multi@0.5: sinc 杂散总量 < -75dB (实得 ${multi5?.spurDb.toFixed(1)})`);
  // 透明对照: rate=1 直通
  const pass = get('sine10k', 'sinc', 1);
  assert(pass && pass.spurDb < -55, `sine10k@1: 直通杂散 < -55dB (实得 ${pass?.spurDb.toFixed(1)})`);
  // 相对 Chromium 重采样的改善幅度 (基线: 10kHz@0.5 spur -18.8dB)
  const cr = get('sine10k', 'chromium', 0.5);
  const si = get('sine10k', 'sinc', 0.5);
  assert(cr && si && si.spurDb < cr.spurDb - 40,
    `sine10k@0.5: sinc 较 Chromium 改善 > 40dB (chromium ${cr?.spurDb.toFixed(1)} -> sinc ${si?.spurDb.toFixed(1)})`);
}

section('CDP: 真实编辑器功能回归');
{
  const PORT = 9484;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 3 秒双声道 48k 测试音 (440+2000Hz) 16bit WAV data-url
  const wavB64 = (() => {
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
    return btoa(bin);
  })();
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT); // v383: 隔离 userData, 不碰真实 settings/localStorage
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuSetLang)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs); // v383: 环境归一 (语言 en / 默认皮肤 / 关曲库与首跑框 / 清污染键)

    // setup: 归一持久化状态 + 加载测试音/测试谱面
    await evalJs(`(async () => {
      const store = window.__osuStore;
      window.__osuSetLang && window.__osuSetLang('en');
      store.pause && store.pause();
      store.setRate(1);
      store.rateAdjustPitch = true; // v385: 默认已改回 false (编辑器不变调), 这里显式选 sinc 变调引擎专测
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
        hitObjects: [{ id: 9301, type: 'circle', time: 2000, x: 256, y: 192, hitSound: 0, newCombo: false, comboSkip: 0 }],
        editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
      store.setAudio('data:audio/wav;base64,${wavB64}');
      return true;
    })()`);
    // 等解码 + sinc 引擎就绪 + 默认 hitsound 加载 (defaultsLoading 是"已开始"标志, 不复位, 看 defaultBuffers)
    // v447: 引擎改懒建 (解码不再预热), 轮询内显式 ensureRateNode 触发构建
    let engineReady = false;
    for (let i = 0; i < 60 && !engineReady; i++) {
      await sleep(500);
      engineReady = await evalJs(`(() => { const s = window.__osuStore; const d = s.debugState();
        if (d.hasAudioBuffer && !d.rateReady) s.ensureRateNode();
        return d.hasAudioBuffer && d.rateReady && d.defaultBuffers.length > 0; })()`).catch(() => false);
    }
    assert(engineReady, 'setup: 音频解码 + sinc 引擎就绪 (v447 懒建, 显式 ensure) + hitsound 就绪');

    // ---- 1) 0.5x 播放: 走 sinc 支路, 谱面位置按 0.5x 推进 ----
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
      return { rateActive: d1.rateActive, tempoActive: d1.tempoActive, playing: d1.playing, adv: p2 - p1 };
    })()`);
    assert(r1.rateActive === true && r1.tempoActive === false && r1.playing === true,
      `1a: 0.5x 经 sinc 重采样引擎 (rateActive=${r1.rateActive} tempoActive=${r1.tempoActive})`);
    assert(r1.adv > 140 && r1.adv < 260, `1b: 谱面位置按 0.5x 推进 (400ms 墙钟推进 ${r1.adv.toFixed(0)}ms, 期望 ~200)`);

    // ---- 2) 播放中 seekWhilePlaying (v226 语义: 引擎不重建, 重锚定) ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seekWhilePlaying(1200);
      await sleep(300);
      const d = store.debugState();
      const p = store.positionMs();
      return { playing: d.playing, rateActive: d.rateActive, pos: p };
    })()`);
    assert(r2.playing && r2.rateActive, `2a: seek 后仍在 sinc 支路播放 (rateActive=${r2.rateActive})`);
    assert(r2.pos > 1200 && r2.pos < 1800, `2b: seek 落点正确 (实得 ${r2.pos.toFixed(0)}ms, 期望 1200~1800)`);

    // ---- 3) 播放中变速 0.5→1: 退回常速 BufferSource 支路 ----
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setRate(1);
      await sleep(400);
      const d1 = store.debugState();
      const p1 = store.positionMs();
      await sleep(400);
      const p2 = store.positionMs();
      return { rateActive: d1.rateActive, playing: d1.playing, adv: p2 - p1 };
    })()`);
    assert(r3.playing && !r3.rateActive, `3a: 1.0x 回常速支路 (rateActive=${r3.rateActive})`);
    assert(r3.adv > 300 && r3.adv < 500, `3b: 常速推进 (400ms 墙钟推进 ${r3.adv.toFixed(0)}ms)`);

    // ---- 4) 播放中变速 1→0.75: 重进 sinc 支路 ----
    const r4 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setRate(0.75);
      await sleep(500);
      const d = store.debugState();
      const p1 = store.positionMs();
      await sleep(400);
      const p2 = store.positionMs();
      return { rateActive: d.rateActive, playing: d.playing, adv: p2 - p1 };
    })()`);
    assert(r4.playing && r4.rateActive, `4a: 0.75x 重进 sinc 支路 (rateActive=${r4.rateActive})`);
    assert(r4.adv > 220 && r4.adv < 390, `4b: 谱面位置按 0.75x 推进 (400ms 墙钟推进 ${r4.adv.toFixed(0)}ms, 期望 ~300)`);

    // ---- 5) 暂停/继续: 位置冻结/恢复 (先 seek 回 1000ms 留足余量, 防 3s 测试音播完) ----
    const r5 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.pause();
      store.seek(1000);
      const p1 = store.currentTime;
      await sleep(300);
      const p2 = store.currentTime;
      const dPaused = store.debugState();
      store.play();
      await sleep(400);
      const d = store.debugState();
      return { frozen: p2 === p1, pausedActive: dPaused.rateActive, resumed: d.playing && d.rateActive };
    })()`);
    assert(r5.frozen && !r5.pausedActive, `5a: 暂停位置冻结且引擎停止 (frozen=${r5.frozen})`);
    assert(r5.resumed, `5b: 继续后回到 sinc 支路 (resumed=${r5.resumed})`);

    // ---- 6) hitsound: 0.5x 下按拉伸时序发声 (map 2000ms 的 circle) ----
    const r6 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.pause();
      store.setRate(0.5);
      store.debugLog.length = 0;
      store.seek(1500);
      store.play();
      // map 1500->2000 在 0.5x 下需 1000ms 墙钟
      await sleep(1600);
      store.pause();
      // debugPush 的 mapTimeMs 恒为 NaN (排程回调拿不到谱面时间), 以"非 MISS 的 hit 记录"判发声
      const hit = store.debugLog.find(e => e.kind === 'hit' && e.used && e.used !== 'MISS');
      return { hit: !!hit, log: store.debugLog.slice(0, 5) };
    })()`);
    assert(r6.hit, `6a: 0.5x 下 hitsound 按拉伸时序发声 (log=${JSON.stringify(r6.log).slice(0, 200)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile); // v383: 杀进程 + 回收临时 profile
  }
}

section('改动文件无 CRLF');
{
  for (const f of ['src/osu/store.ts', 'src/osu/clock/rateWorklet.ts', 'src/osu/clock/rateResampler.worklet.js',
    'src/components/Timelines.tsx', 'src/i18n/dicts/zh-CN/timeline.ts',
    'verifier/v382/check.mjs', 'verifier/v382/measure.mjs', 'verifier/v295/check.mjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

console.log(failures ? `\nVERIFIER_V382_FAILED: ${failures} 处失败` : '\nVERIFIER_V382_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

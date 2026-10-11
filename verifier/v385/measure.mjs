// v385: 编辑器慢放 (signalsmith-stretch 保时音高) 实时路径测量 — CDP 起真实 dist app,
// 音乐总线并联 capture worklet 录原始 PCM, Node 侧分析。
// 测量项:
//   1) 稳态矩阵: 1k/5k 正弦 + 多音, 0.5x/0.75x — 峰位保持 (不变调核心语义) + 杂散 + glitch;
//   2) 扫频 0.5x — glitch 扫描;
//   3) 起播瞬态: 从峰值相位点起播, 查起始阶跃 (v384 诊断: 修复前沿跳变 ~0.6 = 咔哒);
//   4) 拼接瞬态: 播放中 seekWhilePlaying x2 + setRate 0.5→0.75 (v385 同引擎无缝重锚定),
//      查样本级跳变/零跑 (v384 诊断: 修复前 setRate pause/play 有 ~20ms 间隙 + 0.62 阶跃)。
// 用法: node verifier/v385/measure.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';
import { analyze, peakFreq, glitchScanAdaptive } from './analyze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9492;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const RT_SIGNALS = {
  sine1k: [1000], sine5k: [5000],
  multi: [697, 1369, 2543, 4211, 7431, 11881],
};

// 页内: 合成 16bit 立体声 WAV data-url (多音防 int16 溢出)
const wavMakerSrc = `(freqs, secs, sr) => {
  const n = sr * secs;
  const data = new Int16Array(n * 2);
  const amp = Math.min(0.7 / Math.sqrt(freqs.length), 0.85 / freqs.length);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of freqs) v += amp * Math.sin(2 * Math.PI * f * i / sr);
    const s = Math.round(v * 32767 * 0.9);
    data[i * 2] = s; data[i * 2 + 1] = s;
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
  return 'data:audio/wav;base64,' + btoa(bin);
}`;

// 页内: 扫频 WAV (200Hz -> 12kHz 指数扫)
const sweepMakerSrc = `(secs, sr) => {
  const n = sr * secs;
  const data = new Int16Array(n * 2);
  const f0 = 200, f1 = 12000, k = Math.log(f1 / f0) / secs;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = 2 * Math.PI * f0 * (Math.exp(k * t) - 1) / k;
    const s = Math.round(0.6 * Math.sin(ph) * 32767 * 0.9);
    data[i * 2] = s; data[i * 2 + 1] = s;
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
  return 'data:audio/wav;base64,' + btoa(bin);
}`;

const CAPTURE_SETUP = `(async () => {
  const store = window.__osuStore;
  const actx = store.actx;
  if (!window.__capNode) {
    const capSrc = 'class Cap extends AudioWorkletProcessor {' +
      'process(inputs, outputs) {' +
      'const inp = inputs[0];' +
      'if (inp && inp[0]) this.port.postMessage({ l: inp[0].slice(0), r: inp[1] ? inp[1].slice(0) : inp[0].slice(0) });' +
      'return true; } } registerProcessor("v385-cap", Cap);';
    const url = URL.createObjectURL(new Blob([capSrc], { type: 'application/javascript' }));
    await actx.audioWorklet.addModule(url);
    const cap = new AudioWorkletNode(actx, 'v385-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    window.__capChunks = [];
    cap.port.onmessage = (e) => { window.__capChunks.push(e.data); };
    const sink = actx.createGain(); sink.gain.value = 0;
    store.ensureMusicBus().connect(cap);
    cap.connect(sink); sink.connect(actx.destination);
    window.__capNode = cap;
  }
  return true;
})()`;

// 页内: 清空 chunks → 执行动作 → 录 recordMs → 暂停 → 取回拼接 PCM (base64)
const recordExpr = (actionJs, recordMs) => `(async () => {
  const store = window.__osuStore;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.__capChunks = [];
  ${actionJs}
  await sleep(${recordMs});
  store.pause();
  await sleep(50);
  let total = 0; for (const c of window.__capChunks) total += c.l.length;
  const L = new Float32Array(total);
  let o = 0;
  for (const c of window.__capChunks) { L.set(c.l, o); o += c.l.length; }
  const u8 = new Uint8Array(L.buffer);
  let bin = ''; const STEP = 32768;
  for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
  return { sr: store.actx.sampleRate, pcm: btoa(bin) };
})()`;

const decode = (b64s) => {
  const bin = Buffer.from(b64s, 'base64');
  return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
};

/** 连接 CDP 并完成环境归一 + 空谱面 + capture 挂载; 返回 { evalJs, ws, electron, profile } */
export async function setupSession(port = PORT) {
  const { proc: electron, profile } = launchIsolatedElectron(root, port);
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { }
    if (!target) await sleep(500);
  }
  if (!target) { await killIsolated(electron, profile); throw new Error('找不到 Electron 页面目标'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);
  return { evalJs, ws, electron, profile };
}

/** 页内装空谱面 (无 hitsound 干扰) + 归一变速模式 (编辑器默认不变调) */
export const SETUP_MAP = `(async () => {
  const store = window.__osuStore;
  store.pause && store.pause();
  store.setRate(1);
  store.rateAdjustPitch = false; // v385: 编辑器慢放 = 不变调 (signalsmith tempo 引擎)
  const base = store.beatmap;
  store.load({ ...base,
    timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
    hitObjects: [], editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
  return true;
})()`;

export async function runTempoMeasurements({ log = console.log } = {}) {
  const { evalJs, ws, electron, profile } = await setupSession();
  const results = { steady: [], transients: {}, env: {} };
  try {
    await evalJs(SETUP_MAP);
    await evalJs(`(async () => { window.__osuStore.setAudio((${wavMakerSrc})([5000], 4, 48000)); return true; })()`);
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs(`(() => { const d = window.__osuStore.debugState(); return d.hasAudioBuffer && d.tempoReady; })()`).catch(() => false);
    }
    if (!ready) throw new Error('signalsmith tempo 引擎预热失败');
    await evalJs(CAPTURE_SETUP);
    results.env = await evalJs(`(() => { const s = window.__osuStore;
      return { sampleRate: s.actx.sampleRate, state: s.actx.state, baseLatency: s.actx.baseLatency,
        tempoReady: s.debugState().tempoReady, rateAdjustPitch: s.rateAdjustPitch }; })()`);
    log('env:', JSON.stringify(results.env));

    // ---- 1) 稳态矩阵 (不变调: 期望输出频率 = 原频率) ----
    for (const [sig, freqs] of Object.entries(RT_SIGNALS)) {
      for (const rate of [0.5, 0.75]) {
        await evalJs(`(async () => {
          const store = window.__osuStore;
          store.pause(); store.setRate(1);
          store.setAudio((${wavMakerSrc})(${JSON.stringify(freqs)}, 4, 48000));
          return true;
        })()`);
        let rdy = false;
        for (let i = 0; i < 40 && !rdy; i++) {
          await sleep(300);
          rdy = await evalJs(`(() => { const d = window.__osuStore.debugState(); return d.hasAudioBuffer && d.tempoReady; })()`).catch(() => false);
        }
        if (!rdy) { results.steady.push({ sig, rate, error: 'tempo engine not ready' }); continue; }
        const rec = await evalJs(recordExpr(
          `store.setRate(${rate}); store.seek(500); store.play();`,
          rate === 0.5 ? 2400 : 2000));
        const pcm = decode(rec.pcm);
        const g = glitchScanAdaptive(pcm, rec.sr);
        const N = 32768;
        const mid = Math.max(g.firstOn + Math.floor(rec.sr * 0.3), Math.floor((g.firstOn + g.lastOn) / 2) - N / 2);
        const win = pcm.subarray(mid, mid + N);
        const peaks = freqs.map(f => peakFreq(win, rec.sr, f));
        const m = analyze(win, rec.sr, freqs); // 不变调: 期望频率 = 原频率
        const row = { sig, rate, peaks: peaks.map(p => +p.toFixed(1)), expect: freqs,
          ...m, jumps: g.jumps, maxJump: +g.maxJump.toFixed(3), zeroRuns: g.zeroRuns, dips: g.dips };
        results.steady.push(row);
        log(`steady ${sig}@${rate}: peaks ${peaks.map(p => p.toFixed(1)).join('/')} (期望 ${freqs.join('/')}) spur ${row.spurDb.toFixed(1)}dB jumps ${g.jumps} zeroRuns ${g.zeroRuns} dips ${g.dips}`);
      }
    }

    // ---- 1b) 扫频 0.5x (只看 glitch) ----
    {
      await evalJs(`(async () => {
        const store = window.__osuStore;
        store.pause(); store.setRate(1);
        store.setAudio((${sweepMakerSrc})(4, 48000));
        return true;
      })()`);
      for (let i = 0; i < 40; i++) {
        await sleep(300);
        if (await evalJs(`(() => { const d = window.__osuStore.debugState(); return d.hasAudioBuffer && d.tempoReady; })()`).catch(() => false)) break;
      }
      const rec = await evalJs(recordExpr(`store.setRate(0.5); store.seek(500); store.play();`, 2400));
      const pcm = decode(rec.pcm);
      const g = glitchScanAdaptive(pcm, rec.sr);
      results.steady.push({ sig: 'sweep', rate: 0.5, jumps: g.jumps, maxJump: +g.maxJump.toFixed(3), zeroRuns: g.zeroRuns, dips: g.dips });
      log(`steady sweep@0.5: jumps ${g.jumps} maxJump ${g.maxJump.toFixed(3)} zeroRuns ${g.zeroRuns} dips ${g.dips}`);
    }

    // ---- 2) 起播瞬态: 5kHz 从峰值相位点 (500.05ms) 起播, 查起始阶跃 ----
    {
      await evalJs(`(async () => {
        const store = window.__osuStore;
        store.pause(); store.setRate(1);
        store.setAudio((${wavMakerSrc})([5000], 4, 48000));
        return true;
      })()`);
      for (let i = 0; i < 40; i++) {
        await sleep(300);
        if (await evalJs(`(() => { const d = window.__osuStore.debugState(); return d.hasAudioBuffer && d.tempoReady; })()`).catch(() => false)) break;
      }
      const rec = await evalJs(recordExpr(
        `store.setRate(0.5); store.seek(500.05); store.play();`, 1200));
      const pcm = decode(rec.pcm);
      let firstOn = -1;
      for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.01) { firstOn = i; break; }
      const edgeJump = firstOn > 0 ? Math.abs(pcm[firstOn] - pcm[firstOn - 1]) : 0;
      let onsetJump = 0;
      const end = Math.min(firstOn + Math.floor(rec.sr * 0.04), pcm.length);
      for (let i = firstOn + 1; i < end; i++) onsetJump = Math.max(onsetJump, Math.abs(pcm[i] - pcm[i - 1]));
      // 参考: 不变调输出仍为 5kHz (A~0.63) => 稳态最大一阶差分 ~0.41
      results.transients.onset = { edgeJump: +edgeJump.toFixed(3), onsetJump: +onsetJump.toFixed(3), firstOn };
      log(`transient onset@0.5x: edgeJump ${edgeJump.toFixed(3)} (起播沿) onsetJump ${onsetJump.toFixed(3)} (稳态参考 ~0.41)`);
    }

    // ---- 3) 拼接瞬态: 0.5x 播放中 seekWhilePlaying x2 + setRate(0.75) 无缝变速 ----
    {
      const rec = await evalJs(recordExpr(`
        (async () => {
          store.setRate(0.5); store.seek(500); store.play();
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          await s(500); store.seekWhilePlaying(1200);
          await s(500); store.seekWhilePlaying(2000);
          await s(500); store.setRate(0.75); // v385: 同引擎无缝重锚定
          await s(200);
        })();
      `, 2600));
      const pcm = decode(rec.pcm);
      const g = glitchScanAdaptive(pcm, rec.sr);
      results.transients.splice = { jumps: g.jumps, maxJump: +g.maxJump.toFixed(3), jumpAt: g.jumpAt, zeroRuns: g.zeroRuns, maxZeroRun: g.maxZeroRun, dips: g.dips };
      log(`transient splice: jumps ${g.jumps} maxJump ${g.maxJump.toFixed(3)} at ${JSON.stringify(g.jumpAt)} zeroRuns ${g.zeroRuns} maxZeroRun ${g.maxZeroRun} dips ${g.dips}`);
    }

    ws.close();
  } catch (e) {
    results.error = String(e).slice(0, 600);
    log('MEASURE ERROR:', results.error);
  } finally {
    await killIsolated(electron, profile);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = await runTempoMeasurements();
  console.log(JSON.stringify({ env: r.env, transients: r.transients }, null, 1));
}

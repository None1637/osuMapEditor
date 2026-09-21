// v251 探针5: AudioWorklet 原始采样抓取 hit 总线, Node 端 Goertzel 离线算 16-20k 能量
// 排除 AnalyserNode  smoothing/FFT 实现差异 — 判定降质是真实信号差异还是测量伪影
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9441;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const electron = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

// Goertzel: 单频能量
function goertzel(samples, freq, sr) {
  const w = 2 * Math.PI * freq / sr;
  const cw = Math.cos(w), sw = Math.sin(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (const x of samples) {
    s0 = x + 2 * cw * s1 - s2;
    s2 = s1; s1 = s0;
  }
  const real = s1 - s2 * cw, imag = s2 * sw;
  return (real * real + imag * imag) / (samples.length * samples.length);
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuMenuCmd)').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' })`);
  for (let i = 0; i < 90; i++) {
    if (await evalJs('(window.__osuStore.audioBuffer?.duration ?? 0) > 100').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.seek(10000); s.play(); return 1; })()`);
  await sleep(300);
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); return 1; })()`);

  const cap = await evalJs(`(async () => {
    const s = window.__osuStore; const actx = s.actx;
    const code = \`class Tap extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch && ch.length) this.port.postMessage(ch.slice(0));
        return true;
      }
    } registerProcessor('tap', Tap);\`;
    await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const node = new AudioWorkletNode(actx, 'tap');
    window.__capChunks = []; window.__capping = false;
    node.port.onmessage = (e) => { if (window.__capping) window.__capChunks.push(e.data); };
    s.ensureHitBus().connect(node);
    node.connect(actx.destination); // 无输出写盘 = 静音, 仅保持拉流
    return { ok: true, sr: actx.sampleRate };
  })()`);
  console.log('capture:', JSON.stringify(cap));

  const MEAS = `(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < 61000) await new Promise(r => setTimeout(r, 30));
    window.__capChunks = []; window.__capping = true;
    window.__diag = { busGainAtStart: s.hitBus.gain.value, voicesAtStart: s.allHitVoices.size, gainSamples: [] };
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      await new Promise(r => setTimeout(r, 50));
      // 每 250ms 抽一个发声中 voice 的 gain 瞬时值
      if (window.__diag.gainSamples.length < 12 && (performance.now() - t0) % 250 < 60) {
        const v = [...s.allHitVoices][0];
        if (v) window.__diag.gainSamples.push(+v.gain.gain.value.toFixed(3));
      }
    }
    window.__capping = false;
    window.__diag.voicesAtEnd = s.allHitVoices.size;
    window.__diag.busGainAtEnd = s.hitBus.gain.value;
    // 拼成单 Float32Array -> base64 分块传出
    const chunks = window.__capChunks;
    let n = 0; for (const c of chunks) n += c.length;
    const all = new Float32Array(n);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const u8 = new Uint8Array(all.buffer);
    let bin = '';
    const STEP = 32768;
    for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
    return { b64: btoa(bin), n };
  })()`;

  const runs = [];
  for (const mode of ['pass1', 'pass2']) {
    await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(60000); s.play(); return 1; })()`);
    await sleep(200);
    if (mode === 'pass2') {
      await evalJs(`(async () => {
        const s = window.__osuStore;
        while (s.positionMs() < 61000) await new Promise(r => setTimeout(r, 30));
        for (let i = 0; i < 60 && s.positionMs() > 60100; i++) {
          s.wheelSeek(-120, 0);
          await new Promise(r => setTimeout(r, 60));
        }
        for (let i = 0; i < 20 && s.positionMs() < 59900; i++) {
          s.wheelSeek(120, 0);
          await new Promise(r => setTimeout(r, 60));
        }
        return 1;
      })()`);
    }
    const r = await evalJs(MEAS);
    console.log(mode, '诊断:', JSON.stringify(await evalJs('window.__diag')));
    const u8 = Buffer.from(r.b64, 'base64');
    const f32 = new Float32Array(u8.buffer, u8.byteOffset, u8.length / 4);
    // 存 WAV (32-bit float, 48k mono)
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + u8.length, 4); hdr.write('WAVE', 8);
    hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(48000, 24); hdr.writeUInt32LE(48000 * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(32, 34);
    hdr.write('data', 36); hdr.writeUInt32LE(u8.length, 40);
    fs.writeFileSync('verifier/v251/' + mode + '.wav', Buffer.concat([hdr, u8]));
    runs.push(f32);
    console.log(`${mode}: 采样 ${r.n}`);
  }

  const [a, b] = runs;
  let rmsA = 0, rmsB = 0;
  for (let i = 0; i < a.length; i++) rmsA += a[i] * a[i];
  for (let i = 0; i < b.length; i++) rmsB += b[i] * b[i];
  console.log('RMS:', Math.sqrt(rmsA / a.length).toFixed(5), 'vs', Math.sqrt(rmsB / b.length).toFixed(5));
  for (const f of [2000, 8000, 12000, 16000, 17000, 18000, 19000, 20000]) {
    const ea = goertzel(a, f, 48000), eb = goertzel(b, f, 48000);
    const db = 10 * Math.log10((eb + 1e-18) / (ea + 1e-18));
    console.log(`${f}Hz: ${db >= 0 ? '+' : ''}${db.toFixed(2)}dB`);
  }
  await evalJs('window.__osuStore.pause()');
} finally {
  try { electron.kill(); } catch { }
  await sleep(800);
}
process.exit(0);

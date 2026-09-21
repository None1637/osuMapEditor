// v251 探针7: 最小复现 — AudioBufferSourceNode.start(when) 的 when 非采样整数时是否被低通
// 三组: A=when 采样对齐(参考); B=when +0.5 采样; C=when 对齐但 offset +0.5 采样
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9443;
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
try {
  await send('Runtime.enable');
  const res = await evalJs(`(async () => {
    const actx = new AudioContext();
    await actx.resume();
    const sr = actx.sampleRate;
    // 白噪声 burst 0.2s
    const buf = actx.createBuffer(1, sr * 0.2, sr);
    const d = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x40000000 - 1); }
    // worklet 采集 destination 不可 tap, 改走: src -> gain -> worklet tap -> destination
    const code = \`class Tap extends AudioWorkletProcessor {
      process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch && ch.length) this.port.postMessage(ch.slice(0)); return true; }
    } registerProcessor('tap', Tap);\`;
    await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const tap = new AudioWorkletNode(actx, 'tap');
    const g = actx.createGain();
    g.connect(tap); tap.connect(actx.destination);

    const half = 0.5 / sr;
    const runCase = async (fracWhen, fracOffset) => {
      const chunks = [];
      tap.port.onmessage = (e) => chunks.push(e.data);
      const now = actx.currentTime;
      // when 对齐到采样整数: currentTime 是 128 量子化的(整数采样), 再加 100ms (=4800 采样)
      const whenInt = Math.round(now * sr) / sr + 0.1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(whenInt + fracWhen, fracOffset);
      await new Promise(r => setTimeout(r, 400));
      let n = 0; for (const c of chunks) n += c.length;
      const all = new Float32Array(n);
      let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      const u8 = new Uint8Array(all.buffer);
      let bin = ''; const STEP = 32768;
      for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
      return btoa(bin);
    };
    const A = await runCase(0, 0);            // 参考: 全对齐
    const B = await runCase(half, 0);         // when 偏移半采样
    const C = await runCase(0, half);         // offset 偏移半采样
    const B2 = await runCase(0.25 / sr, 0);   // when 偏移 1/4 采样
    return { sr, A, B, C, B2 };
  })()`);
  console.log('sampleRate:', res.sr);
  const decode = (b64) => {
    const u8 = Buffer.from(b64, 'base64');
    return new Float32Array(u8.buffer, u8.byteOffset, u8.length / 4);
  };
  const bands = (x, sr) => {
    // 简易 Goertzel
    const g = (f) => {
      const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
      let s0 = 0, s1 = 0, s2 = 0;
      for (const v of x) { s0 = v + 2 * cw * s1 - s2; s2 = s1; s1 = s0; }
      const re = s1 - s2 * cw, im = s2 * sw;
      return (re * re + im * im) / (x.length * x.length);
    };
    return [2000, 8000, 12000, 16000, 20000, 22000].map(f => 10 * Math.log10(g(f) + 1e-18));
  };
  const sr = res.sr;
  const ref = bands(decode(res.A), sr);
  for (const name of ['B', 'C', 'B2']) {
    const cur = bands(decode(res[name]), sr);
    console.log(name, 'vs A (dB):', cur.map((v, i) => (v - ref[i]).toFixed(1)).join(' '), ' (2k/8k/12k/16k/20k/22k)');
  }
} finally {
  try { electron.kill(); } catch { }
  await sleep(800);
}
process.exit(0);

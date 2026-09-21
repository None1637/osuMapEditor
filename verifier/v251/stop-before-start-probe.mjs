// v251 最小复现: Chromium 中 start(未来时刻) 后立即 stop() 是否仍能发声
// 运行: node verifier/v251/stop-before-start-probe.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9438;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const electron = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { /* not ready */ }
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  const r = await evalJs(`(async () => {
    const actx = new AudioContext();
    await actx.resume();
    // 1s 白噪声 buffer
    const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // analyser 监测 destination 是否有声
    const an = actx.createAnalyser(); an.fftSize = 2048;
    const dest = actx.destination;
    // 无法 tap destination, 改为: source -> gain -> analyser -> destination
    const g = actx.createGain();
    g.connect(an); an.connect(dest);
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    const t0 = actx.currentTime;
    const startAt = t0 + 1.5; // 未来 1.5s 发声 (留足 eval/sleep 开销)
    src.start(startAt);
    let endedAt = null;
    src.addEventListener('ended', () => { endedAt = actx.currentTime; });
    await new Promise(r => setTimeout(r, 100)); // 距 start 还很远时 stop
    let stopThrew = false;
    try { src.stop(); } catch { stopThrew = true; }
    const stopAt = actx.currentTime;
    // 监测到 startAt+1s 之后, 看是否发声
    const td = new Float32Array(an.fftSize);
    let maxAfter = -Infinity;
    while (actx.currentTime < startAt + 1.0) {
      await new Promise(r => setTimeout(r, 50));
      an.getFloatTimeDomainData(td);
      for (const v of td) maxAfter = Math.max(maxAfter, Math.abs(v));
    }
    return { stopThrew, stopAt: +stopAt.toFixed(3), startAt: +startAt.toFixed(3),
      endedAt: endedAt === null ? null : +endedAt.toFixed(3), maxAbsAfterStop: +maxAfter.toFixed(4) };
  })()`);
  console.log(JSON.stringify(r));
  // 判读: maxAbsAfterStop ~0 => stop 生效; 明显 >0 (白噪声峰值 ~1) => 未来 voice 仍在发声
  console.log(r.maxAbsAfterStop < 0.01 ? 'STOP_WORKS' : 'STOP_IGNORED (未来 voice 未被停止!)');
} finally {
  try { electron.kill(); } catch { /* noop */ }
  await sleep(800);
}
process.exit(0);

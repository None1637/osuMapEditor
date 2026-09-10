// v246 快速迭代探针: npx electron . 直起 (绕过打包壳, 杀掉即真杀), 测 cygnus 谱面帧率 + GPU feature status
// 用法: node verifier/v246/electron-npx-probe.mjs [--extra-switch=xxx] ...
//   额外参数原样透传给 electron (放在 "--" 之后), 如: node ... -- --force-high-performance-gpu
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9460;
const FOLDER = 'beatmap-639217845366573336-audio';
const FILE = 'cygnus - Book of Dark Magic (None1637) [Magic].osu';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sepIdx = process.argv.indexOf('--');
const extraSwitches = sepIdx >= 0 ? process.argv.slice(sepIdx + 1) : [];

// 直起 electron 二进制 (node_modules/electron/dist/electron.exe), 杀掉即真杀, 无包装进程残留
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const proc = spawn(electronBin, ['.', `--remote-debugging-port=${DEBUG_PORT}`, ...extraSwitches], { cwd: root, stdio: 'ignore' });
const kill = () => { try { process.kill(proc.pid); } catch { /* noop */ } };
process.on('exit', kill);

// ---- 浏览器级会话: 查 GPU feature status ----
async function browserWs() {
  const ver = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pend.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); kill(); process.exit(2); }
console.log('page:', target.url);

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

const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const deltas = [], busy = [];
  const ch = new MessageChannel();
  let frameStart = 0, last = 0;
  ch.port1.onmessage = () => { busy.push(performance.now() - frameStart); };
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts; frameStart = performance.now();
    ch.port2.postMessage(0);
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const s = a => [...a].sort((x, y) => x - y);
      const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
      const avg = a => a.length ? a.reduce((v, s2) => v + s2, 0) / a.length : 0;
      const pr = window.__perfRender || [];
      resolve({ frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1),
        frameP95: +q(s(deltas), 0.95).toFixed(2),
        busyAvg: +avg(busy).toFixed(2), busyP95: +q(s(busy), 0.95).toFixed(2) });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!window.__osuMenuCmd').catch(() => false)) break;
    await sleep(500);
  }

  // 环境信息
  const env = await evalJs(`(() => ({
    dpr: window.devicePixelRatio, win: window.innerWidth + 'x' + window.innerHeight,
    vis: document.visibilityState, hasFocus: document.hasFocus(),
  }))()`);
  console.log('env:', JSON.stringify(env), 'extraSwitches:', extraSwitches.join(' ') || '(none)');

  // GPU feature status (浏览器级 SystemInfo.getInfo)
  try {
    const b = await browserWs();
    const gi = await b.send('SystemInfo.getInfo');
    const g = gi.result?.gpu;
    if (g) {
      const fs2 = g.featureStatus?.featureStatus ?? {};
      console.log('gpu:', g.devices?.[0]?.deviceString ?? '?');
      for (const k of ['canvas_2d', 'compositing', 'rasterization', 'webgl', 'webgl2', 'video_decode']) {
        if (fs2[k]) console.log('  feature.' + k + ':', fs2[k]);
      }
    } else console.log('gpu: (no result)', JSON.stringify(gi).slice(0, 300));
    b.ws.close();
  } catch (e) { console.log('gpu-info-fail:', String(e).slice(0, 200)); }

  console.log('== 打开谱面');
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: ${JSON.stringify(FOLDER)}, file: ${JSON.stringify(FILE)} })
    .then(() => !!window.__osuStore.beatmap).catch(e => 'ERR ' + e)`);
  console.log('  opened:', opened);
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }

  console.log('== 静止 (seek 到物件密集处)');
  await evalJs(`(() => { const s = window.__osuStore; s.pause();
    const ts = s.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b);
    s.seek(ts[Math.floor(ts.length/2)]); return 1; })()`);
  await sleep(1200);
  console.log('  静止:', JSON.stringify(await evalJs(MEASURE_JS(3000))));

  console.log('== 播放');
  await evalJs('window.__osuStore.play()');
  await sleep(500);
  console.log('  播放:', JSON.stringify(await evalJs(MEASURE_JS(4000))));
  await evalJs('window.__osuStore.pause()');
} finally {
  kill();
}
process.exit(0);

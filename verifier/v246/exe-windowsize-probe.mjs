// v246 探针: exe 窗口大小 vs rAF 频率 — 最大化 vs 小窗口, 判定是否窗口呈现(合成)带宽瓶颈
// 用法: node verifier/v246/exe-windowsize-probe.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const DEBUG_PORT = 9444;
const FOLDER = 'beatmap-639217845366573336-audio';
const FILE = 'cygnus - Book of Dark Magic (None1637) [Magic].osu';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const exe = spawn(EXE, [`--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
const RAF_MEASURE = `(async () => new Promise(resolve => {
  const deltas = []; let last = 0; const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    else {
      const s = [...deltas].sort((a, b) => a - b);
      resolve({ fps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1),
        p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
        win: window.innerWidth + 'x' + window.innerHeight });
    }
  };
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__osuMenuCmd').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: ${JSON.stringify(FOLDER)}, file: ${JSON.stringify(FILE)} }).then(() => 1).catch(() => 0)`);
  await sleep(1200);
  await evalJs(`(() => { const s = window.__osuStore; const ts = s.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b); s.seek(ts[Math.floor(ts.length/2)]); return 1; })()`);
  await sleep(800);

  console.log('最大化:', JSON.stringify(await evalJs(RAF_MEASURE)));

  // 窗口控制要走浏览器级会话 (flat mode)
  const bver = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  const bws = new WebSocket(bver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
  let bId = 0;
  const bPending = new Map();
  bws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && bPending.has(m.id)) { bPending.get(m.id)(m); bPending.delete(m.id); }
  };
  const bSend = (method, params = {}, sessionId) => {
    const id = ++bId;
    return new Promise((resolve) => { bPending.set(id, resolve); bws.send(JSON.stringify({ id, method, params, sessionId })); });
  };
  const at = await bSend('Target.attachToTarget', { targetId: target.id, flatten: true });
  const sessionId = at.result.sessionId;
  const winInfo = await bSend('Browser.getWindowForTarget', {}, sessionId);
  const wid = winInfo.result.windowId;
  console.log('window bounds:', JSON.stringify(winInfo.result.bounds));
  const setBounds = (bounds) => bSend('Browser.setWindowBounds', { windowId: wid, bounds }, sessionId);
  await setBounds({ windowState: 'normal' });
  await setBounds({ left: 100, top: 60, width: 1280, height: 800 });
  await sleep(1200);
  console.log('1280x800:', JSON.stringify(await evalJs(RAF_MEASURE)));

  await setBounds({ left: 100, top: 60, width: 800, height: 500 });
  await sleep(1200);
  console.log('800x500:', JSON.stringify(await evalJs(RAF_MEASURE)));

  await setBounds({ windowState: 'maximized' });
  await sleep(1200);
  console.log('恢复最大化:', JSON.stringify(await evalJs(RAF_MEASURE)));
} finally {
  try { exe.kill(); } catch { /* noop */ }
}
process.exit(0);

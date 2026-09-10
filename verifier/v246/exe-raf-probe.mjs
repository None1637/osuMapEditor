// v246 探针: exe 窗口里空白页 vs 编辑器页的 rAF 频率对比 — 分辨 "窗口环境/vsync" 与 "页面渲染成本"
// 用法: node verifier/v246/exe-raf-probe.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const DEBUG_PORT = 9443;
const FOLDER = 'beatmap-639217845366573336-audio';
const FILE = 'cygnus - Book of Dark Magic (None1637) [Magic].osu';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const exe = spawn(EXE, [`--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore' });

async function connectTo(urlFilter) {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const t = targets.find(x => x.type === 'page' && urlFilter(x.url));
      if (t) return t;
    } catch { /* not ready */ }
    await sleep(500);
  }
  return null;
}

const mk = async (ws) => {
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const id = ++msgId;
    return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  return { send, evalJs };
};

const RAF_MEASURE = `(async () => new Promise(resolve => {
  const deltas = []; let last = 0; const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    else {
      const s = [...deltas].sort((a, b) => a - b);
      resolve({ fps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1),
        p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) });
    }
  };
  requestAnimationFrame(tick);
}))()`;

try {
  const appTarget = await connectTo(u => u.includes('127.0.0.1'));
  if (!appTarget) { console.error('APP_NOT_FOUND'); process.exit(2); }
  const app = await mk(new WebSocket(appTarget.webSocketDebuggerUrl));
  await new Promise((res, rej) => { app.send('Runtime.enable').then(res, rej); });
  await app.send('Page.enable');
  await app.send('Page.bringToFront');

  // 1) 编辑器页 (曲库界面) rAF
  console.log('exe 曲库界面 rAF:', JSON.stringify(await app.evalJs(RAF_MEASURE)));

  // 2) 打开用户谱面进编辑器, 播放态 rAF
  for (let i = 0; i < 40; i++) {
    if (await app.evalJs('!!window.__osuMenuCmd').catch(() => false)) break;
    await sleep(500);
  }
  await app.evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: ${JSON.stringify(FOLDER)}, file: ${JSON.stringify(FILE)} }).then(() => 1).catch(() => 0)`);
  await sleep(1000);
  await app.evalJs(`(() => { const s = window.__osuStore; const ts = s.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b); s.seek(ts[Math.floor(ts.length/2)]); return 1; })()`);
  await sleep(800);
  console.log('exe 编辑器静止 rAF:', JSON.stringify(await app.evalJs(RAF_MEASURE)));

  // 3) 同一 exe 里开 about:blank 窗口 (Target.createTarget), 空白页 rAF
  const ver = await app.send('Target.createTarget', { url: 'about:blank' });
  const blankId = ver.result?.targetId;
  let blankMeas = 'createTarget 不支持';
  if (blankId) {
    for (let i = 0; i < 20; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const bt = targets.find(x => x.id === blankId);
      if (bt) {
        const blank = await mk(new WebSocket(bt.webSocketDebuggerUrl));
        await new Promise((res, rej) => { blank.send('Runtime.enable').then(res, rej); });
        await blank.send('Page.enable');
        await blank.send('Page.bringToFront');
        blankMeas = JSON.stringify(await blank.evalJs(RAF_MEASURE));
        break;
      }
      await sleep(300);
    }
  }
  console.log('exe 空白页(前台) rAF:', blankMeas);
  // 回前台到编辑器再测一次 (排除前台/后台差异)
  await app.send('Page.bringToFront');
  console.log('exe 编辑器静止 rAF (回前台复测):', JSON.stringify(await app.evalJs(RAF_MEASURE)));
} finally {
  try { exe.kill(); } catch { /* noop */ }
}
process.exit(0);

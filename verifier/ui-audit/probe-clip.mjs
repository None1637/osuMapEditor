// v430 一次性探针: 1280×720 (Emulation) 下底栏被 zoom 根容器裁切的几何来源
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9498;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  for (const mode of ['none', 'all']) {
    const r = await evalJs(`(() => {
      const store = window.__osuStore;
      if ('${mode}' === 'all') store.select(store.beatmap.hitObjects.map(o => o.id)); else store.select([]);
      return new Promise(res => setTimeout(() => {
        const zr = document.querySelector('.ui-zoom-root').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.ui-zoom-root > *')].map(el => {
          const b = el.getBoundingClientRect();
          return el.tagName + '.' + String(el.className).slice(0, 36) + ' ' + b.top.toFixed(0) + '..' + b.bottom.toFixed(0) + ' h=' + b.height.toFixed(0);
        });
        const sp = document.querySelector('[data-speed-input="1"]');
        const spr = sp ? sp.getBoundingClientRect() : null;
        res({ iw: innerWidth, ih: innerHeight, zr: [zr.top, zr.bottom], rows,
          speed1: spr ? [spr.top.toFixed(0), spr.bottom.toFixed(0)] : null });
      }, 500));
    })()`);
    console.log(`-- ${mode}:`, JSON.stringify(r, null, 1));
  }
  ws.close();
} finally {
  await killIsolated(electron, profile);
}

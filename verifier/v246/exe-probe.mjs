// v246 exe 环境探针: 启动打包 exe (Electron) 并查其 WebGL renderer / 帧率 — 对比 headless Edge
// 用法: node verifier/v246/exe-probe.mjs [--measure]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const DEBUG_PORT = 9440;
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
if (!target) { console.error('EXE_CONNECT_FAILED'); process.exit(2); }
console.log('page:', target.url);
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  const gpu = await evalJs(`(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl');
    if (!gl) return 'NO_WEBGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })()`);
  console.log('EXE_GPU_RENDERER:', gpu);
  console.log('devicePixelRatio:', await evalJs('window.devicePixelRatio'));
  console.log('innerSize:', await evalJs('window.innerWidth + "x" + window.innerHeight'));

  // 等 app 就绪 (曲库或编辑器)
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__osuStore').catch(() => false)) break;
    await sleep(500);
  }
  const hasStore = await evalJs('!!window.__osuStore');
  console.log('__osuStore:', hasStore);

  if (process.argv.includes('--measure') && hasStore) {
    // 直接经 local-fs API 读用户给的谱面并载入 (exe 内嵌同一 /api/local-fs)
    const mapPath = 'F:\\\\Backup\\\\D\\\\osu!\\\\Songs\\\\beatmap-639217845366573336-audio\\\\cygnus - Book of Dark Magic (None1637) [Magic].osu';
    const loadRes = await evalJs(`(async () => {
      // 曲库界面 → 扫描后点选太绕; 直接用文本解析: 找页面暴露的解析入口
      const store = window.__osuStore;
      if (!store) return 'NO_STORE';
      return { hasLoad: typeof store.load, playing: store.playing, hasBm: !!store.beatmap };
    })()`);
    console.log('store:', JSON.stringify(loadRes));
    // 测当前界面帧率 (曲库/编辑器裸界面)
    const fps = await evalJs(`(async () => new Promise(resolve => {
      const deltas = []; let last = 0; const t0 = performance.now();
      const tick = (ts) => {
        if (last) deltas.push(ts - last);
        last = ts;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        else resolve({ fps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1),
          p95: +[...deltas].sort((a,b)=>a-b)[Math.floor(deltas.length*0.95)].toFixed(2) });
      };
      requestAnimationFrame(tick);
    }))()`);
    console.log('EXE_FPS(当前界面):', JSON.stringify(fps));
  }
} finally {
  try { exe.kill(); } catch { /* noop */ }
}
process.exit(0);

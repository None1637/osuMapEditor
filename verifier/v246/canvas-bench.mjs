// v246 canvas 微基准: 同一段 canvas 压力代码分别在 exe (Electron) 与 headless Edge 里跑, 对比光栅吞吐
// 用法: node verifier/v246/canvas-bench.mjs          — exe
//       node verifier/v246/canvas-bench.mjs --edge   — headless Edge
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const DEBUG_PORT = 9442;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const useEdge = process.argv.includes('--edge');

let proc, profile = null;
if (useEdge) {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-bench-'));
  proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=2560,1511', 'about:blank'], { stdio: 'ignore' });
} else {
  proc = spawn(EXE, [`--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore' });
}

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

const BENCH = `(() => {
  const W = 2560, H = 1440;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = document.createElement('canvas'); img.width = 256; img.height = 256;
  const ig = img.getContext('2d'); ig.fillStyle = '#4af'; ig.fillRect(0, 0, 256, 256);
  const out = {};
  // 1) 全屏 fillRect ×100
  let t0 = performance.now();
  for (let i = 0; i < 100; i++) { g.fillStyle = '#112'; g.fillRect(0, 0, W, H); }
  g.getImageData(0, 0, 1, 1); // 强制 flush
  out.fillRect100 = +(performance.now() - t0).toFixed(1);
  // 2) 大幅缩放 drawImage ×200 (约 1000x1000 → 模拟缩圈 overdraw)
  t0 = performance.now();
  for (let i = 0; i < 200; i++) g.drawImage(img, (i * 7) % 1500, (i * 13) % 400, 1000, 1000);
  g.getImageData(0, 0, 1, 1);
  out.bigDrawImage200 = +(performance.now() - t0).toFixed(1);
  // 3) 同尺寸小 drawImage ×2000 (模拟物件贴图)
  t0 = performance.now();
  for (let i = 0; i < 2000; i++) g.drawImage(img, (i * 37) % 2300, (i * 53) % 1200, 128, 128);
  g.getImageData(0, 0, 1, 1);
  out.smallDrawImage2000 = +(performance.now() - t0).toFixed(1);
  return out;
})()`;

try {
  await send('Runtime.enable');
  const ver = await send('Browser.getVersion');
  console.log((useEdge ? 'EDGE' : 'EXE'), 'chromium:', ver.result?.product);
  console.log('webgl:', await evalJs(`(() => { const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'NO_WEBGL'; const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`));
  // 预热 + 正式
  await evalJs(BENCH);
  console.log('bench:', JSON.stringify(await evalJs(BENCH)));
} finally {
  try { proc.kill(); } catch { /* noop */ }
  await sleep(1200);
  if (profile) try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
process.exit(0);

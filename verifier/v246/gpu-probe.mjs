// 一次性探针: headless Edge 的 WebGL renderer (判断是否 SwiftShader 软件渲染)
import { spawn } from 'child_process';
import fs from 'fs'; import path from 'path'; import os from 'os';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gpu-'));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9436', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 30 && !target; i++) {
  try { const t = await (await fetch('http://127.0.0.1:9436/json')).json(); target = t.find(x => x.type === 'page'); } catch { /* retry */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const val = await new Promise(res => {
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) res(m.result?.result?.value); };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl');
    if (!gl) return 'NO_WEBGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })()` } }));
});
console.log('GPU_RENDERER:', val);
edge.kill(); await sleep(1000);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
process.exit(0);

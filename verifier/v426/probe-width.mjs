// v426 运行时抽测 (一次性, 非常驻验证器): 右栏视觉宽度应恒 ≈224px (布局 224/zoom × zoom)
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9477;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.error('  FAIL:', m); } else console.log('  ok:', m); };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('no target');
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
  await sleep(500);
  const r = await evalJs(`(() => {
    const el = document.querySelector('[data-ui-interactive][style]'); // 右栏 = 唯一带 inline style (width:224/zoom) 的容器
    if (!el) return { missing: true };
    const rect = el.getBoundingClientRect();
    return { visualW: rect.width, iw: window.innerWidth, ih: window.innerHeight };
  })()`);
  console.log('  probe:', JSON.stringify(r));
  assert(Math.abs(r.visualW - 224) < 2, `右栏视觉宽 ≈224 (实际 ${r.visualW?.toFixed(1)}, 窗口 ${r.iw}x${r.ih})`);
  ws.close();
} catch (e) {
  failures++;
  console.error('  FAIL: 抽测异常 —', String(e).slice(0, 300));
} finally {
  await killIsolated(electron, profile);
}
console.log(failures ? 'V426_PROBE_FAILED' : 'V426_PROBE_PASSED');
process.exit(failures ? 1 : 0);

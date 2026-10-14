// v405 一次性截图: 旋转/缩放窗口 stable 式新布局 (运行: npm run build 后 node verifier/v405/cdp-shot.mjs)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9459;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { proc: electron, profile } = launchIsolatedElectron(root, DEBUG_PORT);
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到页面目标'); await killIsolated(electron, profile); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'verifier/v405', name), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}

try {
  await send('Runtime.enable');
  await normalizeEnv(evalJs);
  // 选中一个物件再开窗 (走正常路径)
  await evalJs(`(() => { const s = window.__osuStore; const o = s.beatmap.hitObjects[0]; if (o) s.select([o.id]); })()`);
  await evalJs('window.__osuStore.openTransformDialog("rotate")');
  await sleep(600);
  await shot('rotate.png');
  await evalJs('window.__osuStore.closeTransformDialog()');
  await sleep(300);
  await evalJs('window.__osuStore.openTransformDialog("scale")');
  await sleep(600);
  await shot('scale.png');
} finally {
  await killIsolated(electron, profile);
}

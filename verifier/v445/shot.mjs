// v445: 视觉抽查 — 优化后测试游玩画面截图 (背景离屏层/HUD 数字缓存上屏是否正确)
// 运行: node verifier/v445/shot.mjs  → 写 verifier/v445/shot.png
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9462;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); await killIsolated(proc, profile); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await normalizeEnv(evalJs);
  // 应用用户真实皮肤 (皮肤数字/光标/拖尾贴图路径)
  await evalJs(`(async () => {
    const dir = { kind: 'directory', name: 'skin',
      getFileHandle: (n) => Promise.resolve({ kind: 'file', name: n, getFile: async () => {
        const res = await fetch('api/local-fs/file?root=skin&rel=' + encodeURIComponent(n));
        if (!res.ok) throw new Error('nf ' + n);
        return new File([await res.blob()], n);
      } }) };
    await window.__osuSkin.applySkinFromDir(dir, 'user-skin'); return 1;
  })()`);
  await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).catch(() => {})`);
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(31900);
    localStorage.setItem('osu-editor:testplay-mods', '["AT"]'); return 1; })()`);
  await sleep(300);
  await evalJs(`document.querySelector('[data-testplay-btn]').click()`);
  await sleep(6000); // 进入密集段中段 (爆炸/弹出/皮肤数字/背景全在画面上)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'verifier/v445/shot.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('shot.png written');
} finally {
  await killIsolated(proc, profile);
}
process.exit(0);

// 一次性实验: 验证当前页面环境里 IndexedDB 能否跨刷新持久化 FileSystemDirectoryHandle
// 步骤: 1) 读现有 settings 全部 key  2) 写入 OPFS 句柄  3) 刷新页面  4) 读回并检查类型
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9345;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-idb-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

let target = await getTarget();
let ws = new WebSocket(target.webSocketDebuggerUrl);
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
  if (r.result?.exceptionDetails) return 'PAGE_ERROR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500);
  return r.result?.result?.value;
}

const IDB_SNIPPET = `(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('osu-map-editor', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('settings');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const keys = await new Promise((res, rej) => {
    const req = db.transaction('settings', 'readonly').objectStore('settings').getAllKeys();
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  return JSON.stringify(keys);
})()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3000);

  console.log('1) 刷新前 settings keys:', await evalJs(IDB_SNIPPET));

  // 写入 OPFS 目录句柄 (与 showDirectoryPicker 返回值同为 FileSystemDirectoryHandle, 可结构化克隆)
  console.log('2) 写入 OPFS 句柄:', await evalJs(`(async () => {
    try {
      const h = await navigator.storage.getDirectory();
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('osu-map-editor', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('settings');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put(h, '__probe_handle__');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return 'ok, name=' + h.name;
    } catch (e) { return 'FAIL: ' + e.name + ' ' + e.message; }
  })()`));

  // 整页刷新 (模拟用户 F5)
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);

  console.log('3) 刷新后 settings keys:', await evalJs(IDB_SNIPPET));
  console.log('4) 读回句柄:', await evalJs(`(async () => {
    try {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('osu-map-editor', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('settings');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      const v = await new Promise((res, rej) => {
        const req = db.transaction('settings', 'readonly').objectStore('settings').get('__probe_handle__');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      if (!v) return 'null (无记录)';
      return 'type=' + (v.constructor?.name ?? typeof v) + ', kind=' + v.kind + ', name=' + JSON.stringify(v.name)
        + ', queryPermission=' + (typeof v.queryPermission);
    } catch (e) { return 'FAIL: ' + e.name + ' ' + e.message; }
  })()`));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

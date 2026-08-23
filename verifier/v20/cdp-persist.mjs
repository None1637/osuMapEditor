// CDP v20 端到端: 陈旧 v1 库 (无 settings store) 场景下的升级 + 句柄跨刷新恢复
// 场景 A: 预建 v1 库只含 legacy store -> 应用 openDB(v2) 应补建 settings 且不丢 legacy 数据
// 场景 B: 写入 OPFS 句柄到 songsDirHandle -> 整页刷新 -> restoreSongsDir() 应恢复出句柄
// 运行: node verifier/v20/cdp-persist.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9347;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v20-'));
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

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
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

// 预建陈旧 v1 库 (只含 legacy store, 不含 settings) — 模拟早期版本用户的浏览器
const CREATE_STALE_DB = `(async () => {
  await new Promise((res, rej) => {
    const req = indexedDB.open('osu-map-editor', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('legacy')) db.createObjectStore('legacy');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('legacy', 'readwrite');
      tx.objectStore('legacy').put('do-not-lose', 'sentinel');
      tx.oncomplete = () => { db.close(); res(null); };
      tx.onerror = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  });
  return 'stale v1 db created';
})()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3000);

  // ---- 场景 A: 陈旧库升级 ----
  console.log('== 场景 A: 陈旧 v1 库 (无 settings store) 升级');
  // 应用启动已建 v2 库, 先删掉再预建 v1 陈旧库 (模拟早期版本用户的浏览器)
  console.log('  ' + await evalJs(`(async () => {
    await new Promise((res, rej) => {
      const req = indexedDB.deleteDatabase('osu-map-editor');
      req.onsuccess = res; req.onerror = () => rej(req.error); req.onblocked = () => rej(new Error('delete blocked'));
    });
    return 'existing db deleted';
  })()`));
  console.log('  ' + await evalJs(CREATE_STALE_DB));
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
  const selfTest = await evalJs(`import('/src/osu/library.ts').then(lib => lib.idbSelfTest())`);
  assert(selfTest === 'ok', `陈旧库上 idbSelfTest = ok (实际: ${selfTest}; 修复前 NotFoundError)`);
  const dbInfo = await evalJs(`(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('osu-map-editor');
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    const out = { version: db.version, stores: [...db.objectStoreNames] };
    const sentinel = await new Promise((res, rej) => {
      const req = db.transaction('legacy', 'readonly').objectStore('legacy').get('sentinel');
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    db.close();
    return JSON.stringify({ ...out, sentinel });
  })()`);
  const di = JSON.parse(dbInfo);
  console.log('  升级后:', dbInfo);
  assert(di.version === 2 && di.stores.includes('settings'), '库升级到 v2 且含 settings store');
  assert(di.stores.includes('legacy') && di.sentinel === 'do-not-lose', '存量数据未丢失 (legacy/sentinel 仍在)');

  // ---- 场景 B: 句柄写入 -> 整页刷新 -> restoreSongsDir 恢复 ----
  console.log('== 场景 B: 句柄跨刷新恢复');
  const putRes = await evalJs(`(async () => {
    const h = await navigator.storage.getDirectory(); // 与目录选择器返回同类句柄
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('osu-map-editor', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
      };
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(h, 'songsDirHandle');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'handle stored';
  })()`);
  console.log('  ' + putRes);
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
  const restored = await evalJs(`import('/src/osu/library.ts').then(async lib => {
    const r = await lib.restoreSongsDir();
    if (!r) return 'null (' + lib.getLastRestoreReason() + ')';
    return 'kind=' + r.handle.kind + ' granted=' + r.granted;
  })`);
  console.log('  刷新后 restoreSongsDir:', restored);
  assert(restored.startsWith('kind=directory'), `刷新后能恢复目录句柄 (实际: ${restored})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V20_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V20_CDP_PASSED');

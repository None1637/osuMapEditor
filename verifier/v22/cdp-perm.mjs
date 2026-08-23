// CDP v22 端到端: 恢复"待授权"状态时授权按钮可见且可点通
// 模拟: IDB 预置 OPFS 句柄 + monkeypatch 原型 queryPermission -> 'prompt' (强制待授权)
// 运行: node verifier/v22/cdp-perm.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9351;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v22-'));
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

async function reload() {
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  // 预置: OPFS 目录句柄写入 songsDirHandle (模拟用户此前已选过目录)
  await evalJs(`(async () => {
    const h = await navigator.storage.getDirectory();
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
    return 'seeded';
  })()`);

  // 刷新 + 强制"待授权": 恢复出的句柄 queryPermission 一律报 prompt
  await reload();
  await evalJs(`FileSystemDirectoryHandle.prototype.queryPermission = async function () { return 'prompt'; };
                FileSystemDirectoryHandle.prototype.requestPermission = async function () { return 'granted'; }; 'patched'`);

  // 打开曲库面板
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'))?.click(); 'clicked'`);
  await sleep(2500);

  const state = await evalJs(`JSON.stringify((() => {
    const texts = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    const grantBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('授权访问'));
    const pickBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('选择 Songs 目录'));
    return { hasGrant: !!grantBtn, hasPick: !!pickBtn, sample: texts.filter(t => t.length < 20).slice(0, 30) };
  })())`);
  const st = JSON.parse(state);
  console.log('  面板状态: hasGrant=' + st.hasGrant + ' hasPick=' + st.hasPick);
  assert(st.hasGrant, '恢复"待授权"时授权按钮可见 (修复前 root=null 只显示选择页)');
  assert(!st.hasPick, '不再错误显示"选择 Songs 目录"页');

  // 点授权 -> 应进入列表视图 (扫描 OPFS 空目录, 权限已 mock 为 granted)
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('授权访问'))?.click(); 'grant-clicked'`);
  await sleep(2500);
  const after = await evalJs(`JSON.stringify((() => {
    const grantBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('授权访问'));
    const search = document.querySelector('input[placeholder*="搜索歌曲目录"]');
    return { hasGrant: !!grantBtn, hasList: !!search };
  })())`);
  const af = JSON.parse(after);
  console.log('  授权后: hasGrant=' + af.hasGrant + ' hasList=' + af.hasList);
  assert(!af.hasGrant && af.hasList, '点击授权后进入歌曲列表视图');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V22_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V22_CDP_PASSED');

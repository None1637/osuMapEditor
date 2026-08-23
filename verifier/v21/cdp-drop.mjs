// CDP v21 端到端: 拖拽通道持久化 — mock DataTransferItem 走 dirHandleFromDropEx -> persist -> 整页刷新 -> restore
// 运行: node verifier/v21/cdp-drop.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9349;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v21-'));
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  // 环境能力: 目标浏览器必须支持 getAsFileSystemHandle (否则拖拽持久化无从谈起)
  const caps = await evalJs(`JSON.stringify({
    proto: typeof DataTransferItem.prototype.getAsFileSystemHandle,
    picker: typeof window.showDirectoryPicker,
  })`);
  console.log('  环境能力:', caps);
  const cap = JSON.parse(caps);
  assert(cap.proto === 'function', '浏览器支持 DataTransferItem.getAsFileSystemHandle (Chrome/Edge 86+)');

  // mock 拖拽 item: getAsFileSystemHandle 返回 OPFS 目录句柄 (与真实拖拽文件夹返回同类)
  const dropRes = await evalJs(`import('/src/osu/library.ts').then(async lib => {
    const opfs = await navigator.storage.getDirectory();
    const mockItem = { kind: 'file', getAsFileSystemHandle: async () => opfs };
    const d = await lib.dirHandleFromDropEx(mockItem);
    if (!d) return 'FAIL: 返回 null';
    if (!d.native) return 'FAIL: native=null (未走 getAsFileSystemHandle 通道)';
    const ok = await lib.persistSongsDirHandle(opfs);
    lib.rememberSongsDir(d.dir, d.native);
    return 'native=' + d.native.kind + ' persist=' + (ok ? 'ok' : 'FAIL: ' + lib.getLastPersistError());
  })`);
  console.log('  拖拽+持久化:', dropRes);
  assert(dropRes === 'native=directory persist=ok', `拖拽通道拿到原生句柄并落库 (实际: ${dropRes})`);

  // 整页刷新 (模拟用户 F5): 会话记忆清零, 只能从 IndexedDB 恢复
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
  const restored = await evalJs(`import('/src/osu/library.ts').then(async lib => {
    const r = await lib.restoreSongsDir();
    if (!r) return 'null (' + lib.getLastRestoreReason() + ')';
    return 'kind=' + r.handle.kind + ' granted=' + r.granted;
  })`);
  console.log('  刷新后 restoreSongsDir:', restored);
  assert(restored.startsWith('kind=directory'), `拖拽导入的目录刷新后可恢复 (实际: ${restored})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V21_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V21_CDP_PASSED');

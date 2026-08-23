// CDP 音效排程 dump: 打开 app 播放 3 秒, 抓取 debugLog 与实际使用的采样, 排查"音效不对"
// 运行: node verifier/v14/cdp-audio-dump.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9335;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-audio-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const targets = await res.json();
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

  // 清空 debugLog -> 播放 3 秒 -> 暂停 -> dump
  await evalJs(`window.__osuStore.debugLog.length = 0`);
  await evalJs(`window.__osuStore.play()`);
  await sleep(3000);
  await evalJs(`window.__osuStore.pause()`);
  const dump = await evalJs(`JSON.stringify(window.__osuStore.debugState())`);
  const d = JSON.parse(dump);
  console.log('== 采样缓冲');
  console.log('  custom:', JSON.stringify(d.customBuffers));
  console.log('  defaults(' + d.defaultBuffers.length + '):', d.defaultBuffers.join(' '));
  console.log('  hasAudioBuffer:', d.hasAudioBuffer, ' degradedSync:', d.degradedSync, ' slideLoops:', d.slideLoopCount);
  console.log('== 排程记录 (' + d.log.length + ' 条)');
  const byUsed = {};
  for (const e of d.log) byUsed[e.used] = (byUsed[e.used] || 0) + 1;
  console.log('  按实际采样:', JSON.stringify(byUsed, null, 1));
  const miss = d.log.filter(e => e.used === 'MISS');
  console.log('  MISS 数:', miss.length, miss.slice(0, 5).map(e => e.soundId).join(' '));
  console.log('  前 20 条:', JSON.stringify(d.log.slice(0, 20)));
  console.log('== 异常:', exceptions.length, exceptions.slice(0, 3).join(' | '));

  // 存档
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v14-audio-dump.json'), JSON.stringify(d, null, 2));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

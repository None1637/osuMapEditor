// CDP 端到端: 曲库目录记忆 — 选目录→关面板→重开面板应自动恢复, 无需重选
// 运行: node verifier/v16/cdp-memory.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9337;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-mem-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', APP_URL,
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

const panelState = `JSON.stringify({
  open: !!document.querySelector('.fixed.inset-0'),
  hasChooseBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('选择 Songs 目录')),
  header: document.querySelector('.fixed.inset-0 .text-xs.text-slate-500')?.textContent ?? null,
  logs: [...document.querySelectorAll('.fixed.inset-0 .font-mono')].map(e => e.textContent),
  rowCount: document.querySelectorAll('.fixed.inset-0 div[style*="absolute"]').length,
})`;
const closePanel = `[...document.querySelectorAll('.fixed.inset-0 button')].find(b => b.textContent.trim() === '✕')?.click()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500); // 等 vite dev 编译 + React 挂载

  console.log('== 注入 mock Songs 目录 (50 个歌曲文件夹)');
  await evalJs(`(() => {
    const OSU = [
      'osu file format v14', '', '[General]', 'AudioFilename: audio.mp3', 'Mode: 0', '',
      '[Metadata]', 'Title:TestSong', 'Artist:TestArtist', 'Creator:Tester', 'Version:Insane', '',
      '[Difficulty]', 'ApproachRate:9', 'SliderMultiplier:1.4', '',
      '[TimingPoints]', '1000,500,4,1,0,80,1,0', '',
      '[HitObjects]', '256,192,5000,5,0', ''].join('\\n');
    const mkFile = (name, text) => ({ kind: 'file', name, getFile: async () => new File([text], name) });
    const mkDir = (name, children) => ({
      kind: 'directory', name,
      entries: async function* () { for (const [n, c] of Object.entries(children)) yield [n, c]; },
      getFileHandle: async (n) => {
        const c = children[n];
        if (!c || c.kind !== 'file') throw new DOMException('not found', 'NotFoundError');
        return c;
      },
    });
    const children = {};
    for (let i = 1; i <= 50; i++) children['song' + i] = mkDir(i + ' TestArtist - TestSong', {
      ['TestArtist - TestSong (Tester) [Insane].osu']: mkFile('TestArtist - TestSong (Tester) [Insane].osu', OSU),
      'audio.mp3': mkFile('audio.mp3', 'fake'),
    });
    const root = mkDir('Songs', children);
    root.queryPermission = async () => 'granted';
    root.requestPermission = async () => 'granted';
    window.showDirectoryPicker = async () => root;
    return 'injected';
  })()`);
  assert(true, 'mock 已注入');

  console.log('== 第一次打开曲库并选择目录');
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'))?.click()`);
  await sleep(600);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('选择 Songs 目录'))?.click()`);
  await sleep(2000); // 扫描 50 个目录
  let st = JSON.parse(await evalJs(panelState));
  assert(st.rowCount >= 50, `第一次选择后扫描到目录 (${st.rowCount} 行)`);
  assert(st.logs.some(l => l.includes('目录已记住') || l.includes('跨会话记忆写入失败')), '选择后显示持久化结果: ' + JSON.stringify(st.logs));
  console.log('  日志:', JSON.stringify(st.logs));

  console.log('== 关闭面板, 重新打开 (模拟用户再次点击曲库按钮)');
  await evalJs(closePanel);
  await sleep(400);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'))?.click()`);
  await sleep(2000); // 恢复 + 重扫
  st = JSON.parse(await evalJs(panelState));
  console.log('  日志:', JSON.stringify(st.logs));
  assert(!st.hasChooseBtn, '重开面板不再要求选择目录');
  assert(st.rowCount >= 50, `重开面板自动恢复并扫描 (${st.rowCount} 行)`);
  assert(st.logs.some(l => l.includes('已恢复目录') || l.includes('已从本次会话记忆恢复')), '恢复路径日志可见');

  console.log('== IDB 自检 (无头 Edge 应为 ok; 内嵌环境若 fail 则走会话记忆兜底)');
  await evalJs(closePanel);
  await sleep(300);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'))?.click()`);
  await sleep(300);
  // 直接调一次自检看环境能力
  const selftest = await evalJs(`(async () => {
    try {
      const req = indexedDB.open('__probe__', 1);
      await new Promise((res, rej) => { req.onsuccess = res; req.onerror = () => rej(req.error); });
      req.result.close(); indexedDB.deleteDatabase('__probe__');
      return 'ok';
    } catch (e) { return 'fail: ' + (e?.message ?? e); }
  })()`);
  console.log('  headless Edge IndexedDB:', selftest);
  assert(selftest === 'ok', '无头 Edge IndexedDB 可用');

  console.log('== 异常检查');
  const errs = await evalJs(`window.__errs?.length ?? 0`);
  assert(errs === 0, '无未处理异常');
} finally {
  edge.kill();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
}

if (failures) { console.error(`\nCDP_MEMORY_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nCDP_MEMORY_ALL_PASSED');

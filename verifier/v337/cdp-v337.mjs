// CDP v337 端到端: 复制文本粘贴跳转选中 — 中间夹未选中物件的场景 (用户反馈: 粘贴后选中的与复制的不一样)
// 场景: combo1 = 5 个单点 (时间 1000..1800), combo2 = 3 个单点 (2000..2400);
//   选中 c1#1, c1#3, c2#2 → copy → 校验文本 "mm:ss:fff (1,3,2) - " → 清空选区 →
//   打开跳转框粘贴 → 期望选中回到 {c1#1, c1#3, c2#2}
// 运行: node verifier/v337/cdp-v337.mjs   (需要 3000 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:3000/';
const DEBUG_PORT = 9426;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v337-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到页面目标'); process.exit(1); }
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
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // 布景: combo1 = id 1..5 (t=1000..1800), combo2 = id 6..8 (t=2000..2400)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      const mk = (id, t, nc) => ({ id, type: 'circle', x: 100 + id * 40, y: 192, time: t, hitSound: 0, newCombo: nc, comboSkip: 0 });
      s.beatmap.hitObjects = [
        mk(1, 1000, true), mk(2, 1200, false), mk(3, 1400, false), mk(4, 1600, false), mk(5, 1800, false),
        mk(6, 2000, true), mk(7, 2200, false), mk(8, 2400, false),
      ];
      s.currentTime = 1400;
      s.emit();
    })()
  `);

  // 选中 c1#1(id1), c1#3(id3), c2#2(id7) — 中间夹未选中的 id2 / id6
  await evalJs(`window.__osuStore.select([1, 3, 7]);`);
  // 捕获系统剪贴板文本
  await evalJs(`window.__copied = ''; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); };`);
  await evalJs(`window.__osuStore.copy();`);
  await sleep(200);
  const copied = await evalJs('window.__copied');
  console.log('  复制文本:', JSON.stringify(copied));
  assert(copied === '00:01:000 (1,3,2) - ', `复制文本 = "00:01:000 (1,3,2) - " (lazer/stable 同款)`);

  // 清空选区, 打开跳转框粘贴
  await evalJs(`window.__osuStore.select([]);`);
  await evalJs(`document.querySelector('[data-jump-open]').click();`);
  await sleep(200);
  await evalJs(`
    (() => {
      const input = document.querySelector('[data-jump-input]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, window.__copied);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(100);
  await evalJs(`document.querySelector('[data-jump-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await sleep(300);
  const st = JSON.parse(await evalJs(`JSON.stringify({ sel: [...window.__osuStore.selected].sort((a,b)=>a-b), t: window.__osuStore.currentTime })`));
  assert(JSON.stringify(st.sel) === JSON.stringify([1, 3, 7]), `粘贴后选中 = 复制的物件 (实际 ${JSON.stringify(st.sel)})`);
  assert(Math.abs(st.t - 1000) <= 1, `跳转到起始时间点 (实际 ${st.t})`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  edge.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 句柄未释放时忽略 */ }
}

console.log(failures ? `\n${failures} 个断言失败` : '\ncdp-v337 全部通过');
process.exit(failures ? 1 : 0);

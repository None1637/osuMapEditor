// CDP v92 端到端: 收藏到当前选中分类 + 快捷键提示
// A) 新建分类 G1 并切换 => 收藏 => pattern 归 G1
// B) 切回未分类 => 收藏 => 归未分类
// C) 快捷键提示: 含「Ctrl+G 反转选区」, 不含「Ctrl+G 旋转90°」
// 运行: node verifier/v92/cdp-v92.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v92-'));
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
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // 布景: 120BPM, 两个单点, 清空 pattern 库
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'circle', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 2, type: 'circle', x: 164, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.seek(1000);
      s.select([1, 2]);
      s.loadPatternsIfNeeded();
      s.patterns = []; s.patternGroups = [];
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);
  await evalJs(`document.querySelector('[data-pattern-input="panel-toggle"]').click(); "ok"`);
  await sleep(400);

  console.log('== A) 新建分类 G1 并切换 => 收藏归 G1');
  {
    await evalJs(`
      (() => {
        const el = document.querySelector('[data-pattern-input="new-group"]');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(el, 'G1'); el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()
    `);
    await sleep(150);
    await evalJs(`document.querySelector('[data-pattern-input="add-group"]').click(); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-pattern-group="G1"]').click(); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
    await sleep(300);
    const g = await evalJs(`window.__osuStore.patterns[0]?.group ?? null`);
    assert(g === 'G1', `收藏到当前分类 (实际 ${g})`);
  }

  console.log('== B) 切回未分类 => 收藏归未分类');
  {
    await evalJs(`document.querySelector('[data-pattern-group="未分类"]').click(); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
    await sleep(300);
    const g = await evalJs(`window.__osuStore.patterns[1]?.group ?? null`);
    assert(g === '未分类', `未分类下收藏归未分类 (实际 ${g})`);
  }

  console.log('== C) 快捷键提示文本');
  {
    const txt = await evalJs(`document.body.innerText`);
    assert(txt.includes('Ctrl+G 反转选区'), '含「Ctrl+G 反转选区」');
    assert(!txt.includes('Ctrl+G 旋转'), '不含旧提示「Ctrl+G 旋转」');
    assert(txt.includes('Ctrl+,/. 旋转90°'), '含「Ctrl+,/. 旋转90°」');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V92_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V92_CDP_PASSED');

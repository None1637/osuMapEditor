// CDP v42 端到端: 按数量模式时间吸附节拍网格 (UI)
// 运行: node verifier/v42/cdp-v42.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9374;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v42-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 布景: 合成 timing (单红线 1000/500, SM=1) -> len 200 单程 1000ms
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.hitObjects = [
        { id: 96700, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
      ];
      s.select([96700]);
      s.seek(1500);
      localStorage.removeItem('osu-editor:conv:stream');
      s.emit();
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify(p.objects.map(o => [o.x, o.y, o.time])) : 'null';
      };
      window.__setSpacing = (v) => {
        const sel = document.querySelector('[data-conv="spacing"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, String(v));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__setCount = (v) => {
        const inp = document.querySelector('[data-conv="count"]');
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, String(v));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.blur();
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  // ---- A) 按数量模式也显示间距 (拍) 下拉框 ----
  console.log('== A) count 模式显示间距下拉框 + 网格提示');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  await evalJs(`document.querySelector('[data-conv="mode-count"]').click(); 'ok'`);
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv="spacing"]')`), 'count 模式下间距 (拍) 下拉框仍显示');
  assert(await evalJs(`[...document.querySelectorAll('[data-dialog="stream"] span')].some(s => s.textContent === '时间对齐网格')`),
    '显示「时间对齐网格」提示');

  // ---- B) count=6 @1/2 -> 6 点 head+i*250 (末点超滑条尾) ----
  console.log('== B) count 模式时间网格 (v43)');
  await evalJs(`window.__setSpacing(0.5); window.__setCount(6); 'ok'`);
  await sleep(400);
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.map(o => o[2]).join(',') === '2000,2250,2500,2750,3000,3250',
    `count=6 @1/2 -> 6 点 (末点 3250 超滑条尾仍生成) (${prev.map(o => o[2]).join(',')})`);
  assert(prev.map(o => o[0]).join(',') === '100,140,180,220,260,300',
    `位置按数量均布, 超尾点不堆在路径尾 (${prev.map(o => o[0]).join(',')})`);
  // 网格改 1/4 -> 6 点全部在 125 网格
  await evalJs(`window.__setSpacing(0.25); 'ok'`);
  await sleep(400);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.length === 6 && prev.every(o => (o[2] - 1000) % 125 === 0),
    `count=6 @1/4 -> 6 点全部在 1/4 网格 (${prev.map(o => o[2]).join(',')})`);
  // 网格改 1/1 -> 6 点 head+i*500
  await evalJs(`window.__setSpacing(1); 'ok'`);
  await sleep(400);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.map(o => o[2]).join(',') === '2000,2500,3000,3500,4000,4500',
    `count=6 @1/1 -> 6 点 (${prev.map(o => o[2]).join(',')})`);
  // 应用: 生成物时间全部对齐
  await evalJs(`window.__setSpacing(0.5); 'ok'`);
  await sleep(300);
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(400);
  const applied = await evalJs(`JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.type, o.time]))`);
  const circles = JSON.parse(applied).filter(o => o[0] === 'circle');
  assert(circles.length === 6 && circles.every(c => (c[1] - 1000) % 250 === 0),
    `应用: 6 个单点全部对齐 1/2 网格 (${applied})`);
  assert(JSON.parse(applied).every(o => o[0] === 'circle'), '源滑条已替换');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V42_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V42_CDP_PASSED');

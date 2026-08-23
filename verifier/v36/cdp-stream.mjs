// CDP v36 端到端: F1 滑条转连打 — 参数窗口/实时预览/应用/undo/参数持久化
//   (v43: 按数量模式时间 = head + i*div 吸附网格, 位置按数量均布; count=5 @1/2 -> 2000..3000)
//   A) 打开窗口 -> 预览出现 (源滑条隐藏, 单点生成); 改参数 -> 预览实时变化
//   B) 应用 -> 滑条被 5 个单点替换 (位置/时间/hitsound 正确), 选中结果, 窗口关闭; undo 还原
//   C) 变距曲线 (线性 100->50%) -> 间距前疏后密
//   D) 参数持久化: localStorage 记录, 重开窗口恢复上次值
//   E) 取消 -> 谱面不变, 预览清除
// 运行: node verifier/v36/cdp-stream.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9362;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v36-'));
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
const setNum = (testid, v) => `(() => {
  const inp = document.querySelector('[data-conv="${testid}"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '${v}');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
})(); 'ok'`;
const setSel = (testid, v) => `(() => {
  const el = document.querySelector('[data-conv="${testid}"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, '${v}');
  el.dispatchEvent(new Event('change', { bubbles: true }));
})(); 'ok'`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  // demo 红线 1000/500, sm 默认 -> vel = 0.2*sm; 取页面实际 sm 计算期望
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96100, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 10, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200, hitSampleRaw: '1:2:0:80:' },
        { id: 96101, type: 'circle', x: 400, y: 300, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([96100, 96101]);
      s.seek(1500);
      window.__objs = () => JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.id, o.type, o.x, o.y, o.time]));
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify({ hide: p.hideIds, n: p.objects.length, objs: p.objects.map(o => [o.x, o.time]) }) : 'null';
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  // ---- A) 打开窗口 + 实时预览 ----
  console.log('== A) 打开窗口 + 实时预览');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  assert(await evalJs(`!!document.querySelector('[data-dialog="stream"]')`), '参数窗口出现');
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.hide.includes(96100) && prev.n > 0, `预览: 源滑条隐藏 + ${prev.n} 个单点`);
  // 改数量模式 count=5 -> v42 起按 1/2 网格吸附: rels 0,178.6,357.1,535.7,714.3 -> 0,250,500 -> 3 点
  await evalJs(`document.querySelector('[data-conv="mode-count"]').click(); 'ok'`);
  await sleep(200);
  await evalJs(setNum('count', 5));
  await sleep(300);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.n === 5, `改参数后预览实时变 5 点 (实际 ${prev.n})`);
  assert(prev.objs[0][0] === 100 && prev.objs[4][0] === 300 && prev.objs[4][1] === 3000,
    `预览首尾位置/时间 head+i*250 (${prev.objs[0]} .. ${prev.objs[4]})`);

  // ---- B) 应用 + undo ----
  console.log('== B) 应用 + undo');
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(300);
  let objs = JSON.parse(await evalJs('window.__objs()'));
  const circles = objs.filter(o => o[1] === 'circle' && o[0] !== 96101);
  assert(!objs.some(o => o[0] === 96100), '源滑条已删除');
  assert(objs.some(o => o[0] === 96101), '未选中的物件保留');
  assert(circles.length === 5, `生成 5 个单点 (实际 ${circles.length})`);
  assert(circles[0][2] === 100 && circles[0][4] === 2000 && circles[4][2] === 300 && circles[4][4] === 3000,
    '首/尾单点位置时间正确');
  assert((await evalJs('window.__prev()')) === 'null', '应用后预览清除');
  assert(await evalJs(`!document.querySelector('[data-dialog="stream"]')`), '应用后窗口关闭');
  const selN = await evalJs('window.__osuStore.selected.size');
  assert(selN === 5, `应用后选中 5 个结果 (实际 ${selN})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(objs.some(o => o[0] === 96100) && objs.filter(o => o[1] === 'circle' && o[0] !== 96101).length === 0, 'undo 还原滑条');

  // ---- C) 变距曲线 (v41/v42 语义: 时间吸附网格后等距, 曲线只改空间分布) ----
  console.log('== C) 变距 (线性 100->50%): 时间等距 + 空间前疏后密');
  await evalJs(`window.__osuStore.select([96100, 96101]); 'ok'`); // undo 后选中集是失效 id, 需重选
  await sleep(200);
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(300);
  await evalJs(setSel('curve', 'linear'));
  await sleep(200);
  prev = JSON.parse(await evalJs('window.__prev()'));
  const times = prev.objs.map(o => o[1]);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const xs = prev.objs.map(o => o[0]);
  const xgaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert(times.join(',') === '2000,2250,2500,2750,3000', `时间 head+i*250 等距 (${times.join(',')})`);
  assert(xgaps.every((g, i) => i === 0 || g < xgaps[i - 1]), `空间间距前疏后密严格递减 (${xgaps.join(',')})`);
  assert(xs[xs.length - 1] === 300, `变距末点在路径尾 (x=${xs[xs.length - 1]})`);

  // ---- D) 参数持久化 ----
  console.log('== D) 参数持久化');
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(300);
  const saved = await evalJs(`localStorage.getItem('osu-editor:conv:stream')`);
  assert(saved && JSON.parse(saved).curve === 'linear' && JSON.parse(saved).count === 5, `localStorage 记录参数 (${saved})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  await evalJs(`window.__osuStore.select([96100, 96101]); 'ok'`);
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(300);
  const curveVal = await evalJs(`document.querySelector('[data-conv="curve"]').value`);
  const countVal = await evalJs(`document.querySelector('[data-conv="count"]').value`);
  assert(curveVal === 'linear' && countVal === '5', `重开窗口恢复上次参数 (curve=${curveVal}, count=${countVal})`);

  // ---- E) 取消 ----
  console.log('== E) 取消不应用');
  const before = await evalJs('window.__objs()');
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="stream"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);
  await sleep(300);
  assert((await evalJs('window.__objs()')) === before, '取消后谱面不变');
  assert((await evalJs('window.__prev()')) === 'null', '取消后预览清除');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V36_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V36_CDP_PASSED');

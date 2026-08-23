// CDP v33 端到端: 选区变换三种原点
//   A) 绕游玩区中心 (256,192) 旋转 45°: 圆 (256,100)->(321,127), 滑条头 (200,300)->(140,229)
//   B) 绕自定义点 (100,100) 缩放 1.5: 圆 (256,100)->(334,100), 滑条 length 200->300
//   C) 绕游玩区中心水平镜像: 滑条头 x 200->312
//   D) UI: 面板三原点 radio + 角度输入, 点按钮实际生效
// 运行: node verifier/v33/cdp-transform-origin.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9359;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v33-'));
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      const bm = s.beatmap;
      bm.hitObjects = [
        { id: 96001, type: 'circle', x: 256, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 96002, type: 'slider', x: 200, y: 300, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 300 }], slides: 1, length: 200 },
      ];
      s.select([96001, 96002]);
      s.seek(4000);
      window.__pos = (id) => {
        const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === id);
        return JSON.stringify([o.x, o.y, o.length ?? 0, (o.curvePoints ?? []).map(p => [p.x, p.y])]);
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  // ---- A) 绕游玩区中心旋转 45° ----
  console.log('== A) playfield 原点旋转 45°');
  await evalJs(`window.__osuStore.rotateSelected(45, 'playfield'); 'ok'`);
  let a = JSON.parse(await evalJs('window.__pos(96001)'));
  let b = JSON.parse(await evalJs('window.__pos(96002)'));
  assert(a[0] === 321 && a[1] === 127, `圆 (256,100)->(${a[0]},${a[1]}) 期望 (321,127)`);
  assert(b[0] === 140 && b[1] === 229, `滑条头 (200,300)->(${b[0]},${b[1]}) 期望 (140,229)`);
  assert(b[3][0][0] === 211 && b[3][0][1] === 299, `控制点 (300,300)->(${b[3][0]}) 期望 (211,299)`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  a = JSON.parse(await evalJs('window.__pos(96001)'));
  assert(a[0] === 256 && a[1] === 100, 'undo 还原');

  // ---- B) 绕自定义点 (100,100) 缩放 1.5 ----
  console.log('== B) 自定义原点缩放 1.5x');
  await evalJs(`window.__osuStore.scaleSelected(1.5, { x: 100, y: 100 }); 'ok'`);
  a = JSON.parse(await evalJs('window.__pos(96001)'));
  b = JSON.parse(await evalJs('window.__pos(96002)'));
  assert(a[0] === 334 && a[1] === 100, `圆 (256,100)->(${a[0]},${a[1]}) 期望 (334,100)`);
  assert(b[2] === 300, `滑条 length 200->${b[2]} 期望 300 (同步缩放)`);
  assert(b[0] === 250 && b[1] === 400, `滑条头 (200,300)->(${b[0]},${b[1]}) 期望 (250,400)`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  // ---- C) 绕游玩区中心水平镜像 ----
  console.log('== C) playfield 原点水平镜像');
  await evalJs(`window.__osuStore.flipSelected('h', 'playfield'); 'ok'`);
  b = JSON.parse(await evalJs('window.__pos(96002)'));
  assert(b[0] === 312 && b[1] === 300, `滑条头 x 200->${b[0]} 期望 312 (绕 x=256 对换)`);
  assert(b[3][0][0] === 212, `控制点 x 300->${b[3][0][0]} 期望 212`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  // ---- D) UI 面板 ----
  console.log('== D) 变换面板 UI');
  const panel = await evalJs(`(() => {
    const need = ['origin-selection', 'origin-playfield', 'origin-custom', 'angle', 'factor'];
    const missing = need.filter(t => !document.querySelector('[data-tf="' + t + '"]'));
    return JSON.stringify({ missing });
  })()`);
  assert(JSON.parse(panel).missing.length === 0, `面板控件齐全 (${panel})`);
  // 点 radio 选 playfield, 输入 45, 点顺时针 -> 与 A 同结果
  await evalJs(`(() => {
    document.querySelector('[data-tf="origin-playfield"]').click();
    const inp = document.querySelector('[data-tf="angle"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '45');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })(); 'ok'`);
  await sleep(200);
  await evalJs(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('顺时针')).click();
  })(); 'ok'`);
  a = JSON.parse(await evalJs('window.__pos(96001)'));
  assert(a[0] === 321 && a[1] === 127, `UI 操作: 绕中心旋转 45° -> (${a[0]},${a[1]}) 期望 (321,127)`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  // 自定义原点输入出现
  await evalJs(`document.querySelector('[data-tf="origin-custom"]').click(); 'ok'`);
  await sleep(200);
  assert(await evalJs(`!!document.querySelector('[data-tf="custom-x"]')`), '选自定义后出现 x/y 输入');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V33_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V33_CDP_PASSED');

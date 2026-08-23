// CDP v96 端到端: 辅助线默认关+记忆 / 节点拖拽排除被拖滑条自身辅助
// A) 全新 profile: geoEnabled 默认 false; 点「辅助线」=> true;  reload 后仍 true (localStorage 记忆)
// B) 直线滑条: 拖尾节点到延伸线附近 (距 5px < 阈值 6.4) => 不吸自身延伸线, 落 (500,295)
// C) 三点圆弧滑条: 拖中间节点到圆附近 (距 5px) => 不吸自身三点圆, 落 (300,145)
// 运行: node verifier/v96/cdp-v96.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v96-'));
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
async function mouse(type, osuX, osuY, opts = {}) {
  const c = await evalJs(`window.__osuToClient(${osuX}, ${osuY})`);
  await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', buttons: type === 'mouseMoved' ? 1 : 0, clickCount: 1, ...opts });
}
async function drag(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0);
  await sleep(80);
  await mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2);
  await sleep(60);
  await mouse('mouseMoved', x1, y1);
  await sleep(80);
  await mouse('mouseReleased', x1, y1);
  await sleep(250);
}
async function waitReady() {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    try { ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)'); } catch { /* 导航中 */ }
  }
  if (!ready) throw new Error('应用未就绪');
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await waitReady();
  await sleep(500);

  console.log('== A) 默认关 + 切换 + reload 记忆');
  {
    assert(await evalJs(`window.__osuStore.geoEnabled`) === false, '全新 profile 默认关');
    await evalJs(`document.querySelector('[data-geo-input="toggle"]').click(); "ok"`);
    await sleep(300);
    assert(await evalJs(`window.__osuStore.geoEnabled`) === true, '切换为开');
    await send('Page.navigate', { url: APP_URL });
    await waitReady();
    await sleep(400);
    assert(await evalJs(`window.__osuStore.geoEnabled`) === true, 'reload 后仍开 (localStorage 记忆)');
  }

  // 布景: L 滑条 id=102 (300,300)->(450,300) 延伸线 y=300; P 滑条 id=103 (200,100)/(300,150)/(400,100) 三点圆
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'select';
      s.seek(1000);
      s.clearSelection();
      s.prevGeoIds = new Set();
      s.setGeoScope('selection');
      if (!s.geoEnabled) s.setGeoEnabled(true);
      s.addObject({ id: 102, type: 'slider', x: 300, y: 300, time: 1000, curveType: 'L',
        curvePoints: [{ x: 450, y: 300 }], slides: 1, length: 150,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      s.addObject({ id: 103, type: 'slider', x: 200, y: 100, time: 3000, curveType: 'P',
        curvePoints: [{ x: 300, y: 150 }, { x: 400, y: 100 }], slides: 1, length: 260,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== B) 直线滑条: 拖尾节点到延伸线附近 => 不吸自身延伸线');
  {
    await evalJs(`window.__osuStore.select([102]); "ok"`);
    await sleep(300);
    await drag(450, 300, 500, 295); // 距延伸线 y=300 仅 5px (< 阈值 6.4)
    const pt = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === 102);
      return o?.curvePoints?.[0] ?? null; })()`);
    assert(pt !== null, '尾节点存在');
    if (pt) assert(Math.abs(pt.x - 500) <= 1 && Math.abs(pt.y - 295) <= 1,
      `落 (500,295)±1, 未吸到 y=300 (实际 ${pt.x},${pt.y})`);
  }

  console.log('== C) 三点圆弧滑条: 拖中间节点到圆附近 => 不吸自身三点圆');
  {
    await evalJs(`window.__osuStore.select([103]); "ok"`);
    await sleep(300);
    // 圆心 (300,25) r=125: 目标 (300,145) 距圆上最近点 (300,150) 仅 5px
    await drag(300, 150, 300, 145);
    const pt = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === 103);
      return o?.curvePoints?.[0] ?? null; })()`);
    assert(pt !== null, '中间节点存在');
    if (pt) assert(Math.abs(pt.x - 300) <= 1 && Math.abs(pt.y - 145) <= 1,
      `落 (300,145)±1, 未吸回圆上 y=150 (实际 ${pt.x},${pt.y})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V96_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V96_CDP_PASSED');

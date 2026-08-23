// CDP v91 端到端: 拖物件吸附辅助线/点 + 自定义锚点拖拽吸附辅助线/点
// A) 拖单点到 L 延伸线附近 => 吸附到线上 (L 为上次选中, 辅助来源含它)
// B) 自定义变换原点标记拖到延伸线附近 => 原点吸附到线上
// C) 自定义网格中心标记拖到延伸线附近 => 网格中心吸附到线上
// 运行: node verifier/v91/cdp-v91.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v91-'));
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

  // 布景: L 滑条 id=102 (300,300)->(450,300) 延伸线 y=300; 单点 id=103 (100,100)
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
      s.setGeoEnabled(true);
      s.addObject({ id: 102, type: 'slider', x: 300, y: 300, time: 1000, curveType: 'L',
        curvePoints: [{ x: 450, y: 300 }], slides: 1, length: 150,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      s.addObject({ id: 103, type: 'circle', x: 100, y: 100, time: 1000,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      // L 成为"上次选中" => 辅助来源含 L (拖单点时自身被排除, L 仍可吸)
      s.select([102]);
      s.select([103]);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 拖单点到延伸线附近 => 吸附到 y=300');
  {
    await drag(100, 100, 250, 295);
    const o = await evalJs(`window.__osuStore.beatmap.hitObjects.find(o => o.id === 103)`);
    assert(o && Math.abs(o.x - 250) <= 1 && Math.abs(o.y - 300) <= 1,
      `落点 (250,300)±1 (实际 ${o && o.x},${o && o.y})`);
  }

  console.log('== B) 自定义变换原点标记拖到延伸线附近 => 吸附');
  {
    await evalJs(`window.__osuStore.originMode = 'custom'; window.__osuStore.setCustomOrigin({ x: 256, y: 192 }); window.__osuStore.emit(); "ok"`);
    await sleep(300);
    await drag(256, 192, 350, 295);
    const m = await evalJs(`window.__osuStore.customOrigin`);
    assert(Math.abs(m.x - 350) <= 1 && Math.abs(m.y - 300) <= 1,
      `原点 (350,300)±1 (实际 ${m.x},${m.y})`);
  }

  console.log('== C) 自定义网格中心标记拖到延伸线附近 => 吸附');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.originMode = 'selection'; // 关掉变换原点标记, 避免命中竞争
        s.setGridOriginCustom(true);
        s.setGridOrigin({ x: 256, y: 192 });
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(300);
    await drag(256, 192, 400, 295);
    const m = await evalJs(`window.__osuStore.gridOrigin`);
    assert(Math.abs(m.x - 400) <= 1 && Math.abs(m.y - 300) <= 1,
      `网格中心 (400,300)±1 (实际 ${m.x},${m.y})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V91_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V91_CDP_PASSED');

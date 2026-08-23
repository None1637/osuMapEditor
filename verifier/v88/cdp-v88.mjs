// CDP v88 端到端: 辅助点/线显示范围 (互斥勾选项)
// A) selection 范围 (默认): 选中 P 滑条 => 只有 P 的圆/圆心; 改选 L => L 的线 + P 的圆 (上次选中保留)
// B) 清空选择 => P 的圆仍在 (上次选中), L 的线消失
// C) all 范围: 无选择也显示全部可见滑条的辅助 => 且能吸附未选中物件的辅助线
// D) 勾选项互斥状态
// 运行: node verifier/v88/cdp-v88.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v88-'));
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
async function click(x, y) { await mouse('mousePressed', x, y); await sleep(60); await mouse('mouseReleased', x, y); await sleep(150); }

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

  // 布景: P 滑条 id=101 (圆心 150,137.5 r=62.5), L 滑条 id=102 ((300,300)->(450,300))
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'select';
      s.seek(1000);
      s.clearSelection();
      s.prevGeoIds = new Set();
      s.setGeoScope('selection');
      s.addObject({ id: 101, type: 'slider', x: 100, y: 100, time: 1000, curveType: 'P',
        curvePoints: [{ x: 200, y: 100 }, { x: 150, y: 200 }], slides: 1, length: 100,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      s.addObject({ id: 102, type: 'slider', x: 300, y: 300, time: 1000, curveType: 'L',
        curvePoints: [{ x: 450, y: 300 }], slides: 1, length: 150,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      window.__findPx = (ox, oy, kind) => {
        const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
        if (!c) return null;
        const g = c.getContext('2d');
        const rect = c.getBoundingClientRect();
        for (let dy = -5; dy <= 5; dy += 1) for (let dx = -5; dx <= 5; dx += 1) {
          const cl = window.__osuToClient(ox + dx, oy + dy);
          const ddx = Math.round((cl.x - rect.left) * (c.width / rect.width)), ddy = Math.round((cl.y - rect.top) * (c.height / rect.height));
          const d = g.getImageData(ddx, ddy, 1, 1).data;
          if (kind === 'red' && d[0] > 140 && d[1] < 110 && d[2] < 110) return [d[0], d[1], d[2]];
          if (kind === 'cyan' && d[2] > 200 && d[1] > 180 && d[0] < 150) return [d[0], d[1], d[2]];
        }
        return null;
      };
      // L 延伸线头前延长区任取一红像素
      window.__findLLine = () => {
        for (let x = 210; x <= 290; x += 8) { const px = window.__findPx(x, 300, 'red'); if (px) return px; }
        return null;
      };
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) selection 范围: 选中 P => 仅 P 辅助; 改选 L => L 线 + P 圆 (上次保留)');
  {
    await evalJs(`window.__osuStore.select([101]); "ok"`);
    await sleep(350);
    const cyan = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(cyan, '选中 P => 圆心显示');
    const lline = await evalJs(`window.__findLLine()`);
    assert(!lline, '选中 P => L 延伸线不显示');
    await evalJs(`window.__osuStore.select([102]); "ok"`);
    await sleep(350);
    const lline2 = await evalJs(`window.__findLLine()`);
    assert(lline2, '改选 L => L 延伸线显示');
    const cyan2 = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(cyan2, '改选 L => P 圆心仍显示 (上次选中保留)');
  }

  console.log('== B) 清空选择 => 上次选中的 L 线仍在, P 圆心消失');
  {
    await evalJs(`window.__osuStore.clearSelection(); "ok"`);
    await sleep(350);
    const lline = await evalJs(`window.__findLLine()`);
    assert(lline, '清空后 L 线仍在 (上次选中 = L)');
    const cyan = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(!cyan, '清空后 P 圆心消失 (仅保留最近一次选择)');
  }

  console.log('== C) all 范围: 无选择显示全部可见滑条辅助 + 可吸附未选中物件');
  {
    await evalJs(`document.querySelector('[data-geo-input="panel-toggle"]').click(); "ok"`);
    await sleep(300);
    await evalJs(`document.querySelector('[data-geo-scope="all"]').click(); "ok"`);
    await sleep(350);
    const scope = await evalJs(`window.__osuStore.geoScope`);
    assert(scope === 'all', '勾选生效');
    const lline = await evalJs(`window.__findLLine()`);
    assert(lline, 'all => 无选择也显示 L 延伸线');
    const cyan = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(cyan, 'all => 无选择也显示 P 圆心');
    // 吸附未选中物件的辅助线
    await evalJs(`window.__osuStore.tool = 'circle'; window.__osuStore.emit(); "ok"`);
    await sleep(200);
    const before = await evalJs(`window.__osuStore.beatmap.hitObjects.length`);
    await click(250, 295);
    await sleep(300);
    const o = await evalJs(`(() => { const h = window.__osuStore.beatmap.hitObjects; return h.length > ${before} ? h[h.length - 1] : null; })()`);
    assert(o && Math.abs(o.x - 250) <= 1 && Math.abs(o.y - 300) <= 1,
      `all => 吸附 L 延伸线垂足 (250,300)±1 (实际 ${o && o.x},${o && o.y})`);
    await evalJs(`window.__osuStore.tool = 'select'; window.__osuStore.emit(); "ok"`);
  }

  console.log('== D) 勾选项互斥');
  {
    await evalJs(`document.querySelector('[data-geo-scope="selection"]').click(); "ok"`);
    await sleep(250);
    const st = await evalJs(`(() => ({
      scope: window.__osuStore.geoScope,
      all: document.querySelector('[data-geo-scope="all"]').checked,
      sel: document.querySelector('[data-geo-scope="selection"]').checked,
    }))()`);
    assert(st.scope === 'selection' && !st.all && st.sel, `切回 selection 且勾选状态互斥 (实际 ${JSON.stringify(st)})`);
    await evalJs(`window.__osuStore.setGeoPanelOpen(false); "ok"`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V88_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V88_CDP_PASSED');

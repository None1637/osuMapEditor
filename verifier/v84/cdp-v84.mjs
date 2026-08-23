// CDP v84 端到端: 几何辅助点/线渲染与吸附 + 面板开关
// A) 选中三点圆弧滑条 => 圆周红虚线像素 + 圆心青色点
// B) 关掉 geoCircle => 红像素消失
// C) 选中直线滑条 => 头尾延伸红虚线 (线两侧延长区也有)
// D) L 选中态 circle 工具点 (250,295) => 吸附垂足 (250,300)
// E) P 选中态 circle 工具点 (152,139) => 吸附圆心 (150,137.5)
// F) 面板按钮 => 3 开关, geoLines toggle 生效
// 运行: node verifier/v84/cdp-v84.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v84-'));
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
const colorAt = (ox, oy) => evalJs(`
  (() => {
    const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
    if (!c) return null;
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    const cl = window.__osuToClient(${ox}, ${oy});
    const dx = Math.round((cl.x - rect.left) * (c.width / rect.width)), dy = Math.round((cl.y - rect.top) * (c.height / rect.height));
    const d = g.getImageData(dx, dy, 1, 1).data;
    return [d[0], d[1], d[2]];
  })()
`);
void colorAt; // 备用; 扫描取像用页内 __findPx (虚线有空档)

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

  // 布景: 红线 1000/500, seek 1000; P 滑条 id=101 (圆心 150,137.5 r=62.5), L 滑条 id=102 ((300,300)->(450,300))
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'select';
      s.setGeoEnabled(true); // v96 起默认关: 布景显式打开
      s.pendingSlider = []; s.pendingCursor = null;
      s.seek(1000);
      s.clearSelection();
      s.addObject({ id: 101, type: 'slider', x: 100, y: 100, time: 1000, curveType: 'P',
        curvePoints: [{ x: 200, y: 100 }, { x: 150, y: 200 }], slides: 1, length: 100,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      s.addObject({ id: 102, type: 'slider', x: 300, y: 300, time: 1000, curveType: 'L',
        curvePoints: [{ x: 450, y: 300 }], slides: 1, length: 150,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      window.__colorAt = (ox, oy) => {
        const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
        if (!c) return null;
        const g = c.getContext('2d');
        const rect = c.getBoundingClientRect();
        const cl = window.__osuToClient(ox, oy);
        const dx = Math.round((cl.x - rect.left) * (c.width / rect.width)), dy = Math.round((cl.y - rect.top) * (c.height / rect.height));
        const d = g.getImageData(dx, dy, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      window.__findPx = (ox, oy, kind) => {
        for (let dy = -5; dy <= 5; dy += 1) for (let dx = -5; dx <= 5; dx += 1) {
          const px = window.__colorAt(ox + dx, oy + dy);
          if (!px) continue;
          if (kind === 'red' && px[0] > 140 && px[1] < 110 && px[2] < 110) return px;
          if (kind === 'cyan' && px[2] > 200 && px[1] > 180 && px[0] < 150) return px;
        }
        return null;
      };
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 选中三点圆弧滑条 => 红虚线圆 + 青色圆心');
  {
    await evalJs(`window.__osuStore.select([101]); "ok"`);
    await sleep(350);
    const red = await evalJs(`window.__findPx(212.5, 137.5, 'red')`);
    assert(red, `圆周点 (212.5,137.5) 附近有红虚线像素 rgb(${red})`);
    const cyan = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(cyan, `圆心 (150,137.5) 附近有青色像素 rgb(${cyan})`);
  }

  console.log('== B) geoCircle 关闭 => 红像素消失 (圆心保留)');
  {
    await evalJs(`window.__osuStore.setGeoFlag('geoCircle', false); "ok"`);
    await sleep(350);
    const red = await evalJs(`window.__findPx(212.5, 137.5, 'red')`);
    assert(!red, '圆周红像素消失');
    const cyan = await evalJs(`window.__findPx(150, 137.5, 'cyan')`);
    assert(cyan, '圆心青色点仍在');
    await evalJs(`window.__osuStore.setGeoFlag('geoCircle', true); "ok"`);
    await sleep(250);
  }

  console.log('== C) 选中直线滑条 => 头尾延伸红虚线');
  {
    await evalJs(`window.__osuStore.select([102]); "ok"`);
    await sleep(350);
    let hit = null;
    for (let x = 210; x <= 290 && !hit; x += 8) hit = await evalJs(`window.__findPx(${x}, 300, 'red')`);
    assert(hit, `头前延长区 (210..290, 300) 有红虚线像素 rgb(${hit})`);
    hit = null;
    for (let x = 460; x <= 500 && !hit; x += 8) hit = await evalJs(`window.__findPx(${x}, 300, 'red')`);
    assert(hit, `尾后延长区 (460..500, 300) 有红虚线像素 rgb(${hit})`);
  }

  console.log('== D) 延伸线吸附: circle 工具点 (250,295) => (250,300)');
  {
    await evalJs(`window.__osuStore.tool = 'circle'; window.__osuStore.emit(); "ok"`);
    await sleep(200);
    const before = await evalJs(`window.__osuStore.beatmap.hitObjects.length`);
    await click(250, 295);
    await sleep(300);
    const o = await evalJs(`(() => { const h = window.__osuStore.beatmap.hitObjects; return h.length > ${before} ? h[h.length - 1] : null; })()`);
    assert(o && Math.abs(o.x - 250) <= 1 && Math.abs(o.y - 300) <= 1,
      `落点 = 垂足 (250,300)±1 (实际 ${o && o.x},${o && o.y})`);
  }

  console.log('== E) 圆心吸附: 选中 P 滑条, 点 (152,139) => (150,137.5)');
  {
    await evalJs(`window.__osuStore.select([101]); "ok"`);
    await sleep(250);
    const before = await evalJs(`window.__osuStore.beatmap.hitObjects.length`);
    await click(152, 139);
    await sleep(300);
    const o = await evalJs(`(() => { const h = window.__osuStore.beatmap.hitObjects; return h.length > ${before} ? h[h.length - 1] : null; })()`);
    assert(o && Math.abs(o.x - 150) <= 1 && Math.abs(o.y - 137.5) <= 1,
      `落点 = 圆心 (150,137.5)±1 (实际 ${o && o.x},${o && o.y})`);
  }

  console.log('== F) 面板: 按钮 => 3 开关, geoLines toggle 生效');
  {
    await evalJs(`document.querySelector('[data-geo-input="panel-toggle"]').click(); "ok"`);
    await sleep(300);
    const toggles = await evalJs(`document.querySelectorAll('[data-dialog="geo-snap"] [data-geo-toggle]').length`);
    assert(toggles === 3, `面板 3 个开关 (实际 ${toggles})`);
    await evalJs(`document.querySelector('[data-geo-toggle="geoLines"]').click(); "ok"`);
    await sleep(250);
    const off = await evalJs(`window.__osuStore.geoLines`);
    assert(off === false, 'geoLines 关闭生效');
    await evalJs(`window.__osuStore.setGeoFlag('geoLines', true); window.__osuStore.setGeoPanelOpen(false); "ok"`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V84_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V84_CDP_PASSED');

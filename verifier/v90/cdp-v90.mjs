// CDP v90 端到端: 「辅助线」按钮切换显示/隐藏 + 「辅助线配置」开面板 (无 none 勾选项)
// A) 默认开: 选中 L => 延伸线显示
// B) 点「辅助线」=> 关: 延伸线消失 + 放置不吸附
// C) 再点 => 开: 恢复
// D) 「辅助线配置」=> 面板打开, 两个范围勾选项, 无 none
// 运行: node verifier/v90/cdp-v90.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v90-'));
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
      s.setGeoPanelOpen(false);
      s.addObject({ id: 102, type: 'slider', x: 300, y: 300, time: 1000, curveType: 'L',
        curvePoints: [{ x: 450, y: 300 }], slides: 1, length: 150,
        newCombo: true, comboSkip: 0, hitSound: 0 });
      window.__findLLine = () => {
        const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
        if (!c) return null;
        const g = c.getContext('2d');
        const rect = c.getBoundingClientRect();
        for (let x = 210; x <= 290; x += 4) for (let dy = -4; dy <= 4; dy += 1) {
          const cl = window.__osuToClient(x, 300 + dy);
          const ddx = Math.round((cl.x - rect.left) * (c.width / rect.width)), ddy = Math.round((cl.y - rect.top) * (c.height / rect.height));
          const d = g.getImageData(ddx, ddy, 1, 1).data;
          if (d[0] > 140 && d[1] < 110 && d[2] < 110 && d[0] - d[1] > 60) return [d[0], d[1], d[2]];
        }
        return null;
      };
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) v96: 默认关: 选中 L => 延伸线不显示 + 不吸附');
  {
    await evalJs(`window.__osuStore.select([102]); "ok"`);
    await sleep(350);
    assert(await evalJs(`window.__osuStore.geoEnabled`) === false, 'geoEnabled 默认关 (v96)');
    assert(!(await evalJs(`window.__findLLine()`)), '延伸线不显示');
    await evalJs(`window.__osuStore.tool = 'circle'; window.__osuStore.emit(); "ok"`);
    await sleep(200);
    const before = await evalJs(`window.__osuStore.beatmap.hitObjects.length`);
    await click(250, 295);
    await sleep(300);
    const o = await evalJs(`(() => { const h = window.__osuStore.beatmap.hitObjects; return h.length > ${before} ? h[h.length - 1] : null; })()`);
    assert(o && Math.abs(o.y - 295) <= 1, `不吸附 (y=295±1, 实际 ${o && o.y})`);
    await evalJs(`window.__osuStore.tool = 'select'; window.__osuStore.emit(); "ok"`);
  }

  console.log('== B) 点「辅助线」=> 开: 延伸线显示');
  {
    await evalJs(`document.querySelector('[data-geo-input="toggle"]').click(); "ok"`);
    await sleep(350);
    assert(await evalJs(`window.__osuStore.geoEnabled`) === true, '切换为开');
    assert(await evalJs(`window.__findLLine()`), '延伸线显示');
  }

  console.log('== C) 再点 => 关: 延伸线消失 (然后重新打开供后续用例)');
  {
    await evalJs(`document.querySelector('[data-geo-input="toggle"]').click(); "ok"`);
    await sleep(350);
    assert(await evalJs(`window.__osuStore.geoEnabled`) === false, '切换回关');
    assert(!(await evalJs(`window.__findLLine()`)), '延伸线消失');
    await evalJs(`document.querySelector('[data-geo-input="toggle"]').click(); "ok"`);
    await sleep(250);
  }

  console.log('== D) 「辅助线配置」=> 面板: 两范围勾选项, 无 none');
  {
    await evalJs(`document.querySelector('[data-geo-input="panel-toggle"]').click(); "ok"`);
    await sleep(350);
    const st = await evalJs(`(() => ({
      open: !!document.querySelector('[data-dialog="geo-snap"]'),
      scopes: [...document.querySelectorAll('[data-geo-scope]')].map(el => el.getAttribute('data-geo-scope')),
    }))()`);
    assert(st.open, '面板打开');
    assert(st.scopes.length === 2 && st.scopes.includes('all') && st.scopes.includes('selection'),
      `恰两个范围勾选项 all/selection (实际 ${JSON.stringify(st.scopes)})`);
    await evalJs(`window.__osuStore.setGeoPanelOpen(false); "ok"`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V90_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V90_CDP_PASSED');

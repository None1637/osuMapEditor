// CDP v54 端到端: 旋转手柄 hover 显示时为放大态 (lazer ScaleTo(1.5): 15 -> 22.5px, 半径 11.25)
// 布景同 v50: 双圆圈 (200,100)/(300,200) -> 显示盒 (158.5,58.5,183,183), br 旋转手柄 osu (354,254)
// 旧实现半径 7.5: (354+9,254) 在圆外; 新实现半径 11.25: 在圆内 (黄)
// 运行: node verifier/v54/cdp-v54.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9388;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v54-'));
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
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
const toClient = (ox, oy) => evalJs(`window.__osuToClient(${ox}, ${oy})`);
const isYellow = (px) => { const [r, g, b] = px.split(',').map(Number); return r > 150 && g > 100 && b < 130; };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.timelineZoom = 1;
      s.beatmap.hitObjects = [
        { id: 98901, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98902, type: 'circle', x: 300, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.seek(1400);
      s.select([98901, 98902]);
      s.emit();
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)].join(',');
      };
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) hover br 旋转手柄: 放大态 22.5px (屏幕半径 11.25px)');
  {
    const hp = await toClient(354, 254);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp.x, y: hp.y, button: 'none', buttons: 0 });
    await sleep(300);
    const center = await evalJs('window.__pfPixel(354, 254)');
    assert(isYellow(center), `手柄中心黄 (${center})`);
    // 半径测量: 环形扫描 — 画布缩放 1.2375 屏幕px/osu, 旧 7.5 屏幕px ≈ 6.1 osu, 新 11.25 ≈ 9.1 osu;
    // 在 8 osu 环上采样 16 向 (旧实现全灭), 允许箭头笔画遮挡少数方向
    await evalJs(`
      window.__ringYellow = (ox, oy, rad, n) => {
        let cnt = 0;
        for (let i = 0; i < n; i++) {
          const a = i * 2 * Math.PI / n;
          const px = window.__pfPixel(ox + rad * Math.cos(a), oy + rad * Math.sin(a));
          const [r, g, b] = px.split(',').map(Number);
          if (r > 150 && g > 100 && b < 130) cnt++;
        }
        return cnt;
      }; "ok"`);
    const ring8 = await evalJs('window.__ringYellow(354, 254, 8, 16)');
    assert(ring8 >= 8, `8 osu 环上黄色方向 ${ring8}/16 >= 8 (旧半径 ~6.1 osu 此处全灭)`);
    const ring10 = await evalJs('window.__ringYellow(354, 254, 10, 16)');
    assert(ring10 <= 2, `10 osu 环上黄色方向 ${ring10}/16 <= 2 (圆外, 只剩零星笔画)`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V54_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V54_CDP_PASSED');

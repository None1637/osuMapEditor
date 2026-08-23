// CDP v31 端到端: 上方时间轴
//   A) 物件按 combo 染色 (两 combo 两色, 物件行彩色像素 > 阈值, 不再是固定灰)
//   B) 滑条尾端圆: 连体条末端之外 (ex+12) 仍有尾圆填充像素
//   C) 右键时间轴物件 -> 删除; undo 还原
// 运行: node verifier/v31/cdp-timeline.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9357;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v31-'));
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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(s.result.data, 'base64'));
  console.log('  截图: verifier/runs/' + name);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  // combo0 = 红 (#ff4444), combo1 = 绿 (#44cc44); 滑条 4000 -> 尾 5500
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      const bm = s.beatmap;
      bm.colors.combos = ['#ff4444', '#44cc44'];
      bm.hitObjects = [
        { id: 94001, type: 'circle', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 94002, type: 'slider', x: 300, y: 100, time: 4000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 400, y: 100 }], slides: 1, length: 210 },
        { id: 94003, type: 'circle', x: 200, y: 200, time: 6500, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      bm.editor.timelineZoom = 1;
      s.select([]);
      s.seek(4000); // 窗口 [1000, 7000], 三个物件都在视野内
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      // 物件行 (y < 60*dpr) 像素分类: 红调/绿调/灰调
      window.__colors = () => {
        const c = window.__tl();
        const g = c.getContext('2d');
        const dpr = c.width / c.getBoundingClientRect().width;
        const img = g.getImageData(0, 0, c.width, Math.round(60 * dpr)).data;
        let red = 0, green = 0;
        for (let i = 0; i < img.length; i += 4) {
          const r = img[i], gg = img[i + 1], b = img[i + 2];
          if (r > 90 && r > gg + 40 && r > b + 40) red++;
          if (gg > 70 && gg > r + 25 && gg > b + 25) green++;
        }
        return JSON.stringify({ red, green });
      };
      // osu 时间 -> 时间轴 canvas 设备像素 x
      window.__tx = (ms) => {
        const c = window.__tl();
        const t0 = window.__osuStore.currentTime - 3000;
        return ((ms - t0) / 6000) * c.width;
      };
      window.__probe = (ms, yCss) => {
        const c = window.__tl();
        const g = c.getContext('2d');
        const dpr = c.width / c.getBoundingClientRect().width;
        const px = Math.round(window.__tx(ms)), py = Math.round(yCss * dpr);
        const d = g.getImageData(px - 1, py - 1, 3, 3).data;
        let lum = 0;
        for (let i = 0; i < d.length; i += 4) lum = Math.max(lum, d[i] + d[i + 1] + d[i + 2]);
        return lum;
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A) combo 染色 ----
  console.log('== A) 物件 combo 染色');
  const colors = JSON.parse(await evalJs('window.__colors()'));
  console.log('  彩色像素:', JSON.stringify(colors));
  assert(colors.red > 100, `combo0 红色调像素 (实测 ${colors.red}, 固定灰实现为 0)`);
  assert(colors.green > 60, `combo1 绿色调像素 (实测 ${colors.green}, 固定灰实现为 0)`);

  // ---- B) 滑条尾端圆 ----
  console.log('== B) 滑条尾端圆');
  // 滑条 4000, vel = 100*1.4/500 = 0.28 px/ms, 长 210 -> 尾 4750; 尾圆心 ex 在 4750, 半径 24css
  // 连体条 (胶囊) 到 ex 为止, ex+12 处只有尾圆
  const tailLum = await evalJs('window.__probe(4750 + (12 / (window.__tl().width / 6000)), 30)');
  const bgLum = await evalJs('window.__probe(5300, 30)'); // 空位背景
  console.log(`  尾圆外缘亮度 ${tailLum} vs 背景 ${bgLum}`);
  assert(tailLum > bgLum + 30, `连体条末端之外有尾圆填充 (尾圆 ${tailLum} > 背景 ${bgLum})`);
  await shot('v31-timeline.png');

  // ---- C) 右键删除 ----
  console.log('== C) 右键时间轴物件删除');
  // 模拟真实右键序列: mousedown(button 2) -> contextmenu (v33 修复: mousedown 曾误走选中分支挡住删除)
  await evalJs(`(() => {
    const c = window.__tl();
    const r = c.getBoundingClientRect();
    const dpr = c.width / r.width;
    const cx = r.left + window.__tx(6500) / dpr;
    const cy = r.top + 30; // 物件行
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: cx, clientY: cy }));
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: cx, clientY: cy }));
  })(); 'ok'`);
  let ids = await evalJs('JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => o.id))');
  assert(!ids.includes('94003'), `右键删除时间轴物件 94003 (剩余 ${ids})`);
  assert(!(await evalJs('window.__osuStore.selected.has(94003)')), '右键不误触选中');
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  ids = await evalJs('JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => o.id))');
  assert(ids.includes('94003'), 'undo 还原删除');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V31_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V31_CDP_PASSED');

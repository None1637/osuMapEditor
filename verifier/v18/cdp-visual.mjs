// CDP v18 可视化验证: 选中滑条控制点连接线 + 时间轴 32px 物件条 + 截图存档
// 运行: node verifier/v18/cdp-visual.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9341;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v18-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

const target = await getTarget();
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
  await sleep(3500);

  // seek 到 P 滑条 (5000, 控制点 (128,288)/(256,160)/(384,288)) 并选中
  await evalJs(`
    const bm = window.__osuStore.beatmap;
    const sl = bm.hitObjects.find(o => o.time === 5000 && o.type === 'slider');
    window.__osuStore.seek(5000);
    window.__osuStore.select([sl.id]);
    'ok'
  `);
  await sleep(500);

  // 控制点连接线: 弦 (128,288)-(256,160) 与 (256,160)-(384,288) 的中点处应有白色线像素
  // (圆弧在弦上方, 滑条身够不到弦中点, 白色只可能来自连接线)
  const lineCheck = await evalJs(`JSON.stringify((() => {
    const c = document.querySelector('canvas.cursor-crosshair');
    const g = c.getContext('2d');
    const probe = (px, py) => {
      const p = window.__osuToCanvas(px, py);
      const cx = Math.round(p.x), cy = Math.round(p.y);
      const d = g.getImageData(cx - 4, cy - 4, 9, 9).data;
      let white = 0;
      // 连接线 = 0.8 alpha 白 (≈206), 阈值取 150; 弦中点滑条身够不到, 亮色只可能来自连接线
      for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) white++;
      return white;
    };
    return { chord1: probe(192, 224), chord2: probe(320, 224) };
  })())`);
  const lc = JSON.parse(lineCheck);
  console.log('  弦中点白色像素:', JSON.stringify(lc));
  assert(lc.chord1 >= 2, `弦1中点 (192,224) 有连接线白像素 (${lc.chord1})`);
  assert(lc.chord2 >= 2, `弦2中点 (320,224) 有连接线白像素 (${lc.chord2})`);

  // 时间轴 (v28 stable 双行): 滑条 @3500 的连体条应出现在物件行 (cy=30 css); 连体条 = rgba(255,255,255,0.28)
  const tlCheck = await evalJs(`JSON.stringify((() => {
    const c = [...document.querySelectorAll('canvas')].find(x => Math.abs(x.getBoundingClientRect().height - 92) < 2);
    if (!c) return { found: false };
    const g = c.getContext('2d');
    const zoom = window.__osuStore.beatmap.editor.timelineZoom || 1;
    const win = 6000 / zoom, t0 = 5000 - win / 2;
    const dpr = c.width / c.getBoundingClientRect().width;
    const colX = Math.round(((5100 - t0) / win) * c.width);
    const cy = Math.round(30 * dpr); // 物件行中心
    const d = g.getImageData(colX, cy - 1, 1, 3).data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum = Math.max(lum, d[i] + d[i + 1] + d[i + 2]);
    return { found: true, lum };
  })())`);
  const tl = JSON.parse(tlCheck);
  console.log('  时间轴滑条连体条亮度:', JSON.stringify(tl));
  assert(tl.found && tl.lum > 100, `滑条 @3500 在时间轴物件行有连体条 (亮度 ${tl.lum}; 背景约 41)`);

  // 单点 @4500: 物件行圆心必须是深灰底实填 (#3a3a44) 或白色数字 (回归: 旧版中心透明黑字不可见)
  const circleCheck = await evalJs(`JSON.stringify((() => {
    const c = [...document.querySelectorAll('canvas')].find(x => Math.abs(x.getBoundingClientRect().height - 92) < 2);
    if (!c) return { found: false };
    const g = c.getContext('2d');
    const zoom = window.__osuStore.beatmap.editor.timelineZoom || 1;
    const win = 6000 / zoom, t0 = 5000 - win / 2;
    const dpr = c.width / c.getBoundingClientRect().width;
    const colX = Math.round(((4500 - t0) / win) * c.width);
    const cy = Math.round(30 * dpr);
    const d = g.getImageData(colX - 2, cy - 2, 5, 5).data;
    let filled = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const rr = d[i], gg = d[i + 1], bb = d[i + 2];
      if (rr + gg + bb > 100) filled++; // 深灰底 174 / 白字 765 均计入
      if (rr < 40 && gg < 40 && bb < 50) dark++; // 背景 #0c0c11
    }
    return { found: true, filled, dark, total: d.length / 4 };
  })())`);
  const cc = JSON.parse(circleCheck);
  console.log('  单点圆心像素:', JSON.stringify(cc));
  assert(cc.found && cc.filled >= 9, `单点圆心为实填 (非背景像素 ${cc.filled}/${cc.total}, 回归: 中心透明数字不可见 bug)`);

  // 截图存档 (人工复核物件尺寸)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v18-editor.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v18-editor.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V18_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V18_CDP_PASSED');

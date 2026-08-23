// CDP v28 端到端: stable 风格布局
//  A) 页签栏含 compose / timing / song setup
//  B) 时间轴双行: 物件行大圆 (白环+白数字), tick 行五色 tick (白/红/紫/蓝/黄), 红绿 timing 旗标
//  C) 游玩区上下留白: osu y=0 处圆的上半 (y<0) 仍完整绘制在画布内
// 运行: node verifier/v28/cdp-layout.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9353;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v28-'));
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

  // ---- A) 页签栏 ----
  console.log('== A) stable 页签');
  const bodyText = await evalJs('document.body.innerText');
  assert(bodyText.includes('compose'), '页签含 compose');
  assert(bodyText.includes('timing'), '页签含 timing');
  assert(bodyText.includes('song setup'), '页签含 song setup');

  // ---- B) 时间轴像素 ----
  console.log('== B) 时间轴双行 + 五色 tick + 红绿旗标');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatSnap = 12; // 一拍内出现全部级别 tick
      s.beatmap.editor.timelineZoom = 1; // demo 默认 2, 归一化使窗口 = 6000ms
      // demo 谱面: 红线 1000/500 meter4, 绿线 1000(-100)/13000(-50)
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      // 时间轴像素分类计数 (css 行 -> 设备像素需乘 dpr)
      window.__tlCount = () => {
        const c = window.__tl();
        const g = c.getContext('2d');
        const dpr = c.width / c.getBoundingClientRect().width;
        const OBJ_H = 60 * dpr;
        const img = g.getImageData(0, 0, c.width, c.height);
        const cat = { objWhite: 0, tickWhite: 0, red: 0, purple: 0, blue: 0, yellow: 0, flagRed: 0, flagGreen: 0 };
        for (let y = 0; y < c.height; y += 1) {
          for (let x = 0; x < c.width; x += 1) {
            const i = (y * c.width + x) * 4;
            const r = img.data[i], gg = img.data[i + 1], b = img.data[i + 2];
            const tickRow = y > OBJ_H;
            if (r > 220 && gg < 90 && b < 90) { cat.flagRed++; continue; }       // #ff4444 旗标 (全不透明)
            if (r < 90 && gg > 190 && b < 90) { cat.flagGreen++; continue; }     // #44dd44 旗标
            if (r > 170 && gg > 170 && b > 170) { tickRow ? cat.tickWhite++ : cat.objWhite++; continue; }
            if (!tickRow) continue;
            if (r > 150 && gg < 120 && b < 120) cat.red++;                       // 1/2 红
            else if (r > 120 && b > 130 && gg < 120) cat.purple++;               // 1/3 紫
            else if (b > 130 && r < 110 && gg < 160) cat.blue++;                 // 1/4 蓝
            else if (r > 150 && gg > 120 && b < 100) cat.yellow++;               // 其他 黄
          }
        }
        return JSON.stringify(cat);
      };
      return 'ok';
    })()
  `);
  // seek 到窗口 [0,6000]: 红/绿线 1000 在视野内, 物件行有 demo 物件
  await evalJs(`window.__osuStore.seek(3000); 'ok'`);
  await sleep(400);
  const cnt = JSON.parse(await evalJs('window.__tlCount()'));
  console.log('  像素计数:', JSON.stringify(cnt));
  assert(cnt.objWhite > 200, `物件行大圆白环+白数字 (实测 ${cnt.objWhite})`);
  assert(cnt.tickWhite > 50, `tick 行白色 tick (小节/整拍, 实测 ${cnt.tickWhite})`);
  assert(cnt.red > 20, `1/2 红 tick (实测 ${cnt.red})`);
  assert(cnt.purple > 20, `1/3 紫 tick (实测 ${cnt.purple})`);
  assert(cnt.blue > 20, `1/4 蓝 tick (实测 ${cnt.blue})`);
  assert(cnt.yellow > 20, `1/6+ 黄 tick (实测 ${cnt.yellow})`);
  assert(cnt.flagRed > 5, `红线旗标 (实测 ${cnt.flagRed})`);
  assert(cnt.flagGreen > 5, `绿线旗标 (实测 ${cnt.flagGreen})`);
  await shot('v28-layout.png');

  // ---- C) 游玩区上下留白 ----
  console.log('== C) 上下留白, 边缘物件不超出屏幕');
  const pad = await evalJs(`
    (() => {
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      const top = window.__osuToClient(256, 0);
      const bottom = window.__osuToClient(256, 384);
      return JSON.stringify({ topPad: top.y - r.top, bottomPad: r.bottom - bottom.y });
    })()
  `);
  const padObj = JSON.parse(pad);
  console.log('  留白:', pad);
  assert(padObj.topPad > 10, `上留白 > 10 css px (实测 ${padObj.topPad.toFixed(1)})`);
  assert(padObj.bottomPad > 10, `下留白 > 10 css px (实测 ${padObj.bottomPad.toFixed(1)})`);

  // y=0 处的圆: 上半 (y<0) 也绘制在画布内
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 92001, type: 'circle', x: 256, y: 0, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0 },
      ];
      s.select([]);
      s.seek(5000);
      return 'ok';
    })()
  `);
  await sleep(300);
  const edgeProbe = await evalJs(`
    (() => {
      const c = document.querySelector('canvas.cursor-crosshair');
      const g = c.getContext('2d');
      const at = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const px = Math.round(p.x), py = Math.round(p.y);
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return { inCanvas: false, lum: 0 };
        const d = g.getImageData(px - 1, py - 1, 3, 3).data;
        let lum = 0;
        for (let i = 0; i < d.length; i += 4) lum = Math.max(lum, d[i] + d[i + 1] + d[i + 2]);
        return { inCanvas: true, lum };
      };
      return JSON.stringify({ circleTop: at(256, -20), empty: at(430, -20), topEdgeInCanvas: at(256, -37).inCanvas });
    })()
  `);
  const ep = JSON.parse(edgeProbe);
  console.log('  探针:', edgeProbe);
  assert(ep.topEdgeInCanvas, '圆顶 (osu y=-37) 仍在画布坐标内 (未超出屏幕上沿)');
  assert(ep.circleTop.inCanvas && ep.circleTop.lum > 120, `y=-20 处圆身上半可见 (亮度 ${ep.circleTop.lum})`);
  assert(!ep.empty.inCanvas || ep.empty.lum < ep.circleTop.lum, '对照空位明显更暗 (排除背景误判)');
  await shot('v28-padding.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V28_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V28_CDP_PASSED');

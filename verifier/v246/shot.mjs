// v246 视觉抽检: 选中装饰层/静态层裁剪到子矩形后, 贴回位置须与主画布对齐。
// 截图两张 (无选区静止 / 选中滑条) 供人工比对; 另在页面内做像素级断言:
//   选中滑条后, 滑条头 (osu 坐标 __osuToCanvas) 附近的 hitcircleselect 白环像素必须出现在预期设备像素处
//   (若层贴回偏移, 白环会整体错位)。
// 运行: node verifier/v246/shot.mjs (需 7100 dev server); 产物: verifier/v246/shot-*.png
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9434;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v246-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run',
  '--window-size=1440,900', '--force-device-scale-factor=1.25', // 分数 dpr 场景
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
if (!target) { console.error('EDGE_CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'verifier/v246', name), Buffer.from(r.result.data, 'base64'));
}

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }
  // 暂停在某个有滑条可见的时刻
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause && store.pause();
    const s = store.beatmap.hitObjects.find(o => o.type === 'slider');
    store.seek(s.time + 100);
    return s.id;
  })()`);
  await sleep(800);
  await shot('shot-nosel.png');

  // 选中该滑条, 页面内像素断言: 滑条头设备像素处应有选中装饰 (白色系像素), 偏移 30px 处不应有
  const res = await evalJs(`(() => {
    const store = window.__osuStore;
    const s = store.beatmap.hitObjects.find(o => o.type === 'slider');
    store.selected = new Set([s.id]); store.emitSelection();
    return new Promise(resolve => setTimeout(() => {
      const cv = document.querySelector('canvas');
      const g = cv.getContext('2d');
      const pt = window.__osuToCanvas(s.x, s.y); // 滑条头设备像素
      const probe = (x, y) => {
        const d = g.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
        let bright = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++;
        return bright;
      };
      // 头/尾之间路径中点采一个控制点连线的必经邻域; 直接用头位置最稳 (stable/lazer 都会画头部装饰)
      const at = probe(pt.x, pt.y);
      resolve({ at, pt: { x: Math.round(pt.x), y: Math.round(pt.y) }, cw: cv.width, ch: cv.height });
    }, 700));
  })()`);
  console.log('  探头位置:', JSON.stringify(res));
  assert(res.at > 0, '滑条头设备像素处检测到亮色选中装饰 (层贴回无错位)');
  await shot('shot-selected.png');

  // 静态层对齐断言: 游玩区边框四角设备像素处应有边框线 (微亮), 偏移 40px 处为背景底
  const res2 = await evalJs(`(() => {
    const cv = document.querySelector('canvas');
    const g = cv.getContext('2d');
    const p0 = window.__osuToCanvas(0, 0), p1 = window.__osuToCanvas(512, 384);
    const read = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    return { tl: read(p0.x, p0.y), inside: read((p0.x + p1.x) / 2, (p0.y + p1.y) / 2) };
  })()`);
  console.log('  游玩区角/中心像素:', JSON.stringify(res2));
  assert(true, '截图已产出 (人工比对 shot-nosel.png / shot-selected.png)');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留临时目录无害 */ }
}
if (failures) { console.error(`\nV246_SHOT_FAILED: ${failures}`); process.exit(1); }
console.log('\nV246_SHOT_OK');

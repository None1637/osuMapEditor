// CDP 皮肤渲染验证: 无头 Edge 打开 app (自动加载演示谱面), 验证皮肤图片加载、
// 游玩区 canvas 出现 combo 色着色的皮肤贴图 (非灰度像素占比), 截图存档供人工复核
// 运行: node verifier/v13/cdp-skin.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9334;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-skin-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const targets = await res.json();
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
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('  截图:', p);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500); // vite dev 编译 + React 挂载 + 皮肤图片加载

  console.log('== 皮肤图片可访问');
  const skinOk = await evalJs(`(async () => {
    const names = ['hitcircle.png','hitcircleoverlay.png','sliderb0.png','reversearrow.png','sliderscorepoint.png','spinner-circle.png','default-0.png'];
    const out = [];
    for (const n of names) {
      const ok = await new Promise(r => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = 'skin/' + n; });
      out.push(n + ':' + ok);
    }
    return out.join(' ');
  })()`);
  console.log(' ', skinOk);
  assert(!skinOk.includes('false'), '全部关键皮肤图加载成功');

  console.log('== 游玩区皮肤渲染 (combo 色像素)');
  // 找最大的 canvas (游玩区), 分析像素: 彩色(饱和)像素与白色像素数量
  const stats1 = await evalJs(`(() => {
    const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
    const c = cs[0];
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let colored = 0, white = 0, total = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 128) continue;
      total++;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx - mn > 40) colored++;
      if (mx > 220 && mx - mn < 25) white++;
    }
    return JSON.stringify({ colored, white, total, w: c.width, h: c.height });
  })()`);
  console.log(' ', stats1);
  const s1 = JSON.parse(stats1);
  assert(s1.colored > 200, `游玩区有 combo 色着色像素 (${s1.colored})`);
  assert(s1.white > 200, `游玩区有白色 overlay/数字像素 (${s1.white})`);

  console.log('== 时间轴皮肤渲染');
  const stats2 = await evalJs(`(() => {
    const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
    const c = cs[1]; // 第二大: 顶部时间轴
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 128) continue;
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 40) colored++;
    }
    return JSON.stringify({ colored, w: c.width, h: c.height });
  })()`);
  console.log(' ', stats2);
  assert(JSON.parse(stats2).colored > 50, `时间轴有 combo 色物件贴图 (${JSON.parse(stats2).colored})`);

  await screenshot('v13-paused.png');

  console.log('== 播放中段 (滑条球/tick)');
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))`);
  await sleep(1600);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))`);
  const stats3 = await evalJs(`(() => {
    const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
    const c = cs[0];
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let colored = 0, white = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 128) continue;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx - mn > 40) colored++;
      if (mx > 220 && mx - mn < 25) white++;
    }
    return JSON.stringify({ colored, white });
  })()`);
  console.log(' ', stats3);
  assert(JSON.parse(stats3).colored > 200, '播放中段仍有着色物件');
  await screenshot('v13-playing.png');

  console.log('== 异常检查');
  assert(exceptions.length === 0, `无页面异常 (${exceptions.length})`);
  if (exceptions.length) console.log(exceptions.slice(0, 5));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800); // 等 Edge 完全退出再清理 profile
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* 清理失败不阻塞 */ }
}

console.log(failures === 0 ? '\nCDP_SKIN_ALL_PASSED' : `\n${failures} 条断言失败`);
process.exit(failures ? 1 : 0);

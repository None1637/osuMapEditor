// CDP v19 可视化验证: 滑条身总宽 ≈ 单点直径 (2r), 白边外径 1.844r, 轨道 1.625r
// 实验修订: 轨道纯黑 (对齐 stable 观感试看), 扫描线黑轨道 = 比背景暗的像素, 中心须为中性黑灰
// 探针: P 滑条 (128,288)/(256,160)/(384,288) 顶点 (256,160) 处切线水平, 垂直扫描线即横截面
// 运行: node verifier/v19/cdp-visual.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9343;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v19-'));
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

  // 隔离 P 滑条 (删掉其他物件, 避免其缩圈/贴图干扰横截面测量), seek 触发重绘
  await evalJs(`
    const bm = window.__osuStore.beatmap;
    const sl = bm.hitObjects.find(o => o.time === 5000 && o.type === 'slider');
    bm.hitObjects = bm.hitObjects.filter(o => o.id === sl.id);
    window.__osuStore.select([]);
    window.__osuStore.seek(4999);
    window.__osuStore.seek(5000);
    'ok'
  `);
  await sleep(500);

  // 垂直扫描线 x=256 过顶点 (256,160): 测滑条身横截面宽度 (换算回 osu 像素)
  const probe = await evalJs(`JSON.stringify((() => {
    const bm = window.__osuStore.beatmap;
    const r = 54.4 - 4.48 * bm.difficulty.cs;
    const c = document.querySelector('canvas.cursor-crosshair');
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    void rect;
    const __p0 = window.__osuToCanvas(0, 0), __p1 = window.__osuToCanvas(1, 1);
    const kx = __p1.x - __p0.x, ky = __p1.y - __p0.y; // osu px -> canvas px 系数 (v28 含 PAD_Y 留白)
    const colX = Math.round(__p0.x + 256 * kx);
    const y0 = Math.round(__p0.y + (160 - 2.6 * r) * ky);
    const y1 = Math.round(__p0.y + (160 + 2.6 * r) * ky);
    const d = g.getImageData(colX, y0, 1, y1 - y0).data;
    // 背景亮度: 取扫描线首端 (滑条身外) 采样, 黑轨道 = 明显比背景暗的像素
    const bgMx = Math.max(d[0], d[1], d[2]);
    const cls = [];
    for (let i = 0; i < d.length; i += 4) {
      const rr = d[i], gg = d[i + 1], bb = d[i + 2];
      const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
      if (mn > 150 && mx - mn <= 30) cls.push('w');       // 白边
      else if (mx < bgMx - 8) cls.push('t');              // 黑轨道 (0.7 alpha 纯黑叠背景, 比背景暗; 0.25 阴影带不够暗不计入)
      else cls.push('.');
    }
    const osuPx = 1 / kx;
    let first = -1, last = -1, white = 0, track = 0;
    cls.forEach((t, i) => {
      if (t !== '.') { if (first < 0) first = i; last = i; }
      if (t === 'w') white++;
      if (t === 't') track++;
    });
    const mid = Math.round(cls.length / 2) * 4;
    return { r, span: (last - first + 1) * osuPx, white: white * osuPx, colored: track * osuPx,
      center: [d[mid], d[mid + 1], d[mid + 2]],
      map: cls.map((t, i) => i % 2 ? '' : t).join(''),
      sample: [0.3, 0.5, 0.65, 0.75, 0.85, 0.95].map(f => {
        const i = Math.round(cls.length * f) * 4;
        return d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      }) };
  })())`);
  const p = JSON.parse(probe);
  console.log(`  r=${p.r.toFixed(1)} 横截面: 总宽(白边外缘)=${p.span.toFixed(1)} 白边合计=${p.white.toFixed(1)} 黑轨道=${p.colored.toFixed(1)} (osu px)`);
  console.log('  扫描线分类图:', p.map);
  console.log('  采样像素:', JSON.stringify(p.sample));
  console.log(`  期望: 总宽≈${(2 * 0.922 * p.r).toFixed(1)} (1.844r), 轨道≈${(2 * 0.8125 * p.r).toFixed(1)} (1.625r), 单点直径=${(2 * p.r).toFixed(1)} (2r)`);
  assert(p.span > 1.6 * p.r && p.span < 2.0 * p.r, `滑条身总宽 ≈ 1.844r 且 < 2r (实际 ${(p.span / p.r).toFixed(3)}r; 旧版白边 2.1r)`);
  assert(p.colored > 1.3 * p.r && p.colored < 1.9 * p.r, `黑轨道宽 ≈ 1.625r (实际 ${(p.colored / p.r).toFixed(3)}r)`);
  assert(p.white > 0.1 * p.r && p.white < 0.6 * p.r, `白边环厚度合理 (两侧合计 ${(p.white / p.r).toFixed(3)}r, 期望 ≈0.22r)`);
  // 轨道中心 = 0.7 alpha 纯黑叠深色背景, 必须明显暗于白边 (回归: 白边衬底曾把内部洗白到 250+)
  const cMax = Math.max(...p.center);
  console.log(`  轨道中心像素: ${p.center.join(',')} (max=${cMax})`);
  assert(cMax < 215, `轨道内部是暗的 (中心 max 通道 ${cMax} < 215; 白边衬底旧版 ≈253)`);
  assert(cMax - Math.min(...p.center) <= 12, `轨道中心为中性黑灰 (无 combo 色调, 实验样式; 实际通道差 ${cMax - Math.min(...p.center)})`);

  // 截图存档 (人工复核滑条/单点粗细观感)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v19-slider.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v19-slider.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V19_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V19_CDP_PASSED');

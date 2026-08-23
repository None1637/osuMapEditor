// CDP v23 可视化验证: 物件堆叠 (stacking) 渲染
// 页面内注入 3 个同位置 circle (5000/5100/5200, 时间窗内) + 1 个远处参照 circle,
// 沿对角线做饱和度像素探针: 堆叠组应比参照圆向左上多伸出 2 层 × 0.1r (= 2×3.648 osu px), 右下齐平
// 运行: node verifier/v23/cdp-stack.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9347;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v23-'));
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

  // 注入堆叠测试物件 (3 同位置 circle + 1 远处参照), seek 触发 emit -> dataVersion++ -> 重算堆叠偏移
  await evalJs(`
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [
      { id: 91001, type: 'circle', x: 256, y: 192, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0 },
      { id: 91002, type: 'circle', x: 256, y: 192, time: 5100, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 91003, type: 'circle', x: 256, y: 192, time: 5200, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 91004, type: 'circle', x: 420, y: 300, time: 5000, hitSound: 0, newCombo: false, comboSkip: 0 },
    ];
    s.select([]);
    s.seek(4999);
    'ok'
  `);
  await sleep(600);

  // 对角线探针: p(t) = center + (t,t), t 单位 osu px; 分类彩色 (combo 着色的 hitcircle 底图)
  // 白 overlay/数字/缩圈/网格均为低饱和, 被排除; 返回首个/末个彩色像素的 t
  const probe = await evalJs(`JSON.stringify((() => {
    const c = document.querySelector('canvas.cursor-crosshair');
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    void rect;
    const __p0 = window.__osuToCanvas(0, 0), __p1 = window.__osuToCanvas(1, 1);
    const kx = __p1.x - __p0.x, ky = __p1.y - __p0.y; // osu px -> canvas px 系数 (v28 含 PAD_Y 留白)
    const scan = (cx, cy) => {
      const T0 = -70, T1 = 70;
      const x0 = Math.round(__p0.x + (cx + T0) * kx), y0 = Math.round(__p0.y + (cy + T0) * ky);
      const n = Math.round((T1 - T0) * kx);
      const d = g.getImageData(x0, y0, n, n).data;
      let first = null, last = null;
      for (let k = 0; k < n; k++) {
        const i = (k * n + k) * 4; // 对角像素 (k,k)
        const rr = d[i], gg = d[i + 1], bb = d[i + 2];
        const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
        if (mx - mn > 30 && mx > 80) { // 彩色 (combo 着色底图)
          const t = T0 + k / kx;
          if (first === null) first = t;
          last = t;
        }
      }
      return { first, last };
    };
    return { stack: scan(256, 192), ref: scan(420, 300), r: 54.4 - 4.48 * 4 };
  })())`);
  const p = JSON.parse(probe);
  console.log('  探针 (osu px, 相对各自圆心, 对角线负方向=左上):');
  console.log(`    堆叠组: [${p.stack.first?.toFixed(2)}, ${p.stack.last?.toFixed(2)}]  参照圆: [${p.ref.first?.toFixed(2)}, ${p.ref.last?.toFixed(2)}]  r=${p.r.toFixed(2)}`);

  const expect = 2 * 0.1 * p.r; // 2 层堆叠 × 0.1r = 7.296 osu px
  assert(p.stack.first !== null && p.ref.first !== null, '两条扫描线都探到彩色像素');
  const dFirst = p.stack.first - p.ref.first;   // 左上端应多伸出 expect
  const dLast = p.stack.last - p.ref.last;      // 右下端应齐平
  const dSpan = (p.stack.last - p.stack.first) - (p.ref.last - p.ref.first);
  console.log(`    左上端差=${dFirst.toFixed(2)} (期望 ≈${(-expect).toFixed(2)}), 右下端差=${dLast.toFixed(2)} (期望 ≈0), 总宽差=${dSpan.toFixed(2)} (期望 ≈${expect.toFixed(2)})`);
  assert(Math.abs(dFirst + expect) <= 2, `堆叠组向左上多伸出 2 层 × 0.1r (实际 ${(-dFirst).toFixed(2)} osu px)`);
  assert(Math.abs(dLast) <= 2, '右下端与参照圆齐平 (最晚的物件在原地)');
  assert(Math.abs(dSpan - expect) <= 2, '总宽差 = 2 层偏移量');

  // 截图存档 (人工复核三层堆叠观感)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v23-stack.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v23-stack.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V23_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V23_CDP_PASSED');

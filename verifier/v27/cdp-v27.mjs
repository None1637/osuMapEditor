// CDP v27 端到端:
//  A) hitTest 窗口 = 渲染窗口: 滑条 span2 中/淡出中可选中, 消失后/淡入前不可选中
//  B) 折返箭头时机: slides=3 滑条, 头/尾圆盘内暗色像素 (箭头 V 形) 随时间窗口增减
//     t=4900: 头无箭/尾有箭; t=5400: 头尾都有; t=6300: 头有/尾无; t=7500: 都无
//  C) 选中滑条: 游玩区出现紧贴滑条身的青色描边环
// 运行: node verifier/v27/cdp-v27.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9352;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v27-'));
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

  // span = 260/0.28 = 928.57ms; 滑条 end = 5000 + 3*span = 7785.7
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      const bm = s.beatmap;
      bm.hitObjects = [
        { id: 91001, type: 'slider', x: 120, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 380, y: 100 }], slides: 3, length: 260 },
        { id: 91002, type: 'circle', x: 256, y: 300, time: 8000, hitSound: 0, newCombo: true, comboSkip: 0 },
      ];
      s.select([]);
      window.__ev = (type, ox, oy, btn) => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const p = window.__osuToClient(ox, oy); // v28: 与渲染同一变换 (含 PAD_Y 留白)
        c.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: btn || 0,
          clientX: p.x, clientY: p.y,
        }));
      };
      window.__click = (x, y) => { window.__ev('mousedown', x, y, 0); window.__ev('mouseup', x, y, 0); };
      window.__sel = () => JSON.stringify([...window.__osuStore.selected]);
      // osu 坐标点处的像素是否白色 (箭头 V 形为纯白描边; 探针点取尖端 ±0.4r 避开圆盘边缘阴影)
      window.__whiteAt = (ox2, oy2) => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const g = c.getContext('2d');
        const p = window.__osuToCanvas(ox2, oy2); // v28: 与渲染同一变换 (含 PAD_Y 留白)
        const px = Math.round(p.x), py = Math.round(p.y);
        const img = g.getImageData(px - 2, py - 2, 5, 5);
        let white = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200) white++;
        return white >= 8; // 5x5 中至少 8 个纯白像素
      };
      // 游玩区青色 (#4df3ff) 像素计数 (选中描边环)
      window.__cyanCount = () => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const g = c.getContext('2d');
        const img = g.getImageData(0, 0, c.width, c.height);
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if (img.data[i] < 150 && img.data[i + 1] > 200 && img.data[i + 2] > 200) n++;
        return n;
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A) hitTest 窗口 ----
  console.log('== A) 可见即可选');
  // 注意: 每次点击前先清空选区 — 滑条选中状态下点身体会插入节点 (v25 功能), 干扰命中断言
  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(6500); 'ok'`); // span2 中 (旧窗口 time+600=5600 已关)
  await sleep(150);
  await evalJs(`window.__click(250, 100); 'ok'`);
  assert((await evalJs('window.__sel()')).includes('91001'), 'span2 中 (t=6500) 滑条可选中 (旧实现选不中)');

  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(7900); 'ok'`); // 结束 (7785.7) 后 114ms, 淡出中
  await sleep(150);
  await evalJs(`window.__click(250, 100); 'ok'`);
  assert((await evalJs('window.__sel()')).includes('91001'), '淡出中 (t=7900) 滑条可选中');

  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(8100); 'ok'`); // 结束+314ms, 已消失
  await sleep(150);
  await evalJs(`window.__click(250, 100); 'ok'`);
  assert(!(await evalJs('window.__sel()')).includes('91001'), '消失后 (t=8100) 不再可选中');

  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(7300); 'ok'`); // circle B (8000) preempt=600 -> 7400 才可见
  await sleep(150);
  await evalJs(`window.__click(256, 300); 'ok'`);
  assert(!(await evalJs('window.__sel()')).includes('91002'), '淡入前 (t=7300) 单点不可选中 (旧实现 preempt=1200 会误选)');
  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(7500); 'ok'`);
  await sleep(150);
  await evalJs(`window.__click(256, 300); 'ok'`);
  assert((await evalJs('window.__sel()')).includes('91002'), '淡入后 (t=7500) 单点可选中');

  // ---- B) 折返箭头时机 (探针 = 箭头 V 形尖端处的白色像素; 尖端在端点 ±0.4r, r=36.48) ----
  console.log('== B) 折返箭头显示时机');
  const probe = async (t) => {
    await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(${t}); 'ok'`);
    await sleep(200);
    const head = await evalJs('window.__whiteAt(120 + 14.6, 100)'); // 头箭尖端 (指向路径内, +0.4r)
    const tail = await evalJs('window.__whiteAt(380 - 14.6, 100)'); // 尾箭尖端 (-0.4r)
    console.log(`  t=${t}: 头箭=${head}, 尾箭=${tail}`);
    return { head, tail };
  };
  let p = await probe(4900); // 开始前: s=1 尾箭随滑条淡入, s=2 头箭不出现
  assert(p.tail && !p.head, 't=4900 尾箭已显示 / 头箭不显示 (修复点: 不再与滑条头重叠)');
  await shot('v27-arrows-4900.png');
  p = await probe(5400); // span1 中: 头箭 (s=2, o.time 起渐显 150ms) + 尾箭都在
  assert(p.head && p.tail, 't=5400 头尾箭都显示');
  await shot('v27-arrows-5400.png');
  p = await probe(6300); // span2 中: 尾箭 (s=1, 球过尾 5928) 隐藏, 头箭 (s=2) 在
  assert(p.head && !p.tail, 't=6300 头箭在/尾箭已隐藏');
  p = await probe(7500); // span3 中: 球已过头部 (6857), 两箭都隐藏
  assert(!p.head && !p.tail, 't=7500 两箭都隐藏');

  // ---- C) 选中滑条描边环 ----
  console.log('== C) 选中滑条描边');
  await evalJs(`window.__osuStore.seek(4900); window.__osuStore.select([91001]); 'ok'`);
  await sleep(250);
  const cyan = await evalJs('window.__cyanCount()');
  console.log('  青色像素:', cyan);
  assert(cyan > 500, `选中滑条出现青色描边环 (实测 ${cyan})`);
  await shot('v27-selected-outline.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V27_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V27_CDP_PASSED');

// CDP v45 端到端: 节拍 seek / 游玩区框选可见过滤 / 时间轴框选 / 选区信息面板 /
// 锁定间距控件 / follow point 像素
// 运行: node verifier/v45/cdp-v45.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9376;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v45-'));
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
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });
}
async function drag(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0);
  await sleep(80);
  await mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2);
  await sleep(80);
  await mouse('mouseMoved', x1, y1);
  await sleep(80);
  await mouse('mouseReleased', x1, y1);
  await sleep(250);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 布景: 单红线 1000/500, divisor 4; c1@1000(nc) c2@1500 c3@2000 c4@3000 c5@5000(nc)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.beatDivisor = 4; s.beatmap.editor.distanceSpacing = 1; s.beatmap.editor.timelineZoom = 1;
      s.gridSpacing = 256; // v56 起网格线始终显示 (lazer): 用稀疏网格避免探针压线
      s.beatmap.hitObjects = [
        { id: 98001, type: 'circle', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98002, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98003, type: 'circle', x: 300, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98004, type: 'circle', x: 400, y: 100, time: 3000, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98005, type: 'circle', x: 256, y: 300, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0 },
      ];
      s.tool = 'select';
      s.clearSelection();
      s.seek(1600);
      s.emit();
      // 游玩区画布 (最大那块) 指定 osu 坐标处的 5x5 区域最高亮度
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        if (!p) return 'no-map';
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5).data;
        let mx = 0;
        for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i] + d[i + 1] + d[i + 2]);
        return mx;
      };
      // 上方时间轴 canvas 的 client 坐标换算 (win=6000/zoom)
      window.__tlRect = () => {
        const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      };
      window.__tlX = (ms) => {
        const s = window.__osuStore;
        const r = window.__tlRect();
        const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
        const t0 = s.currentTime - win / 2;
        return r.left + ((ms - t0) / win) * r.width;
      };
      window.__sel = () => [...window.__osuStore.selected].sort((a, b) => a - b).join(',');
      window.__panelText = () => {
        const ds = [...document.querySelectorAll('div')].filter(d => d.textContent.includes('Prev:') && d.textContent.includes('Next:'));
        if (!ds.length) return 'no-panel';
        return ds.sort((a, b) => a.textContent.length - b.textContent.length)[0].textContent;
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 左右键按节拍移动 (lazer EditorClock.seek, 步长 125ms)');
  const key = (k, shift) => evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', shiftKey: ${shift} })); window.__osuStore.currentTime`);
  const t1 = await key('ArrowRight', false);
  assert(t1 === 1625, `1600 ->(右) 1625 吸附网格 (实际 ${t1})`);
  const t2 = await key('ArrowLeft', false);
  assert(t2 === 1500, `1625 ->(左) 1500 (实际 ${t2})`);
  const t3 = await key('ArrowRight', true);
  assert(t3 === 2000, `1500 ->(Shift+右, 4 拍) 2000 (实际 ${t3})`);
  await evalJs('window.__osuStore.seek(1600); "ok"');

  console.log('== B) 游玩区框选只选当前可见物件 (1600ms: c2/c3 可见, c1 已消失, c4/c5 未出现)');
  {
    const a = await evalJs('window.__osuToClient(0, 0)');
    const b = await evalJs('window.__osuToClient(512, 384)');
    await drag(a.x + 1, a.y + 1, b.x - 1, b.y - 1);
    const sel = await evalJs('window.__sel()');
    assert(sel === '98002,98003', `全区域框选 = [c2,c3] 不含全时间物件 (实际 [${sel}])`);
  }

  console.log('== C) 时间轴物件行框选 ([1700,2400]ms -> 仅 c3@2000)');
  {
    const r = await evalJs('window.__tlRect()');
    const x0 = await evalJs('window.__tlX(1700)');
    const x1 = await evalJs('window.__tlX(2400)');
    await drag(x0, r.top + 30, x1, r.top + 30);
    const sel = await evalJs('window.__sel()');
    assert(sel === '98003', `时间轴框选 = [c3] (实际 [${sel}])`);
  }
  console.log('== C2) 时间轴单击空白: 清空选区, v79 起不再 seek');
  {
    const before = await evalJs('window.__osuStore.currentTime');
    const r = await evalJs('window.__tlRect()');
    const x = await evalJs('window.__tlX(2400)');
    await mouse('mousePressed', x, r.top + 30);
    await sleep(80);
    await mouse('mouseReleased', x, r.top + 30);
    await sleep(250);
    const sel = await evalJs('window.__sel()');
    const now = await evalJs('window.__osuStore.currentTime');
    assert(sel === '', `单击清空选区 (实际 [${sel}])`);
    assert(Math.abs(now - before) < 2, `单击不再 seek, 时间保持 ${before} (实际 ${now})`);
  }

  console.log('== D) 选区信息面板 (x/y + Prev/Next, 锁定间距同单位)');
  {
    await evalJs('window.__osuStore.select([98002]); "ok"');
    await sleep(300);
    const txt = await evalJs('window.__panelText()');
    assert(txt.includes('x:200 y:100'), `面板坐标 x:200 y:100 (实际 "${txt}")`);
    assert(txt.includes('Prev: 1.00x'), `Prev 1.00x (实际 "${txt}")`);
    assert(txt.includes('Next: 1.00x'), `Next 1.00x (实际 "${txt}")`);
    await evalJs('window.__osuStore.clearSelection(); "ok"');
  }

  console.log('== E) 锁定间距滑条/输入框写回 distanceSpacing');
  {
    await evalJs(`
      (() => {
        const inp = document.querySelector('[data-ds-input="number"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '2');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()
    `);
    await sleep(200);
    const ds = await evalJs('window.__osuStore.beatmap.editor.distanceSpacing');
    assert(ds === 2, `数字输入写回 distanceSpacing=2 (实际 ${ds})`);
    const rangeVal = await evalJs(`document.querySelector('[data-ds-input="range"]').value`);
    assert(parseFloat(rangeVal) === 2, `滑条与数字输入联动 (实际 ${rangeVal})`);
    // 单位联动: DS=2 时同一间距显示 0.50x
    await evalJs('window.__osuStore.select([98002]); "ok"');
    await sleep(300);
    const txt2 = await evalJs('window.__panelText()');
    assert(txt2.includes('Prev: 0.50x'), `DS=2 后 Prev 显示 0.50x (实际 "${txt2}")`);
    await evalJs(`
      (() => {
        window.__osuStore.clearSelection();
        const inp = document.querySelector('[data-ds-input="number"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '1');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()
    `);
    await sleep(200);
  }

  console.log('== F) follow point 像素 (c2->c3 间距 100px: 单点在 x=248)');
  {
    await evalJs('window.__osuStore.seek(1700); "ok"'); // c2->c3 点 fadeOut=1740 前, 已滑入到位
    await sleep(400);
    const bright = await evalJs('window.__pfPixel(248, 100)');
    assert(typeof bright === 'number' && bright > 300, `c2->c3 中点处有 follow point (亮度 ${bright})`);
    const dark = await evalJs('window.__pfPixel(250, 250)');
    assert(typeof dark === 'number' && dark < 150, `空白区无 follow point (亮度 ${dark})`);
    // newCombo 断链: c3 设为 newCombo 后 c2->c3 连线消失
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.beatmap.hitObjects.find(o => o.id === 98003).newCombo = true;
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(300);
    const broken = await evalJs('window.__pfPixel(248, 100)');
    assert(typeof broken === 'number' && broken < 150, `c3 newCombo 后 c2->c3 follow point 消失 (亮度 ${broken})`);
    // c1->c2 仍连着 (fadeOut=1240 淡出中, alpha~0.42)
    const still = await evalJs('window.__pfPixel(148, 100)');
    assert(typeof still === 'number' && still > 150, `c1->c2 follow point 仍在 (亮度 ${still})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V45_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V45_CDP_PASSED');

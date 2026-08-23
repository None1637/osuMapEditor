// CDP v74 端到端: 手绘滑条四项
// A) 一键手绘: 空白处按下即放头, 保持按住直接拖 => 'B4' 滑条 (无需先抬头放头)
// B) 单击放头语义不回归: 按下即松开 => 仅头部 (不加点不切红), 再单击 => 第二点
// C) 手绘拖过上方时间轴: 不 seek (currentTime 不变), 笔画持续采样 (滑条照常生成)
// D) 手绘预览: 控制点间有白线连着 (弦上采样到白色像素)
// 运行: node verifier/v74/cdp-v74.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9409;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v74-'));
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
async function mouse(type, osuX, osuY, opts = {}) {
  const c = await evalJs(`window.__osuToClient(${osuX}, ${osuY})`);
  await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', buttons: type === 'mouseMoved' ? 1 : 0, clickCount: 1, ...opts });
}
const down = (x, y) => mouse('mousePressed', x, y);
const move = (x, y) => mouse('mouseMoved', x, y);
const up = (x, y) => mouse('mouseReleased', x, y);
async function click(x, y) { await down(x, y); await sleep(60); await up(x, y); await sleep(150); }
async function drawPath(fn, steps) {
  const p0 = fn(0);
  await down(p0.x, p0.y);
  for (let i = 1; i <= steps; i++) { const p = fn(i / steps); await move(p.x, p.y); await sleep(15); }
  const pe = fn(1);
  await up(pe.x, pe.y);
  await sleep(350);
}
const clearAll = () => evalJs(`
  window.__osuStore.beatmap.hitObjects = [];
  window.__osuStore.pendingSlider = [];
  window.__osuStore.clearSelection();
  window.__osuStore.emit(); "ok"
`);

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
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'slider';
      s.seek(1000);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== B) 单击放头语义: 按下即松开 => 仅头部 (不加点不切红)');
  {
    await click(200, 150);
    const r = await evalJs(`[window.__osuStore.pendingSlider.length, !!window.__osuStore.pendingSlider[0]?.redAnchor, window.__osuStore.beatmap.hitObjects.length]`);
    assert(r[0] === 1 && r[2] === 0, `单击 => 仅头部 (实际 pending=${r[0]}, objects=${r[2]})`);
    assert(r[1] === false, '头部未被切红 (isHead 候选松开不切红)');
    await click(320, 150);
    const n = await evalJs(`window.__osuStore.pendingSlider.length`);
    assert(n === 2, `第二次单击 => 第二点 (实际 pending=${n})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== A) 一键手绘: 空白处按下即放头, 续拖直接进手绘 => B4');
  {
    const wave = t => ({ x: 40 + t * 400, y: 200 + Math.sin(t * Math.PI * 4) * 50 });
    await drawPath(wave, 50); // 无事先 click 放头
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      return o ? [o.curveType, window.__osuStore.pendingSlider.length, o.x, o.y] : null;
    })()`);
    assert(r !== null && r[0] === 'B4', `一次按压拖出 B4 滑条 (实际 ${JSON.stringify(r)})`);
    assert(r[1] === 0, 'pending 已清空');
    assert(Math.abs(r[2] - 40) <= 1 && Math.abs(r[3] - 200) <= 1, `头部 = 按下点 (${r?.[2]},${r?.[3]})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== C) 手绘拖过上方时间轴: 不 seek, 笔画不中断');
  {
    await evalJs(`window.__osuStore.seek(1000); "ok"`);
    // 从游玩区上沿 (100,40) 向上拖出画布越过时间轴 (y=-90), 再拉回游玩区
    const dive = t => (t < 0.3
      ? { x: 100 + t / 0.3 * 40, y: 40 - t / 0.3 * 130 }
      : { x: 140 + (t - 0.3) / 0.7 * 160, y: -90 + (t - 0.3) / 0.7 * 220 });
    await drawPath(dive, 40);
    const r = await evalJs(`[window.__osuStore.currentTime, window.__osuStore.beatmap.hitObjects.length]`);
    assert(Math.abs(r[0] - 1000) < 1, `拖过时间轴不 seek (currentTime=${r[0]})`);
    assert(r[1] === 1, `笔画跨出画布持续采样, 滑条照常生成 (objects=${r[1]})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== D) 手绘预览: 控制点间白线连接 (弦上白色像素)');
  {
    const wave = t => ({ x: 60 + t * 380, y: 200 + Math.sin(t * Math.PI * 3) * 60 });
    // 拖到一半停住 (保持按住), 读 pendingSlider 控制点弦上的像素
    await down(wave(0).x, wave(0).y);
    for (let i = 1; i <= 25; i++) { const p = wave(i / 50); await move(p.x, p.y); await sleep(15); }
    await sleep(250);
    const r = await evalJs(`
      (() => {
        const pend = window.__osuStore.pendingSlider;
        if (pend.length < 3) return { err: 'pending=' + pend.length };
        const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
        if (!c) return { err: 'no canvas' };
        const g = c.getContext('2d');
        const rect = c.getBoundingClientRect();
        const kx = c.width / rect.width, ky = c.height / rect.height;
        const a = pend[1], b = pend[2]; // 内部控制点弦 (避开端点手柄)
        let white = 0, samples = 0;
        for (let i = 2; i <= 8; i++) {
          const t = i / 10;
          const ox = a.x + (b.x - a.x) * t, oy = a.y + (b.y - a.y) * t;
          const cl = window.__osuToClient(ox, oy);
          const dx = Math.round((cl.x - rect.left) * kx), dy = Math.round((cl.y - rect.top) * ky);
          const d = g.getImageData(dx, dy, 1, 1).data;
          samples++;
          if (d[0] > 110 && d[1] > 110 && d[2] > 110) white++;
        }
        return { white, samples, pend: pend.length };
      })()
    `);
    assert(!r.err, `预览就绪 (${r.err ?? 'ok'})`);
    assert(r.white >= 2, `弦上采样到白色连线像素 (${r.white}/${r.samples}, pend=${r.pend})`);
    // 收尾: 拖完松开
    for (let i = 26; i <= 50; i++) { const p = wave(i / 50); await move(p.x, p.y); await sleep(10); }
    await up(wave(1).x, wave(1).y);
    await sleep(300);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 1, '松开建滑条');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V74_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V74_CDP_PASSED');

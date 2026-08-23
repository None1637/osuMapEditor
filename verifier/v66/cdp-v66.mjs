// CDP v66 端到端: 手绘滑条 — 拖动画弧 => P 三点 / 直线 => B 两点 / L 形 => B 红锚点分段 / 单击放点不回归
// 运行: node verifier/v66/cdp-v66.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9401;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v66-'));
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
/** 拖动手绘: 从 fn(0) 按下, 沿 fn(t) 拖动, 末尾松开 */
async function drawPath(fn, steps) {
  const p0 = fn(0);
  await down(p0.x, p0.y);
  for (let i = 1; i <= steps; i++) { const p = fn(i / steps); await move(p.x, p.y); await sleep(25); }
  const pe = fn(1);
  await up(pe.x, pe.y);
  await sleep(350);
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4;
      s.distanceLock = false;
      s.gridSnap = false;
      s.tool = 'slider';
      s.seek(1000);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) 手绘四分之一圆弧 => P 三点滑条');
  {
    await click(200, 150); // 放头部 = 弧起点 (lazer 真实用法: 从头部起笔拖出)
    assert(await evalJs(`window.__osuStore.pendingSlider.length`) === 1, '头部已放');
    // 圆心 (200,200) 半径 50: (200,150) -> (250,200), 按下点在头部 (候选机制, 拖动即进 Drawing)
    await drawPath(t => {
      const th = -Math.PI / 2 + t * Math.PI / 2;
      return { x: 200 + 50 * Math.cos(th), y: 200 + 50 * Math.sin(th) };
    }, 25);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      return o ? [o.type, o.curveType, o.curvePoints.length, o.length, o.time, o.x, o.y] : null;
    })()`);
    assert(r !== null && r[0] === 'slider' && r[1] === 'P' && r[2] === 2,
      `生成 P 滑条 (3 控制点) (实际 ${JSON.stringify(r)})`);
    assert(r[3] > 55 && r[3] < 100, `长度 ≈ 弧长 78.5 (实际 ${r[3]})`);
    assert(r[4] === 1000 && Math.abs(r[5] - 200) <= 1 && Math.abs(r[6] - 150) <= 1, '时间吸附/头部位置');
    assert(await evalJs(`window.__osuStore.pendingSlider.length`) === 0, 'pending 清空');
    await evalJs(`window.__osuStore.undo(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 0, '一次 undo 撤销');
  }

  console.log("== B) 手绘直线 => B4 两点滑条 (v74: 落盘 'B4')");
  {
    await click(120, 300);
    await drawPath(t => ({ x: 120 + t * 200, y: 300 }), 20);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      return o ? [o.curveType, o.curvePoints.length, o.length] : null;
    })()`);
    assert(r !== null && r[0] === 'B4' && r[1] === 1, `直线 => B4 2 控制点 (实际 ${JSON.stringify(r)})`);
    assert(r[2] > 180 && r[2] < 220, `长度 ≈ 200 (实际 ${r[2]})`);
    await evalJs(`window.__osuStore.undo(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
  }

  console.log("== C) 手绘 L 形 => B4 红锚点分段 (连续重复点)");
  {
    await click(100, 100);
    await drawPath(t => (t < 0.5 ? { x: 100 + t * 2 * 120, y: 100 } : { x: 220, y: 100 + (t - 0.5) * 2 * 120 }), 40);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      if (!o) return null;
      const pts = [{ x: o.x, y: o.y }, ...o.curvePoints];
      let dup = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].x === pts[i-1].x && pts[i].y === pts[i-1].y) dup++;
      return [o.curveType, o.curvePoints.length, dup];
    })()`);
    assert(r !== null && r[0] === 'B4' && r[2] === 1, `拐角 => 红锚点重复对 (实际 ${JSON.stringify(r)})`);
    await evalJs(`window.__osuStore.undo(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
  }

  console.log('== D) 单击放点不回归 (未超阈值 = 普通控制点)');
  {
    await click(300, 100); // 头部
    await click(350, 100); // 第二点 (按下即松开, 无拖动)
    const n = await evalJs(`window.__osuStore.pendingSlider.length`);
    assert(n === 2, `单击仍为放点 (实际 pending=${n})`);
    await evalJs(`[...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'))
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); "ok"`);
    await sleep(250);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      return o ? [o.curveType, o.curvePoints.length, o.length] : null;
    })()`);
    assert(r !== null && r[0] === 'L' && r[1] === 1 && r[2] >= 45 && r[2] <= 55, `双击完成 => L 直线 (实际 ${JSON.stringify(r)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V66_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V66_CDP_PASSED');

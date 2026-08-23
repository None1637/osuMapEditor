// CDP v73 端到端: 手绘滑条落盘对齐 lazer
// (v74 语义更新: 落盘 'B4' 保留 builder 原始控制点 — 长笔画 => 'B4' 少控制点, 页内 Cox-de Boor 采样验证路径贴合轨迹)
// A/B) 长波浪笔画 => 'B4' 且控制点少 (<=15), 路径贴合鼠标轨迹 (<5px)
// C) 弧+拐角+直线 => 'B4', 弧段保留 B 样条控制点, 路径仍贴合
// 运行: node verifier/v73/cdp-v73.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9408;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v73-'));
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
async function drawPath(fn, steps) {
  const p0 = fn(0);
  await down(p0.x, p0.y);
  for (let i = 1; i <= steps; i++) { const p = fn(i / steps); await move(p.x, p.y); await sleep(15); }
  const pe = fn(1);
  await up(pe.x, pe.y);
  await sleep(350);
}

// 页内 'B4' (clamped 均匀 B 样条, 重复点分段) Cox-de Boor 采样 + 偏差计算 (一次注入)
const PATH_HELPERS = `
  window.__b4Path = (pts) => {
    const segs = []; let seg = [];
    for (const p of pts) {
      if (seg.length && p.x === seg[seg.length-1].x && p.y === seg[seg.length-1].y) { segs.push(seg); seg = []; }
      seg.push(p);
    }
    if (seg.length) segs.push(seg);
    const out = [];
    for (const s of segs) {
      const n = s.length;
      if (n < 2) { out.push(...s); continue; }
      const d = Math.min(4, n - 1);
      const knots = [];
      for (let i = 0; i <= n + d; i++) knots.push(i < d ? 0 : i > n ? 1 : (i - d) / (n - d));
      const basis = (i, k, t) => {
        if (k === 0) return (t >= knots[i] && t < knots[i+1]) || (t === 1 && knots[i+1] === 1 && i === n - 1) ? 1 : 0;
        let v = 0;
        const d1 = knots[i+k] - knots[i], d2 = knots[i+k+1] - knots[i+1];
        if (d1 > 0) v += (t - knots[i]) / d1 * basis(i, k-1, t);
        if (d2 > 0) v += (knots[i+k+1] - t) / d2 * basis(i+1, k-1, t);
        return v;
      };
      for (let q = 0; q <= 120; q++) {
        const t = q / 120;
        let x = 0, y = 0;
        for (let i = 0; i < n; i++) { const b = basis(i, d, t); x += b * s[i].x; y += b * s[i].y; }
        if (!out.length || Math.hypot(x - out[out.length-1].x, y - out[out.length-1].y) > 0.3) out.push({ x, y });
      }
    }
    return out;
  };
  window.__maxDev = (P, Q) => {
    const d2s = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx*dx + dy*dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / l2));
      return Math.hypot(p.x - (a.x + dx*t), p.y - (a.y + dy*t));
    };
    let max = 0;
    for (const p of P) {
      let min = Infinity;
      for (let i = 0; i < Q.length - 1; i++) min = Math.min(min, d2s(p, Q[i], Q[i+1]));
      if (min > max) max = min;
    }
    return max;
  };
  "ok"
`;

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
  await evalJs(PATH_HELPERS);
  await sleep(300);

  console.log('== A/B) 长波浪笔画 => B4 少控制点, 路径贴合轨迹');
  {
    const wave = t => ({ x: 30 + t * 450, y: 192 + Math.sin(t * Math.PI * 5) * 50 });
    await drawPath(wave, 60); // v74: 按下即放头, 一次按压拖完
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      if (!o) return null;
      return [o.curveType, o.curvePoints.length + 1];
    })()`);
    assert(r !== null && r[0] === 'B4', `生成 B4 滑条 (实际 ${JSON.stringify(r)})`);
    assert(r[1] <= 15, `控制点少 (= builder 原始输出, 非贝塞尔锚点膨胀) (实际 ${r?.[1]} 个)`);
    const dev = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      const path = window.__b4Path([{ x: o.x, y: o.y }, ...o.curvePoints]);
      const draw = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        draw.push({ x: 30 + t * 450, y: 192 + Math.sin(t * Math.PI * 5) * 50 });
      }
      return window.__maxDev(draw, path);
    })()`);
    assert(dev !== null && dev < 5, `B4 路径贴合手绘轨迹 (最大偏差 ${dev?.toFixed(2)}px)`);
    await evalJs(`window.__osuStore.beatmap.hitObjects = []; window.__osuStore.emit(); "ok"`);
    await sleep(200);
  }

  console.log('== C) 弧+拐角+直线 => B4 弧段保留控制点, 路径贴合');
  {
    const shape = t => {
      if (t < 0.5) {
        const th = -Math.PI / 2 + (t * 2) * Math.PI / 2;
        return { x: 150 + 50 * Math.cos(th), y: 220 + 50 * Math.sin(th) };
      }
      return { x: 200 + (t - 0.5) * 2 * 150, y: 220 };
    };
    await drawPath(shape, 60);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      if (!o) return null;
      return [o.curveType, o.curvePoints.length + 1];
    })()`);
    assert(r !== null && r[0] === 'B4', `生成 B4 滑条 (实际 ${JSON.stringify(r)})`);
    const dev = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      const path = window.__b4Path([{ x: o.x, y: o.y }, ...o.curvePoints]);
      const mk = (lo, hi) => {
        const draw = [];
        for (let i = 0; i <= 120; i++) {
          const t = i / 120;
          if (t < lo || t > hi) continue;
          if (t < 0.5) {
            const th = -Math.PI / 2 + (t * 2) * Math.PI / 2;
            draw.push({ x: 150 + 50 * Math.cos(th), y: 220 + 50 * Math.sin(th) });
          } else draw.push({ x: 200 + (t - 0.5) * 2 * 150, y: 220 });
        }
        return window.__maxDev(draw, path);
      };
      return [mk(0, 0.45), mk(0, 1)]; // [弧段主体, 全程(含拐角平滑区)]
    })()`);
    assert(dev !== null && dev[0] < 3, `弧段主体贴合 (最大偏差 ${dev?.[0].toFixed(2)}px)`);
    assert(dev !== null && dev[1] < 8, `全程贴合 (拐角检测窗口平滑允许更大偏差) (最大偏差 ${dev?.[1].toFixed(2)}px)`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V73_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V73_CDP_PASSED');

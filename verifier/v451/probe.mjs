// v451 诊断探针 (一次性, 非门槛用例): 同 check.mjs 复现流程, 但在拖拽#2 中途截图头部区域 PNG
// 用法: node verifier/v451/probe.mjs <outPrefix>   (修复前/后各跑一次对比)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9467;
const OUT = process.argv[2] || 'probe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };

const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
try {
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  await normalizeEnv(evalJs);
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evalJs(`(() => { const s = window.__osuStore; return !!(s.beatmap && s.beatmap.hitObjects.length > 700); })()`)) break;
  }
  // 固定用 #1876 (check.mjs 里跑通的那条): 找它的第一段
  const c = await evalJs(`(() => {
    const s = window.__osuStore; const bm = s.beatmap;
    const cv = document.querySelector('canvas.cursor-crosshair');
    const r = cv.getBoundingClientRect();
    const sl = bm.hitObjects.find(o => o.id === 1876) ?? bm.hitObjects.filter(o => o.type === 'slider' && (o.curveType ?? '') === 'L' && (o.curvePoints?.length ?? 0) >= 1)[0];
    const head = window.__osuToClient(sl.x, sl.y);
    return { id: sl.id, time: sl.time, segI: 0, hx: sl.x, hy: sl.y, headX: head.x, headY: head.y, canvasTop: r.top };
  })()`);
  console.log('probe 滑条', JSON.stringify(c));
  const grabNow = `(() => {
    const o = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${c.id});
    const ctrls = [{ x: o.x, y: o.y }, ...o.curvePoints];
    const a = ctrls[${c.segI}], b = ctrls[${c.segI} + 1];
    return window.__osuToClient((a.x + b.x) / 2, (a.y + b.y) / 2);
  })()`;
  const shot = async (tag) => {
    const dataUrl = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${c.id});
      const cv = document.querySelector('canvas.cursor-crosshair');
      const p = window.__osuToCanvas(o.x, o.y);
      const t = document.createElement('canvas');
      t.width = 400; t.height = 400;
      const g = t.getContext('2d');
      const sx = Math.max(0, Math.round(p.x) - 200), sy = Math.max(0, Math.round(p.y) - 220);
      g.drawImage(cv, sx, sy, 400, 400, 0, 0, 400, 400);
      // 标出画布顶边 (红线) 与头中心 (绿点)
      g.fillStyle = '#0f0'; g.fillRect(200 - 3 + (p.x - sx - (p.x - sx)), 0, 0, 0);
      return { url: t.toDataURL('image/png'), headX: p.x - sx, headY: p.y - sy, sy };
    })()`);
    fs.writeFileSync(path.join(root, 'verifier/v451', `${OUT}-${tag}.png`), Buffer.from(dataUrl.url.split(',')[1], 'base64'));
    console.log(`  shot ${tag}: head 在裁图内 (${Math.round(dataUrl.headX)},${Math.round(dataUrl.headY)})`);
  };

  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${c.time} + 5); s.setLimitToPlayfield(false); s.selected.clear(); s.emitSelection(); })()`);
  await sleep(250);
  const g0 = await evalJs(grabNow);
  const upDist = Math.round(c.headY - 12);
  await mouse('mousePressed', g0.x, g0.y);
  await sleep(120);
  if (!await evalJs(`window.__dragState`)) throw new Error('probe: 拖拽#1 未抓起');
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', g0.x, g0.y - (upDist * i) / 8); await sleep(90); }
  await mouse('mouseReleased', g0.x, g0.y - upDist);
  await sleep(500);
  await shot('up'); // 头在屏外 (画布顶上方)
  await evalJs(`(() => { const s = window.__osuStore; s.selected.clear(); s.emitSelection(); })()`);
  const g1 = await evalJs(grabNow);
  await mouse('mousePressed', g1.x, g1.y);
  await sleep(120);
  await mouse('mouseMoved', g1.x, g1.y + 8); await sleep(90);
  await mouse('mouseMoved', g1.x, g1.y + 16); await sleep(90);
  for (let i = 3; i <= 10; i++) { await mouse('mouseMoved', g1.x, g1.y + (upDist * i) / 10); await sleep(90); }
  await shot('during'); // 拖回原位但鼠标未松 — 关键帧
  await mouse('mouseReleased', g1.x, g1.y + upDist);
  await sleep(600);
  await shot('after');
} finally {
  await killIsolated(proc, profile);
}
console.log('done');

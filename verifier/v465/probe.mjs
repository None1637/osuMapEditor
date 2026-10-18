// v465 probe: 定位 note 头圆实际渲染位置
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9497;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { }
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
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);
  await sleep(500);
  const r = await evalJs(`(async () => {
    const store = window.__osuStore;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const base = store.beatmap;
    const red0 = base.timingPoints.find(p => p.uninherited);
    const SM = base.difficulty.sliderMultiplier;
    const t1 = Math.round(red0.time + red0.beatLength * 8);
    const t2 = t1 + red0.beatLength;
    const slider = { id: 965001, type: 'slider', x: 200, y: 200, time: t1, newCombo: false, comboSkip: 0,
      hitSound: 0, curveType: 'L', curvePoints: [{ x: 320, y: 200 }], slides: 1, length: 100 * SM };
    const cvs = [...document.querySelectorAll('canvas')].map(c => {
      const r = c.getBoundingClientRect();
      return { cls: c.className, x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height };
    });
    const cv = [...document.querySelectorAll('canvas')].filter(c => c.className.includes('h-[92px]'))[0];
    const rect = cv.getBoundingClientRect();
    const cssW = rect.width;
    const deltaT = Math.max(2, Math.round(30 * 6000 / cssW));
    const tN = t2 + deltaT;
    const note = { id: 965002, type: 'circle', x: 400, y: 300, time: tN, newCombo: true, comboSkip: 0, hitSound: 0 };
    store.load({ ...base, timingPoints: [{ ...red0 }],
      colors: { ...base.colors, combos: ['#FF69B4', '#46B4FF'] },
      editor: { ...base.editor, timelineZoom: 1 },
      hitObjects: [slider, note] }, store.audioUrl);
    store.pause && store.pause(); store.tool = 'select'; store.clearSelection();
    store.seek(t2);
    await sleep(700);
    const g = cv.getContext('2d');
    const ratio = cv.width / rect.width;
    const xOf = (t) => (t - (t2 - 3000)) / 6000 * cssW;
    const pick = (fx, fy) => [...g.getImageData(Math.round(fx * ratio), Math.round(fy * ratio), 1, 1).data].slice(0, 3);
    // 横扫 y=30 一行, 每 5px 采样, 找蓝色像素簇
    const row = [];
    for (let px = 0; px < cssW; px += 5) {
      const [R, G, B] = pick(px, 30);
      if (B > R + 30) row.push(px);
    }
    // 纵扫 note 理论 x 处整列
    const col = [];
    const xN = xOf(tN);
    for (let py = 0; py < rect.height; py += 3) {
      const [R, G, B] = pick(xN, py);
      if (B > R + 30) col.push(py);
    }
    // 粗色图: x 1100-1320, y 0-60, 每 4px 一格; P=粉 B=蓝 W=白 .=其他
    const map = [];
    for (let py = 2; py <= 58; py += 4) {
      let line = '';
      for (let px = 1100; px <= 1320; px += 4) {
        const [R, G, B] = pick(px, py);
        line += (R > 150 && R > B + 40) ? 'P' : (B > R + 40 && B > 120) ? 'B' : (R > 200 && G > 200 && B > 200) ? 'W' : '.';
      }
      map.push('y' + String(py).padStart(2, ' ') + ' ' + line);
    }
    const png = cv.toDataURL('image/png');
    return {
      cur: store.currentTime, t2, tN, deltaT, cssW, ratio,
      objs: store.beatmap.hitObjects.map(o => o.id + ':' + o.type + '@' + o.time + ' nc=' + o.newCombo),
      zoom: store.beatmap.editor.timelineZoom,
      noteCenter: pick(xN, 30), tailCenter: pick(xOf(t2), 30),
      xTail: xOf(t2), xNote: xN,
      png: png.slice(0, 100), pngLen: png.length,
      pngFull: png,
    };
  })()`);
  const { pngFull, ...rest } = r;
  console.log(JSON.stringify(rest, null, 1));
  if (pngFull) {
    const fs = await import('fs');
    fs.writeFileSync(path.join(root, 'verifier/v465/_probe.png'), Buffer.from(pngFull.split(',')[1], 'base64'));
    console.log('saved verifier/v465/_probe.png');
  }
  ws.close();
} catch (e) {
  console.error('probe 异常:', String(e).slice(0, 500));
} finally {
  await killIsolated(electron, profile);
}

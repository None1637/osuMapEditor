// v463 探针 (一次性): 实测「拉滑条」三条路径在 sliderHalfSnap 两态下的吸附网格
//   A: 点击式放置 (头+尾两点, 右键完成)
//   B: 按住拖动手绘放置 (freehand)
//   C: 时间轴 Alt+拖滑条尾改 SV (v463 修复点)
// 运行: npm run build 后 node verifier/v463/probe.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9493;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('找不到 Electron 页面目标');
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
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient && window.__osuSnap)').catch(() => false);
  }
  if (!ready) throw new Error('应用未就绪');
  await normalizeEnv(evalJs);
  await sleep(800);

  // ---------- A/B: 放置 (点击式 + 手绘), 开关两态 ----------
  const rAB = await evalJs(`(async () => {
    const store = window.__osuStore, snap = window.__osuSnap;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const c = document.querySelector('canvas.cursor-crosshair');
    const rc = c.getBoundingClientRect();
    const fire = (type, x, y, btn = 0) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn, bubbles: true, cancelable: true }));
    const base = store.beatmap;
    const red0 = base.timingPoints.find(p => p.uninherited);
    const T0 = Math.round(red0.time + red0.beatLength * 8);
    const out = {};

    // 归一: 单红线, 无物件, beatSnap=4, 锁定间距关
    const reset = () => {
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider'; store.beatSnap = 4; store.distanceLock = false;
      store.pause && store.pause(); store.seek(T0);
    };
    const sm = base.difficulty.sliderMultiplier;
    const vel = 100 * sm / red0.beatLength; // sv=1
    const tickOff = vel * red0.beatLength / 4;  // 1/4 tick px
    const tickOn = vel * red0.beatLength / 8;   // 1/8 tick px
    const gridOf = (len) => {
      const k4 = len / tickOff, k8 = len / tickOn;
      return { on4: Math.abs(k4 - Math.round(k4)) < 0.06, on8: Math.abs(k8 - Math.round(k8)) < 0.06, len };
    };

    // 用 __osuToClient 精确定位 osu 坐标 → client, 几何 ~65 osu px (1/8 网格 60 与 1/4 网格 40 可分)
    const hc = window.__osuToClient(100, 100);
    const tc = window.__osuToClient(165, 100);
    for (const half of [false, true]) {
      store.setEditorPref('sliderHalfSnap', half);
      // A: 点击式 — 头 (100,100), 尾 (165,100) 右键完成
      reset();
      fire('mousemove', hc.x, hc.y); fire('mousedown', hc.x, hc.y); fire('mouseup', hc.x, hc.y);
      await sleep(60);
      fire('mousemove', tc.x, tc.y); await sleep(120);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: tc.x, clientY: tc.y, button: 2, bubbles: true, cancelable: true }));
      await sleep(120);
      const oA = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
      out['click_' + (half ? 'on' : 'off')] = oA && oA.type === 'slider'
        ? { ...gridOf(oA.length), geo: Math.round(Math.hypot((oA.curvePoints?.[0]?.x ?? oA.x) - oA.x, (oA.curvePoints?.[0]?.y ?? oA.y) - oA.y)), ct: oA.curveType }
        : null;

      // B: 手绘 — 按下头 > 拖 > 松开
      reset();
      fire('mousemove', hc.x, hc.y); fire('mousedown', hc.x, hc.y);
      await sleep(40);
      for (let i = 1; i <= 10; i++) { const p = window.__osuToClient(100 + i * 6.5, 100); fire('mousemove', p.x, p.y); await sleep(16); }
      fire('mouseup', tc.x, tc.y);
      await sleep(150);
      const oB = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
      out['freehand_' + (half ? 'on' : 'off')] = oB && oB.type === 'slider' ? { ...gridOf(oB.length), ct: oB.curveType } : null;
    }
    store.setEditorPref('sliderHalfSnap', false);
    return { ...out, vel, tickOff, tickOn };
  })()`);
  console.log('A/B 放置:', JSON.stringify(rAB, null, 1));

  // ---------- C: Alt 拖时间轴滑条尾改 SV, 开关两态 ----------
  const rC = await evalJs(`(async () => {
    const store = window.__osuStore;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const base = store.beatmap;
    const red0 = base.timingPoints.find(p => p.uninherited);
    const t = Math.round(red0.time + red0.beatLength * 8);
    const mk = { id: 964001, type: 'slider', x: 100, y: 100, time: t,
      newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
      curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 };
    store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk] }, store.audioUrl);
    store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 4;
    store.seek(t + 200); store.select([964001]);
    const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
    const r = c.getBoundingClientRect();
    const win = 6000 / (base.editor.timelineZoom || 1);
    const vel = 100 * base.difficulty.sliderMultiplier / red0.beatLength;
    const endMs0 = t + 200 / vel;
    const out = {};
    for (const half of [false, true]) {
      store.setEditorPref('sliderHalfSnap', half);
      // 目标尾时间: 距头 3 个 1/8 tick (奇数倍, 不在 1/4 网格)
      const tick8 = red0.beatLength / 8;
      const target = t + 3 * tick8;
      const t0w = store.currentTime - win / 2;
      const x0 = r.left + ((endMs0 - t0w) / win) * r.width, y = r.top + 10;
      const x1 = r.left + ((target - t0w) / win) * r.width;
      const greens0 = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: x0, clientY: y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: x1, clientY: y, altKey: true, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: x1, clientY: y, altKey: true, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x1, clientY: y, bubbles: true }));
      await sleep(80);
      const o = store.beatmap.hitObjects.find(x => x.id === 964001);
      const g = store.beatmap.timingPoints.filter(p => !p.uninherited && p.time <= o.time).pop();
      const sv = g ? -100 / g.beatLength : 1;
      const endMs = o.time + o.length / (vel * sv) * o.slides;
      const rel = endMs - red0.time;
      const k4 = rel / (red0.beatLength / 4), k8 = rel / tick8;
      out[half ? 'on' : 'off'] = {
        endMs: Math.round(endMs * 10) / 10, target,
        on4: Math.abs(k4 - Math.round(k4)) < 0.05, on8: Math.abs(k8 - Math.round(k8)) < 0.05,
        greens: store.beatmap.timingPoints.filter(p => !p.uninherited).length - greens0,
      };
      // 还原: 清掉绿线, 尾时间/折返复位 (下轮从同一初态拖)
      store.load({ ...store.beatmap, timingPoints: [{ ...red0 }] }, store.audioUrl);
      const o2 = store.beatmap.hitObjects.find(x => x.id === 964001);
      o2.slides = 1; o2.length = 200;
      store.select([964001]); store.seek(t + 200);
      await sleep(60);
    }
    store.setEditorPref('sliderHalfSnap', false);
    return out;
  })()`);
  console.log('C Alt拖尾SV:', JSON.stringify(rC, null, 1));

  ws.close();
} catch (e) {
  console.error('探针异常:', String(e).slice(0, 500));
  process.exitCode = 1;
} finally {
  await killIsolated(electron, profile);
}

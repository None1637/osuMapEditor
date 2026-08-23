// CDP v87 端到端: pattern 内部绿线 (用户场景: 第二个滑条带 0.5x 绿线)
// A) 缩略图 90x90
// B) 收藏含绿线的两滑条 => pattern.greenlines 记录
// C) 移除谱面绿线后, 勾"插入绿线对齐"拖出 => 内部绿线同倍率插入 + 开头对齐 + 结尾还原, 滑条长度正确
// D) 勾"缩放滑条对齐"拖出 => 内部绿线参与缩放 (长度不翻倍)
// 运行: node verifier/v87/cdp-v87.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v87-'));
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function dragTo(sel, tx, ty) {
  const from = await evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!from) throw new Error('元素不存在: ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (from.x + tx) / 2, y: (from.y + ty) / 2, button: 'left', buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 });
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
  await sleep(500);

  // 布景: 120BPM, 500ms 处 0.5x 绿线; 滑条1 (0ms, 140px = 1拍), 滑条2 (500ms, 0.5x 下 70px = 1拍)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        { time: 500, beatLength: -200, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
      ];
      s.beatmap.difficulty.sliderMultiplier = 1.4;
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 100, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 240, y: 100 }], slides: 1, length: 140, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 2, type: 'slider', x: 100, y: 250, time: 500, curveType: 'L', curvePoints: [{ x: 170, y: 250 }], slides: 1, length: 70, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.seek(0);
      s.select([1, 2]);
      s.loadPatternsIfNeeded();
      s.patterns = []; s.patternGroups = [];
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 缩略图 90x90');
  {
    await evalJs(`document.querySelector('[data-pattern-input="panel-toggle"]').click(); "ok"`);
    await sleep(400);
    await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
    await sleep(300);
    const size = await evalJs(`(() => { const c = document.querySelector('[data-pattern-card] canvas'); return c ? [c.width, c.height] : null; })()`);
    assert(size && size[0] === 90 && size[1] === 90, `缩略图 90x90 (实际 ${size})`);
  }

  console.log('== B) pattern 记录内部绿线');
  {
    const p = await evalJs(`window.__osuStore.patterns[0] ?? null`);
    assert(p && p.greenlines && p.greenlines.length === 1 && p.greenlines[0].sv === 0.5 && p.greenlines[0].beatOffset === 1,
      `内部绿线 beat 1 sv=0.5 (实际 ${JSON.stringify(p && p.greenlines)})`);
    assert(p && p.objects[0].beatsLen === 1 && p.objects[1].beatsLen === 1, '两滑条各占 1 拍');
  }

  console.log('== C) 插入绿线对齐: 无绿线谱面拖出 => 内部线 + 对齐 + 还原, 长度正确');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.beatmap.timingPoints = s.beatmap.timingPoints.filter(t => t.uninherited); // 移除 0.5x 绿线
        s.beatmap.hitObjects = [];
        s.clearSelection();
        s.seek(0);
        window.__freeDrop = null;
        for (const [ox, oy] of [[450, 320], [60, 320], [450, 60], [60, 60]]) {
          const c = window.__osuToClient(ox, oy);
          const el = document.elementFromPoint(c.x, c.y);
          if (el && el.className && String(el.className).includes('cursor-crosshair')) { window.__freeDrop = { ox, oy, x: c.x, y: c.y }; break; }
        }
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(300);
    await evalJs(`document.querySelector('[data-pattern-align="greenline"]').click(); "ok"`);
    await sleep(250);
    const drop = await evalJs(`window.__freeDrop`);
    await dragTo('[data-pattern-card]', drop.x, drop.y);
    const objs = await evalJs(`window.__osuStore.beatmap.hitObjects.map(o => ({ t: o.time, len: o.length }))`);
    assert(objs.length === 2 && objs[0].t === 0 && objs[1].t === 500, `落盘 2 滑条 (实际 ${JSON.stringify(objs)})`);
    if (objs.length === 2) {
      assert(Math.abs(objs[0].len - 140) < 0.01 && Math.abs(objs[1].len - 70) < 0.01, `长度 140/70 正确 (实际 ${objs[0].len}/${objs[1].len})`);
    }
    const greens = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => !t.uninherited).map(t => ({ t: t.time, bl: t.beatLength }))`);
    assert(greens.length === 3, `3 条绿线 (实际 ${greens.length}: ${JSON.stringify(greens)})`);
    if (greens.length === 3) {
      assert(greens[0].t === 0 && greens[0].bl === -100, '开头对齐 sv=1');
      assert(greens[1].t === 500 && greens[1].bl === -200, '内部绿线 500ms sv=0.5');
      assert(greens[2].t === 1000 && greens[2].bl === -100, '结尾 1000ms 还原 sv=1');
    }
  }

  console.log('== D) 缩放滑条对齐: 内部绿线参与缩放 (第二滑条不翻倍)');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.beatmap.timingPoints = s.beatmap.timingPoints.filter(t => t.uninherited);
        s.beatmap.hitObjects = [];
        s.clearSelection();
        s.seek(0);
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(250);
    await evalJs(`document.querySelector('[data-pattern-align="scale"]').click(); "ok"`);
    await sleep(250);
    const drop = await evalJs(`window.__freeDrop`);
    await dragTo('[data-pattern-card]', drop.x, drop.y);
    const objs = await evalJs(`window.__osuStore.beatmap.hitObjects.map(o => ({ t: o.time, len: o.length }))`);
    assert(objs.length === 2 && Math.abs(objs[0].len - 140) < 0.01 && Math.abs(objs[1].len - 70) < 0.01,
      `缩放后长度仍 140/70 (实际 ${objs.map(o => o.len)})`);
    const greens = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => !t.uninherited).map(t => ({ t: t.time, bl: t.beatLength }))`);
    assert(greens.length === 1 && greens[0].t === 500 && greens[0].bl === -200,
      `缩放模式仅插内部绿线 (实际 ${JSON.stringify(greens)})`);
    await evalJs(`window.__osuStore.setPatternAlign('none'); "ok"`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V87_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V87_CDP_PASSED');

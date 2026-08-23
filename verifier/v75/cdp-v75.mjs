// CDP v75 端到端: 落盘弧段锚点转换 + Ctrl+G 反转
// A) 点击放置 3 点弧段+红锚点滑条 => 落盘 'B' 且弧段转为贝塞尔锚点 (形状保形, 控制点变多, 段间红锚点保留)
// B) 选中滑条按 Ctrl+G => 头尾互换, length 不变; undo 还原
// C) 单选 circle 按 Ctrl+G => 无操作 (lazer CanReverse)
// D) 双 circle 选中按 Ctrl+G => 时间镜像 + newCombo 保持时序位置 + beatmap 重排序
// 运行: node verifier/v75/cdp-v75.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411; // 9410 被本机其他服务占用

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v75-'));
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
const down = (x, y, o) => mouse('mousePressed', x, y, o);
const up = (x, y, o) => mouse('mouseReleased', x, y, o);
async function click(x, y, opts) { await down(x, y, opts); await sleep(60); await up(x, y, opts); await sleep(150); }
const ctrlClick = (x, y) => click(x, y, { modifiers: 2 });
const keyCtrlG = () => evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true })); "ok"`);
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

  console.log('== A) 3 点弧段+红锚点滑条落盘: 弧段转贝塞尔锚点, 形状保形');
  {
    await click(100, 300);          // 头
    await click(150, 200);          // 弧中点
    await ctrlClick(200, 300);      // 红锚点 (段1 = 3 点弧)
    await click(300, 300);          // 段2 直线
    // 双击末点结束 (e.detail === 2 => finishSlider)
    await down(300, 300, { clickCount: 2 }); await sleep(60); await up(300, 300, { clickCount: 2 });
    await sleep(350);
    const r = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      if (!o) return null;
      const cps = o.curvePoints;
      let pair = -1;
      for (let i = 0; i < cps.length - 1; i++) if (cps[i].x === cps[i+1].x && cps[i].y === cps[i+1].y) { pair = i; break; }
      return { curveType: o.curveType, n: cps.length, x: o.x, y: o.y,
               pairAt: pair, pairPt: pair >= 0 ? [cps[pair].x, cps[pair].y] : null,
               tail: [cps[cps.length-1].x, cps[cps.length-1].y] };
    })()`);
    assert(r !== null && r.curveType === 'B', `落盘 curveType='B' (实际 ${r?.curveType})`);
    // 未转换时控制点应为 4 个 [(150,200),(200,300),(200,300),(300,300)]; 弧段转换后 >= 5
    assert(r.n >= 5, `弧段扩展为贝塞尔锚点 (curvePoints=${r.n} >= 5)`);
    const near = (a, b) => Math.abs(a - b) <= 1; // osu->client->osu 往返 ±1 舍入
    assert(near(r.x, 100) && near(r.y, 300), `头部不动 (${r.x},${r.y})`);
    assert(r.pairAt > 0 && near(r.pairPt[0], 200) && near(r.pairPt[1], 300), `红锚点重复对保留 (位于 ${r.pairAt}, ${r.pairPt})`);
    assert(near(r.tail[0], 300) && near(r.tail[1], 300), `末段尾点不动 (${r.tail})`);

    console.log('== B) Ctrl+G 反转: 头尾互换, undo 还原');
    await evalJs(`window.__osuStore.select([window.__osuStore.beatmap.hitObjects[0].id]); "ok"`);
    await sleep(150);
    const before = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      return { sel: window.__osuStore.selected.has(o.id), x: o.x, y: o.y, len: o.length, n: o.curvePoints.length };
    })()`);
    assert(before.sel, '滑条已选中');
    await keyCtrlG();
    await sleep(250);
    const after = await evalJs(`(() => {
      const o = window.__osuStore.beatmap.hitObjects[0];
      const last = o.curvePoints[o.curvePoints.length - 1];
      return { x: o.x, y: o.y, len: o.length, n: o.curvePoints.length, lastX: last.x, lastY: last.y, time: o.time };
    })()`);
    assert(near(after.x, 300) && near(after.y, 300), `反转后新头 = 旧尾 (${after.x},${after.y})`);
    assert(near(after.lastX, 100) && near(after.lastY, 300), `旧头成为最末控制点 (${after.lastX},${after.lastY})`);
    assert(after.len === before.len && after.n === before.n, 'length 与控制点数不变');
    assert(after.time === 1000, '单滑条时间不变');
    await evalJs(`window.__osuStore.undo(); "ok"`);
    await sleep(250);
    const undone = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[0]; return [o.x, o.y]; })()`);
    assert(near(undone[0], 100) && near(undone[1], 300), `undo 还原头部 (${undone})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== C) 单选 circle 按 Ctrl+G => 无操作');
  {
    await evalJs(`window.__osuStore.tool = 'circle'; window.__osuStore.seek(1000); window.__osuStore.emit(); "ok"`);
    await click(256, 192);
    await evalJs(`window.__osuStore.select([window.__osuStore.beatmap.hitObjects[0].id]); "ok"`);
    await sleep(150);
    const before = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[0]; return [o.time, o.x, o.y, window.__osuStore.selected.size]; })()`);
    await keyCtrlG();
    await sleep(200);
    const after = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[0]; return [o.time, o.x, o.y]; })()`);
    assert(before[3] === 1 && JSON.stringify(before.slice(0, 3)) === JSON.stringify(after), `单 circle 无操作 (${before} -> ${after})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== D) 双 circle Ctrl+G => 时间镜像 + newCombo 保持时序位置');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.addObject({ id: 9001, type: 'circle', x: 100, y: 100, time: 1000, newCombo: true, comboSkip: 0, hitSound: 0 });
        s.addObject({ id: 9002, type: 'circle', x: 300, y: 100, time: 2000, newCombo: false, comboSkip: 0, hitSound: 0 });
        s.select([9001, 9002]);
        return 'ok';
      })()
    `);
    await sleep(200);
    await keyCtrlG();
    await sleep(250);
    const r = await evalJs(`
      (() => {
        const objs = window.__osuStore.beatmap.hitObjects;
        return objs.map(o => ({ id: o.id, time: o.time, nc: o.newCombo }));
      })()
    `);
    assert(r[0].id === 9002 && r[0].time === 1000 && r[0].nc === true, `时间 1000 处 = 原 2000 物件, newCombo=true 留在时序位置 (${JSON.stringify(r[0])})`);
    assert(r[1].id === 9001 && r[1].time === 2000 && r[1].nc === false, `时间 2000 处 = 原 1000 物件, newCombo=false (${JSON.stringify(r[1])})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V75_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V75_CDP_PASSED');

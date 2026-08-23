// CDP v55 端到端: 物件吸附 (放置/拖拽) + Ctrl+方向键逐 px 移动 + Prev/Next (px) 显示
// 布景: A 单点 (200,100)@1500 + B 单点 (300,200)@1600 + 滑条 (150,300)->(350,300) 尾 (350,300) @2000
// 运行: node verifier/v55/cdp-v55.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9390;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v55-'));
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
const toClient = (ox, oy) => evalJs(`window.__osuToClient(${ox}, ${oy})`);
async function clickOsu(ox, oy) {
  const c = await toClient(ox, oy);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
}
async function dragOsu(fromOsu, toOsuPos) {
  const from = await toClient(fromOsu[0], fromOsu[1]);
  const to = await toClient(toOsuPos[0], toOsuPos[1]);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
  await sleep(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
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
      s.tool = 'select';
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.timelineZoom = 1;
      s.beatmap.editor.distanceSpacing = 1;
      window.__resetObjs = () => {
        s.distanceLock = false; // 本批只测物件吸附; 锁定间距的优先级由第一次点击顺带覆盖
        s.beatmap.hitObjects = [
          { id: 99001, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
          { id: 99002, type: 'circle', x: 300, y: 200, time: 1600, hitSound: 0, newCombo: false, comboSkip: 0 },
          { id: 99003, type: 'slider', x: 150, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
            curveType: 'L', curvePoints: [{ x: 350, y: 300 }], length: 200, slides: 1 },
        ];
        s.seek(1400);
        s.clearSelection();
        s.emit();
      };
      window.__resetObjs();
      window.__baseIds = new Set([99001, 99002, 99003]); // genId 是全局计数器, 新物件 id 更小, 按集合差找新增
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) 放置吸附: 靠近单点头 < 6.4 吸到其上, 远处原样放置');
  {
    await evalJs('window.__osuStore.tool = "circle"; "ok"');
    // 注意: hitObjects 按时间排序, 新物件 time=1375 排在最前; genId 是全局计数器 — 按集合差找新增
    await clickOsu(205, 103); // dist 5.83 < 6.4
    let placed = await evalJs('(() => { const o = window.__osuStore.beatmap.hitObjects.find(x => !window.__baseIds.has(x.id)); return o ? [o.x, o.y] : null; })()');
    assert(placed !== null && placed[0] === 200 && placed[1] === 100, `点 (205,103) 吸附放到 (200,100) (实际 ${placed})`);
    await clickOsu(220, 140); // 离所有目标 > 6.4
    placed = await evalJs('(() => { const o = window.__osuStore.beatmap.hitObjects.filter(x => !window.__baseIds.has(x.id)).at(-1); return o ? [o.x, o.y] : null; })()');
    assert(placed !== null && Math.abs(placed[0] - 220) <= 1 && Math.abs(placed[1] - 140) <= 1, `点 (220,140) 不吸附, 原样放置 (osu<->client 亚像素 ±1) (实际 ${placed})`);
    await evalJs('window.__osuStore.tool = "select"; window.__resetObjs(); "ok"');
    await sleep(300);
  }

  console.log('== B) 拖拽吸附: B 拖到 A 附近 -> 重合 (200,100)');
  {
    await evalJs('window.__osuStore.select([99002]); "ok"');
    await sleep(200);
    await dragOsu([300, 200], [205, 103]); // 候选 (205,103) dist 5.83 -> 吸到 A
    const [bx, by] = await evalJs('window.__posOf(99002)');
    assert(bx === 200 && by === 100, `B 吸附到 A (200,100) (实际 ${bx},${by})`);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [rx, ry] = await evalJs('window.__posOf(99002)');
    assert(rx === 300 && ry === 200, `一次 undo 还原 (实际 ${rx},${ry})`);
  }

  console.log('== C) 拖拽吸附: B 拖到滑条尾 (350,300) 附近 -> 重合');
  {
    await evalJs('window.__osuStore.select([99002]); "ok"');
    await sleep(200);
    await dragOsu([300, 200], [352, 297]); // 候选 (352,297) dist 3.6 < 6.4 -> 吸到滑条尾
    const [bx, by] = await evalJs('window.__posOf(99002)');
    assert(bx === 350 && by === 300, `B 吸附到滑条尾 (350,300) (实际 ${bx},${by})`);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
  }

  console.log('== D) Ctrl+方向键逐 px 移动选中物件 (一次按键一次 undo)');
  {
    await evalJs('window.__osuStore.select([99001]); "ok"');
    await sleep(200);
    const key = (k) => evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true })); "ok"`);
    await key('ArrowRight'); await sleep(80);
    await key('ArrowRight'); await sleep(80);
    await key('ArrowDown'); await sleep(120);
    let [ax, ay] = await evalJs('window.__posOf(99001)');
    assert(ax === 202 && ay === 101, `两次右一次下 -> (202,101) (实际 ${ax},${ay})`);
    await evalJs('window.__osuStore.undo(); window.__osuStore.undo(); window.__osuStore.undo(); "ok"');
    await sleep(200);
    [ax, ay] = await evalJs('window.__posOf(99001)');
    assert(ax === 200 && ay === 100, `三次 undo 逐步还原 (实际 ${ax},${ay})`);
  }

  console.log('== E) Prev/Next 显示 "{n}x({px}px)"');
  {
    await evalJs('window.__osuStore.select([99002]); window.__osuStore.emit(); "ok"');
    await sleep(400);
    const txt = await evalJs(`(() => {
      const divs = [...document.querySelectorAll('div')].filter(d => d.childElementCount <= 1);
      const prev = divs.find(d => d.textContent?.startsWith('Prev:'))?.textContent ?? '';
      const next = divs.find(d => d.textContent?.startsWith('Next:'))?.textContent ?? '';
      return prev + ' | ' + next;
    })()`);
    // A(200,100)@1500 -> B(300,200)@1600: dist 141.42 -> 141px; B -> 滑条头 (150,300)@2000: dist 180.28 -> 180px
    assert(/Prev: [\d.]+x\(141px\)/.test(txt), `Prev 含 (141px) (${txt})`);
    assert(/Next: [\d.]+x\(180px\)/.test(txt), `Next 含 (180px) (${txt})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V55_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V55_CDP_PASSED');

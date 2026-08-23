// CDP v56 端到端: 位置网格 (渲染/三类放置吸附/网格覆盖物件吸附/拖拽吸附/开关/UI)
// 运行: node verifier/v56/cdp-v56.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9391;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v56-'));
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
      s.distanceLock = false;
      s.gridSpacing = null;
      s.gridRotation = 0;
      window.__setGrid = (type, size, snap) => {
        s.gridType = type; s.gridSpacing = size; s.gridSnap = snap; s.gridRotation = 0;
        s.beatmap.editor.gridSize = size;
        s.emit();
      };
      window.__setObjs = (objs) => { s.beatmap.hitObjects = objs; s.seek(1400); s.clearSelection(); s.emit(); };
      window.__setObjs([]);
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      window.__newObj = () => { const o = s.beatmap.hitObjects.at(-1); return o ? [o.x, o.y] : null; }; // 空布景时新物件即唯一
      // 网格线探针: (ox,oy) 附近 dx ±2 的最大亮度 (线宽 1 屏幕 px, 抗亚像素)
      window.__colMax = (ox, oy) => {
        let best = 0;
        for (let dx = -2; dx <= 2; dx++) {
          const p = window.__osuToCanvas(ox + dx, oy);
          const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
          const d = c.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
          best = Math.max(best, d[0] + d[1] + d[2]);
        }
        return best;
      };
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) 网格渲染: 正方形线 / 圆形环可见 (lazer 始终显示)');
  {
    await evalJs('window.__setGrid("square", 32, false); "ok"');
    await sleep(400);
    const on = await evalJs('window.__colMax(288, 60)'); // x=256+32 线
    const off = await evalJs('window.__colMax(300, 60)'); // 两线之间
    assert(on > 90 && off < 80, `正方形线 x=288 亮度 ${on} > 90, 线间 x=300 ${off} < 80`);
    await evalJs('window.__setGrid("circle", 32, false); "ok"');
    await sleep(400);
    const ring = await evalJs('window.__colMax(288, 192)'); // 首环 r=32 (alpha 0.8)
    const between = await evalJs('window.__colMax(304, 192)'); // 环间 (r=48)
    assert(ring > 150 && between < 80, `圆形首环 r=32 亮度 ${ring} > 150, 环间 ${between} < 80`);
  }

  console.log('== B) 放置网格吸附: 三类网格');
  {
    // 正方形 32: 格点 (288,224)
    await evalJs('window.__setGrid("square", 32, true); window.__setObjs([]); window.__osuStore.tool = "circle"; "ok"');
    await sleep(200);
    await clickOsu(290, 226);
    let p = await evalJs('window.__newObj()');
    assert(p !== null && Math.abs(p[0] - 288) <= 1 && Math.abs(p[1] - 224) <= 1, `正方形: (290,226) -> (288,224) (实际 ${p})`);
    // 三角形 32: 晶格点 q=2,r=1 -> (304, 219.7)
    await evalJs('window.__setGrid("triangle", 32, true); window.__setObjs([]); "ok"');
    await sleep(200);
    await clickOsu(305, 218);
    p = await evalJs('window.__newObj()');
    assert(p !== null && Math.abs(p[0] - 304) <= 1 && Math.abs(p[1] - 220) <= 1, `三角形: (305,218) -> (304,220) (实际 ${p})`);
    // 圆形 32: len 74 -> 64 -> (320,192)
    await evalJs('window.__setGrid("circle", 32, true); window.__setObjs([]); "ok"');
    await sleep(200);
    await clickOsu(330, 192);
    p = await evalJs('window.__newObj()');
    assert(p !== null && Math.abs(p[0] - 320) <= 1 && Math.abs(p[1] - 192) <= 1, `圆形: (330,192) -> (320,192) (实际 ${p})`);
    await evalJs('window.__osuStore.tool = "select"; "ok"');
  }

  console.log('== C) 优先级: 位置网格最后应用并覆盖物件吸附结果 (lazer TryMoveBlueprints)');
  {
    // A 在非格点 (290,194): 物件吸附命中 (290,194), 网格再覆盖到格点 (288,192)
    await evalJs(`window.__setGrid("square", 32, true);
      window.__setObjs([{ id: 99101, type: 'circle', x: 290, y: 194, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 }]);
      window.__osuStore.tool = "circle"; "ok"`);
    await sleep(200);
    await clickOsu(292, 196); // 离 A 2.83 < 6.4 -> 物件吸附 (290,194) -> 网格覆盖 (288,192)
    const p = await evalJs('(() => { const o = window.__osuStore.beatmap.hitObjects.find(x => x.id !== 99101); return o ? [o.x, o.y] : null; })()');
    assert(p !== null && Math.abs(p[0] - 288) <= 1 && Math.abs(p[1] - 192) <= 1, `网格覆盖物件吸附 -> (288,192) 而非 (290,194) (实际 ${p})`);
    await evalJs('window.__osuStore.tool = "select"; "ok"');
  }

  console.log('== D) 拖拽网格吸附: 锚头落到格点');
  {
    await evalJs(`window.__setGrid("square", 32, true);
      window.__setObjs([{ id: 99102, type: 'circle', x: 300, y: 200, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 }]);
      window.__osuStore.select([99102]); "ok"`);
    await sleep(200);
    await dragOsu([300, 200], [330, 230]); // 候选 (330,230) -> 格点 (320,224)
    const [bx, by] = await evalJs('window.__posOf(99102)');
    assert(bx === 320 && by === 224, `拖拽 -> (320,224) (实际 ${bx},${by})`);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [rx, ry] = await evalJs('window.__posOf(99102)');
    assert(rx === 300 && ry === 200, `一次 undo 还原 (实际 ${rx},${ry})`);
  }

  console.log('== E) 开关关闭: 不吸附');
  {
    await evalJs('window.__setGrid("square", 32, false); window.__setObjs([]); window.__osuStore.tool = "circle"; "ok"');
    await sleep(200);
    await clickOsu(290, 226);
    const p = await evalJs('window.__newObj()');
    assert(p !== null && Math.abs(p[0] - 290) <= 1 && Math.abs(p[1] - 226) <= 1, `关网格 -> 原样 (290,226)±1 (实际 ${p})`);
    await evalJs('window.__osuStore.tool = "select"; "ok"');
  }

  console.log('== F) 工具栏控件: 存在 + 间距写回 GridSize + 圆形禁用旋转');
  {
    const ctrls = await evalJs(`(() => [
      !!document.querySelector('[data-grid-input=type]'),
      !!document.querySelector('[data-grid-input=spacing]'),
      !!document.querySelector('[data-grid-input=rotation]'),
    ])()`);
    assert(ctrls.every(Boolean), `类型/间距/旋转控件齐全 (${ctrls})`);
    await evalJs(`(() => {
      const inp = document.querySelector('[data-grid-input=spacing]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '64');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(300);
    const gs = await evalJs('[window.__osuStore.gridSpacing, window.__osuStore.beatmap.editor.gridSize]');
    assert(gs[0] === 64 && gs[1] === 64, `间距输入 64 -> store + GridSize 写回 (实际 ${gs})`);
    await evalJs(`(() => {
      const sel = document.querySelector('[data-grid-input=type]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'circle');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(300);
    const rotDisabled = await evalJs('window.__osuStore.gridType === "circle" ? document.querySelector("[data-grid-input=rotation]").disabled : "not-circle"');
    assert(rotDisabled === true, `圆形时旋转输入禁用 (实际 ${rotDisabled})`);
    await evalJs('window.__setGrid("square", 32, false); "ok"');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V56_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V56_CDP_PASSED');

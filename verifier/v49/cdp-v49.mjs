// CDP v49 端到端: 选中框缩放 (黄色框渲染 + 手柄拖拽缩放 + Shift 锁比 + Alt 默认原点 + undo 语义)
// 布景: c1(200,100)@1500 nc, c2(300,200)@2000, CS4 (r=36.48); 全选 -> 位置盒 (200,100,100,100),
//   显示盒外扩+INFLATE5 (v52) -> (158.5,58.5,183,183); cr 手柄 (341.5,150), br 手柄 (341.5,241.5)
// 运行: node verifier/v49/cdp-v49.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9381;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v49-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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
// 真实鼠标事件 (React 合成事件可接收); modifiers: 1=Alt 2=Ctrl 4=Meta 8=Shift
async function mouse(type, x, y, opts = {}) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: 1,
    buttons: type === 'mouseReleased' ? 0 : 1, modifiers: opts.modifiers ?? 0,
  });
  await sleep(120);
}
// osu 坐标 -> 视口坐标
async function toClient(ox, oy) {
  return evalJs(`window.__osuToClient(${ox}, ${oy})`);
}
// 从手柄位置拖到目标 osu 坐标
async function dragHandle(fromOsu, toOsuPos, modifiers = 0) {
  const from = await toClient(fromOsu[0], fromOsu[1]);
  const to = await toClient(toOsuPos[0], toOsuPos[1]);
  await mouse('mousePressed', from.x, from.y, { modifiers });
  await mouse('mouseMoved', to.x, to.y, { modifiers });
  return to;
}
const pos = () => evalJs(`JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.id, o.x, o.y]))`);

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
      s.beatmap.hitObjects = [
        { id: 98402, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98403, type: 'circle', x: 300, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.seek(1400);
      s.select([98402, 98403]);
      s.emit();
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)].join(',');
      };
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) 黄色选中框与手柄渲染');
  {
    // 显示盒顶边中点 (200, 58.5) 应为黄色边框
    const edge = await evalJs('window.__pfPixel(200, 58.5)');
    const [r, g, b] = edge.split(',').map(Number);
    assert(r > 150 && g > 100 && b < 130, `显示框顶边为黄色 (${edge})`);
    // cr 手柄 (341.5, 150) 应为黄色实心块
    const hd = await evalJs('window.__pfPixel(341.5, 150)');
    const [r2, g2, b2] = hd.split(',').map(Number);
    assert(r2 > 150 && g2 > 100 && b2 < 130, `cr 手柄黄色方块 (${hd})`);
  }

  console.log('== B) 拖 cr 手柄右移 40 osu px: X 缩放 1.4x, 原点 = 左边中点 (200,150)');
  {
    const to = await dragHandle([341.5, 150], [381.5, 150]);
    // 拖拽中实时生效 (lazer Update): c2 x = 200 + 100*1.4 = 340
    const [x2] = await evalJs('window.__posOf(98403)');
    assert(x2 === 340, `拖拽中 c2.x = 340 (实际 ${x2})`);
    const [x1] = await evalJs('window.__posOf(98402)');
    assert(x1 === 200, `原点侧 c1.x 不动 (实际 ${x1})`);
    await mouse('mouseReleased', to.x, to.y);
    await sleep(200);
    // 一次拖拽一次 undo
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [rx2] = await evalJs('window.__posOf(98403)');
    assert(rx2 === 300, `一次 undo 完全还原 (实际 ${rx2})`);
  }

  console.log('== C) Shift+拖 br 角手柄 (dx=+40, dy=0): 锁长宽比 1.2x');
  {
    const to = await dragHandle([341.5, 241.5], [381.5, 241.5], 8);
    const [x2, y2] = await evalJs('window.__posOf(98403)');
    // sx=1.4, sy=1 -> 锁比 (1.4+1)/2=1.2; 原点 tl (200,100): c2 = (200+100*1.2, 100+100*1.2) = (320, 220)
    assert(x2 === 320 && y2 === 220, `Shift 锁比后 c2 = (320,220) (实际 ${x2},${y2})`);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
  }

  console.log('== D) Alt+拖 cr 手柄: 原点 = 默认原点 (MEC 圆心 250,150)');
  {
    const to = await dragHandle([341.5, 150], [381.5, 150], 1);
    const [x1] = await evalJs('window.__posOf(98402)');
    const [x2] = await evalJs('window.__posOf(98403)');
    // scale 1.4, origin (250,150): c1.x = 250-50*1.4 = 180, c2.x = 250+50*1.4 = 320
    assert(x1 === 180 && x2 === 320, `Alt 默认原点: c1=180, c2=320 (实际 ${x1},${x2})`);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
  }

  console.log('== E) 手柄点击不拖动: 不产生 undo 项');
  {
    const from = await toClient(341.5, 150);
    await mouse('mousePressed', from.x, from.y);
    await mouse('mouseReleased', from.x, from.y);
    await sleep(200);
    // 再做一次真实拖拽, 一次 undo 应完全还原 (若空点击留了快照则需两次)
    const to = await dragHandle([341.5, 150], [381.5, 150]);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [x2] = await evalJs('window.__posOf(98403)');
    assert(x2 === 300, `空点击未消耗 undo, 一次 undo 即还原 (实际 ${x2})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V49_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V49_CDP_PASSED');

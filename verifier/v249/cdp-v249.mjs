// CDP v249 端到端 (Electron 内核): 独立窗口抗全局缩放
// A) 1280x720 (uiZoom=0.6): 多边形生成窗口视觉宽 ≈ 自然宽 (不随 zoom 缩小), 且居中
// B) 同窗口拖拽标题栏 (+100,+80 视觉 px) => 位置精确跟随 (验证视觉/布局坐标换算)
// C) 460x400 极小窗口 (视口 < 窗口自然尺寸): 窗口等比缩小到能放下 (不溢出视口)
// 运行: node verifier/v249/cdp-v249.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EL = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DRIVER = path.join(root, 'verifier', 'v249', 'el-driver');
const DEBUG_PORT = 9433;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const env = { ...process.env, WIN_W: process.env.WIN_W || '1280', WIN_H: process.env.WIN_H || '720' };
const proc = spawn(EL, [DRIVER, `--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore', env });
const kill = () => { try { process.kill(proc.pid); } catch { /* noop */ } };
process.on('exit', kill);

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = ts.find(t => t.type === 'page' && t.url.includes('localhost:7100'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
const dlgRect = () => evalJs(`
  (() => {
    const d = document.querySelector('[data-dialog="polygon"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight,
      zoom: +getComputedStyle(d).zoom };
  })()
`);

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
  }
  if (!ready) throw new Error('应用未就绪');

  if (process.env.TINY === '1') {
    // C) 极小窗口: 视口 < 窗口自然尺寸 => 等比缩小到能放下
    console.log('== C) 极小窗口 => 收缩容纳不溢出');
    await evalJs(`window.__osuStore.openConversion('polygon'); "ok"`);
    await sleep(700);
    const r = await dlgRect();
    assert(r !== null, '窗口已打开');
    if (r) {
      console.log('  rect:', JSON.stringify(r));
      assert(r.x >= -1 && r.y >= -1 && r.x + r.w <= r.vw + 2 && r.y + r.h <= r.vh + 2,
        `窗口 (${r.x.toFixed(0)},${r.y.toFixed(0)},${r.w.toFixed(0)}x${r.h.toFixed(0)}) 在视口 ${r.vw}x${r.vh} 内`);
      assert(r.w < 302 * 0.98, `视觉宽 ${r.w.toFixed(0)} < 自然宽 302 (确实缩小了)`);
    }
  } else {
  const z = await evalJs('Math.max(0.6, Math.min(1, Math.min(window.innerWidth/2560, window.innerHeight/1440)))');
  console.log('== A) 小窗口 (uiZoom=' + z.toFixed(2) + ') 打开多边形生成 => 保持自然大小且居中');
  await evalJs(`window.__osuStore.openConversion('polygon'); "ok"`);
  await sleep(600);
  const r = await dlgRect();
  assert(r !== null, '窗口已打开');
  if (r) {
    console.log('  rect:', JSON.stringify(r));
    assert(r.zoom > 1, `自身反缩放 zoom=${r.zoom.toFixed(2)} > 1 (抵消全局 ${z.toFixed(2)})`);
    assert(r.w > 300 * z + 40, `视觉宽 ${r.w.toFixed(0)} 明显大于旧行为 (${(300 * z).toFixed(0)}) — 未随全局缩小`);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    assert(Math.abs(cx - r.vw / 2) <= 4 && Math.abs(cy - r.vh / 2) <= 4,
      `中心 (${cx.toFixed(1)},${cy.toFixed(1)}) ≈ 视口 (${(r.vw / 2).toFixed(1)},${(r.vh / 2).toFixed(1)})`);
  }

  console.log('== B) 拖标题栏 => 视觉位移精确跟随');
  {
    const r0 = await dlgRect();
    const sx = r0.x + 60, sy = r0.y + 12;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + 100, y: sy + 80, button: 'left', buttons: 1 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 100, y: sy + 80, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
    const r1 = await dlgRect();
    assert(Math.abs(r1.x - (r0.x + 100)) <= 3 && Math.abs(r1.y - (r0.y + 80)) <= 3,
      `拖动 (+100,+80): (${r0.x.toFixed(0)},${r0.y.toFixed(0)}) -> (${r1.x.toFixed(0)},${r1.y.toFixed(0)})`);
  }
  await evalJs(`window.__osuStore.closeConversion(); "ok"`);

  console.log('== D) UnsavedDialog (useCounterZoom) 反缩放且居中收敛');
  {
    await evalJs(`(() => { const s = window.__osuStore; s.dirty = true; s.guardUnsaved(() => {}); return 1; })()`);
    await sleep(700);
    const r = await evalJs(`(() => {
      const d = document.querySelector('[data-unsaved-dialog="root"] > div');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight,
        zoom: +getComputedStyle(d).zoom };
    })()`);
    assert(r !== null, '未保存提示框已打开');
    if (r) {
      console.log('  rect:', JSON.stringify(r));
      assert(r.zoom > 1, `自身反缩放 zoom=${r.zoom.toFixed(2)} > 1`);
      assert(r.w > 420 * 0.9, `视觉宽 ${r.w.toFixed(0)} ≈ 自然 420 (未随全局缩小)`);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      assert(Math.abs(cx - r.vw / 2) <= 4 && Math.abs(cy - r.vh / 2) <= 4,
        `中心 (${cx.toFixed(1)},${cy.toFixed(1)}) ≈ 视口 (${(r.vw / 2).toFixed(1)},${(r.vh / 2).toFixed(1)})`);
    }
    await evalJs(`window.__osuStore.resolvePendingAction(false); window.__osuStore.dirty = false; "ok"`);
  }
  }
} finally {
  kill();
}
if (failures) { console.error(`\nVERIFIER_V249_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V249_CDP_PASSED');

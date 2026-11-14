// v525: DraggableDialog 位置/尺寸覆盖 + 八向缩放 + 持久化
// 运行: npm run build 后 node verifier/v525/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 源码契约');
{
  const src = read('src/components/DraggableDialog.tsx');
  assert(/getUiOverride\(`dialog\.\$\{testid\}`\)/.test(src) && /useUiLayout\(\)/.test(src), '窗口按永久 ID 订阅配置');
  assert(/layout\?\.width \?\? width/.test(src) && /resolvedHeight/.test(src), '位置/尺寸覆盖');
  assert(/data-dialog-resize/.test(src), '八向缩放手柄');
  assert(/onPointerUp[\s\S]{0,250}setUiOverride/.test(src), '拖动结束保存位置');
  assert(/hidden=\{dialogOverride\.visible === false\}/.test(src) && /inert=\{dialogOverride\.enabled === false/.test(src), '窗口隐藏/禁用');
}

console.log('== B: CDP 拖动/右缘缩放/重开持久化');
{
  const PORT = 9539;
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
    let msgId = 0; const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);
    await evalJs(`document.querySelector('[data-display-panel-btn]').click()`);
    await sleep(300);
    const initial = await evalJs(`(() => {
      const d = document.querySelector('[data-dialog="display-panel"]');
      const r = d.getBoundingClientRect(), t = d.querySelector('.cursor-move').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height,
        tx: t.left + t.width / 2, ty: t.top + t.height / 2 };
    })()`);
    const drag = async (x, y, dx, dy) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y: y + dy, button: 'left', buttons: 1 });
      await sleep(120);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
      await sleep(200);
    };
    await drag(initial.tx, initial.ty, 40, 25);
    const moved = await evalJs(`(() => {
      const d = document.querySelector('[data-dialog="display-panel"]'), r = d.getBoundingClientRect();
      const h = d.querySelector('[data-dialog-resize="right"]').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height, hx: h.left + h.width / 2, hy: h.top + h.height / 2 };
    })()`);
    await drag(moved.hx, moved.hy, 60, 0);
    const out = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const d = document.querySelector('[data-dialog="display-panel"]'), r = d.getBoundingClientRect();
      const cfg = JSON.parse(localStorage.getItem('osu-editor:ui-layout:v1')).controls['dialog.display-panel'].layout;
      const out = { x: r.left, y: r.top, width: r.width, height: r.height, cfg };
      d.querySelector('.lucide-x').closest('button').click(); await sleep(100);
      document.querySelector('[data-display-panel-btn]').click(); await sleep(250);
      const rr = document.querySelector('[data-dialog="display-panel"]').getBoundingClientRect();
      out.reopen = { x: rr.left, y: rr.top, width: rr.width, height: rr.height };
      return out;
    })()`);

    assert(Math.abs(moved.x - initial.x - 40) < 2 && Math.abs(moved.y - initial.y - 25) < 2,
      `窗口拖动 (${initial.x},${initial.y})→(${moved.x},${moved.y})`);
    assert(Math.abs(out.width - moved.width - 60) < 2, `右缘缩放加宽 60px (${moved.width}→${out.width})`);
    assert(Math.abs(out.cfg.x - out.x) < 1 && Math.abs(out.cfg.y - out.y) < 1 && Math.abs(out.cfg.width - out.width) < 1,
      `位置/宽度写入配置 (${JSON.stringify(out.cfg)})`);
    assert(Math.abs(out.reopen.x - out.x) < 2 && Math.abs(out.reopen.y - out.y) < 2 && Math.abs(out.reopen.width - out.width) < 2,
      '关闭重开后位置和尺寸保持');

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V525_FAILED: ${failures} 处失败` : '\nVERIFIER_V525_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

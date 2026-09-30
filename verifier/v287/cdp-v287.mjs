// CDP v287 端到端: 测试游玩覆盖层 (electron 实跑)
//   1) [data-testplay-btn] 存在, 点击进入 → [data-testid="testplay-overlay"] 出现, 音频在播 (store.currentTime 前进)
//   2) 覆盖层 canvas 有非黑像素 (物件/HUD 渲染)
//   3) Esc 退出 → 覆盖层消失, currentTime 回到进入前附近 (lazer quickExit 语义)
// 运行: node verifier/v287/cdp-v287.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules/electron/dist/electron.exe');
const DEBUG_PORT = 9442;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const el = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('ELECTRON_CONNECT_FAILED'); el.kill(); process.exit(2); }
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const click = async (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click(); return true; })()`);

try {
  // 等谱面恢复 + 测试游玩按钮
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await evalJs('!!(document.querySelector("[data-testplay-btn]") && window.__osuStore && window.__osuStore.beatmap)');
    if (!ok) await sleep(500);
  }
  assert(ok, '测试游玩按钮渲染 + 谱面已恢复');

  // 跳到谱面中部 (确保 lead-back 分支 + 有物件可玩)
  await evalJs('window.__osuStore.seek(Math.min(60000, window.__osuStore.songLength() / 2))');
  await sleep(200);
  const t0 = await evalJs('window.__osuStore.currentTime');

  assert(await click('[data-testplay-btn]'), '点击进入测试游玩');
  await sleep(800);
  assert(await evalJs(`!!document.querySelector('[data-testid="testplay-overlay"]')`), '覆盖层出现');
  const t1 = await evalJs('window.__osuStore.currentTime');
  assert(t1 < t0, `从 editorTime-3s 起播 (进入 ${Math.round(t0)} → 起点 ${Math.round(t1)})`);

  // 播放推进 (音频时钟在走)
  const ta = await evalJs('window.__osuStore.positionMs()');
  await sleep(1200);
  const tb = await evalJs('window.__osuStore.positionMs()');
  assert(tb - ta > 500, `游玩时钟前进 (${Math.round(ta)} → ${Math.round(tb)})`);

  // canvas 有非黑像素 (物件/HUD/提示已绘制)
  const px = await evalJs(`(() => {
    const c = document.querySelector('[data-testid="testplay-overlay"] canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i] + d[i+1] + d[i+2] > 30) n++;
    return n;
  })()`);
  assert(px > 50, `覆盖层 canvas 非黑像素 ${px} 处 (>50)`);

  // Esc 退出 → 覆盖层消失, 时间回到进入前附近
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  assert(await evalJs(`!document.querySelector('[data-testid="testplay-overlay"]')`), 'Esc 退出覆盖层');
  const t2 = await evalJs('window.__osuStore.currentTime');
  assert(Math.abs(t2 - t0) < 500, `退出后回到 editorTime (${Math.round(t2)} ≈ ${Math.round(t0)})`);
} finally {
  el.kill();
}
console.log(failures ? `\nV287_CDP_FAILED: ${failures}` : '\nV287_CDP_ALL_PASSED');
process.exit(failures ? 1 : 0);

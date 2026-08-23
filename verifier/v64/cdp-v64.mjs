// CDP v64 端到端: 多边形生成 — Ctrl+Shift+D 开弹窗 / 实时预览 / 参数改顶点 / 应用一次 undo / 出界禁用 / newCombo
// 运行: node verifier/v64/cdp-v64.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9399;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v64-'));
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
async function setNum(testid, val) {
  await evalJs(`(() => {
    const inp = document.querySelector('[data-conv=${testid}]');
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '${val}');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    return 'ok';
  })()`);
  await sleep(250);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4;
      s.seek(2500);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) Ctrl+Shift+D 开弹窗 + 默认 3 顶点实时预览');
  {
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true, bubbles: true })); "ok"`);
    await sleep(400);
    const open = await evalJs(`window.__osuStore.conversionDialog`);
    assert(open === 'polygon', `快捷键开弹窗 (实际 ${open})`);
    const prev = await evalJs(`(() => {
      const p = window.__osuStore.conversionPreview;
      return p ? [p.hideIds.length, p.objects.length] : null;
    })()`);
    assert(prev !== null && prev[0] === 0 && prev[1] === 3, `预览 3 个单点 (实际 ${JSON.stringify(prev)})`);
  }

  console.log('== B) 改顶点数 4 实时更新预览, 应用生成');
  {
    await setNum('vertices', '4');
    const n = await evalJs(`window.__osuStore.conversionPreview?.objects.length`);
    assert(n === 4, `预览实时更新为 4 (实际 ${n})`);
    await evalJs(`document.querySelector('[data-conv=apply]').click(); "ok"`);
    await sleep(300);
    const res = await evalJs(`(() => {
      const s = window.__osuStore;
      const objs = s.beatmap.hitObjects;
      return [objs.length, s.conversionDialog, s.selected.size, objs.map(o => [o.x, o.y, o.time])];
    })()`);
    assert(res[0] === 4 && res[1] === null && res[2] === 4, `应用: 4 单点入谱 + 选中原件 + 弹窗关闭`);
    // 首点: θ=90°, x=256, y=192+R; R = 35/(2 sin45°) ≈ 24.75
    const [x, y, t] = res[3][0];
    assert(Math.abs(x - 256) <= 1 && Math.abs(y - 217) <= 1 && t === 2500, `首点位置/时间 (${x},${y}@${t})`);
    assert(await evalJs(`window.__osuStore.canUndo`), '一次 undo 可撤销');
    await evalJs(`window.__osuStore.undo(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 0, 'undo 撤销生成');
  }

  console.log('== C) 出界禁用创建 (divisor 1 + DS 6)');
  {
    await evalJs(`(() => { const s = window.__osuStore; s.beatSnap = 1; s.emit(); })(); "ok"`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true, bubbles: true })); "ok"`);
    await sleep(300);
    await setNum('distanceSnap', '6');
    const st = await evalJs(`(() => {
      const btn = document.querySelector('[data-conv=apply]');
      return [window.__osuStore.conversionPreview, btn.disabled, !!document.querySelector('[data-testid=polygon], [data-conv=apply]')];
    })()`);
    assert(st[0] === null && st[1] === true, `出界: 预览清空 + 创建禁用 (实际 ${JSON.stringify(st)})`);
    assert(await evalJs(`[...document.querySelectorAll('div')].some(d => d.textContent === '顶点超出游玩区, 无法创建 (lazer 同款)')`), '出界提示文案');
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取消').click(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 0, '取消: 未生成任何物件');
  }

  console.log('== D) newCombo 勾选仅首件生效');
  {
    await evalJs(`(() => { const s = window.__osuStore; s.beatSnap = 4; s.emit(); })(); "ok"`);
    await evalJs(`(() => { const s = window.__osuStore; s.clearSelection(); s.emit(); })(); "ok"`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true, bubbles: true })); "ok"`);
    await sleep(300);
    await setNum('vertices', '3'); // B 组已持久化 vertices=4
    // 确保勾选 (默认跟随选区状态, 不假定初值)
    await evalJs(`(() => { const cb = document.querySelector('[data-conv=newCombo]'); if (!cb.checked) cb.click(); })(); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-conv=apply]').click(); "ok"`);
    await sleep(300);
    const nc = await evalJs(`window.__osuStore.beatmap.hitObjects.map(o => !!o.newCombo)`);
    assert(nc.length === 3 && nc[0] === true && nc[1] === false && nc[2] === false, `仅首件 newCombo (实际 ${JSON.stringify(nc)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V64_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V64_CDP_PASSED');

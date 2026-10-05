// v344 复现: 旋转窗口对单个单点 (circle) 应用旋转 → 白屏
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9444;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到页面目标'); electron.kill(); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push((d.text ?? '') + ' ' + (d.exception?.description ?? '') + '\n' +
      (d.stackTrace?.callFrames ?? []).map(f => `${f.functionName} ${f.url.split('/').pop()}:${f.lineNumber + 1}`).join('\n'));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.error('EVAL-ERR:', JSON.stringify(r.result.exceptionDetails).slice(0, 900));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
  }
  if (!ready) throw new Error('未就绪');

  // 只留一个单点, 选中它
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    store.load({ ...base, hitObjects: [{ ...tc, id: 999001, time: 5000, x: 256, y: 192 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.select([999001]);
    store.seek(5000);
  })()`);
  await sleep(400);

  // 打开旋转窗口 (Ctrl+Shift+R)
  await evalJs('window.__osuStore.openTransformDialog ? window.__osuStore.openTransformDialog("rotate") : undefined');
  let dlg = await evalJs('!!document.querySelector("[data-tf=\\"apply-rotate\\"]")');
  if (!dlg) {
    // 回退: 快捷键
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 10 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 0 });
    await sleep(400);
    dlg = await evalJs('!!document.querySelector("[data-tf=\\"apply-rotate\\"]")');
  }
  console.log('旋转窗口打开:', dlg);

  // 输入角度 90 并应用
  await evalJs(`(() => {
    const input = document.querySelector('[data-tf="angle"] input, input[data-tf="angle"]') ;
    return !!input;
  })()`);
  // 直接点「应用旋转」前先把角度设成 90 (React 受控 — 走原生 setter + input 事件)
  await evalJs(`(() => {
    const el = document.querySelector('[data-tf="angle"]');
    if (!el) return 'no-angle-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '90');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`).then(r => console.log('设角度:', r));
  await sleep(300);
  await evalJs(`document.querySelector('[data-tf="apply-rotate"]').click()`);
  await sleep(600);
  console.log('应用后 body 子节点数:', await evalJs('document.body.children.length'));
  console.log('应用后 #root 是否为空:', await evalJs('document.getElementById("root")?.children.length ?? "no-root"'));
  console.log('选中物件位置:', await evalJs('JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.id, o.x, o.y]))'));

  // 再预览路径也试一次 (改角度触发 previewTransform)
  await evalJs(`(() => {
    const el = document.querySelector('[data-tf="angle"]');
    if (!el) return 'gone';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '45');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`).then(r => console.log('改角度预览:', r));
  await sleep(600);
  console.log('预览后 #root 子节点数:', await evalJs('document.getElementById("root")?.children.length ?? "no-root"'));

  if (exceptions.length) {
    console.log('\n== 捕获异常 ==');
    for (const e of exceptions.slice(0, 4)) console.log(e, '\n---');
  } else console.log('\n未捕获异常');
} finally {
  electron.kill();
}
process.exit(0);

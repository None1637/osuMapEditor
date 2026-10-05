// CDP check v344 (Electron / production): 旋转/缩放窗口对含单点 (circle) 的选区不再白屏
//   根因: beginTransformPreview 备份时 deepCopy(o.curvePoints), 单点 curvePoints=undefined
//     → JSON.parse("undefined") 抛 SyntaxError, 在 useEffect 里炸掉整棵 React 树 (#root 清空 = 白屏)
//   修复: deepCopy undefined 防御 + beginTransformPreview 缺省不拷贝
//   断言: 开窗/应用/预览全程无页面异常, #root 存活; 混合选区 (单点+滑条) 旋转后位置确实改变
// 运行: npm run build 后 node verifier/v344/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9445;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(1); }
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
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const setNum = (dlg, testid, v) => evalJs(`(() => {
  const el = document.querySelector('[data-dialog="${dlg}"] [data-conv="${testid}"]');
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '${v}');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const rootAlive = () => evalJs('(document.getElementById("root")?.children.length ?? 0) > 0');

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 单点 + 滑条 各一
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    store.load({ ...base, hitObjects: [
      { ...tc, id: 999001, time: 5000, x: 200, y: 192 },
      { ...ts, id: 999002, time: 6000, x: 312, y: 192,
        curvePoints: [{ x: 380, y: 150 }], curveType: 'L', slides: 1, length: 100 },
    ] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(5000);
  })()`);
  await sleep(300);

  // ---- 场景 1: 只选单个单点, 开旋转窗口 (soulten 的触发步骤) ----
  await evalJs('window.__osuStore.select([999001])');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 10 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 0 });
  await sleep(500);
  assert(await evalJs('!!document.querySelector("[data-dialog=\\"rotate-dlg\\"] [data-tf=\\"apply-rotate\\"]")'), '单点选中时旋转窗口正常打开 (修复前开窗即白屏)');
  assert(await rootAlive(), 'React 树存活');

  assert(await setNum('rotate-dlg', 'angle', 90), '角度输入 90 (触发预览)');
  await sleep(300);
  assert(await rootAlive(), '预览后 React 树存活');
  await evalJs('document.querySelector(\'[data-tf="apply-rotate"]\').click()');
  await sleep(400);
  assert(await rootAlive(), '应用旋转后 React 树存活');
  const pos1 = await evalJs('JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.id, o.x, o.y]))');
  console.log('  单点旋转后位置:', pos1); // 绕自身中心旋转 = 不动, 符合预期

  // 关窗 (回滚预览)
  await evalJs('window.__osuStore.closeTransformDialog()');
  await sleep(300);

  // ---- 场景 2: 混合选区 (单点+滑条), 绕选区中心旋转 90° 确实位移 ----
  await evalJs('window.__osuStore.select([999001, 999002])');
  await evalJs('window.__osuStore.openTransformDialog ? 0 : 0');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 10 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'R', code: 'KeyR', windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 0 });
  await sleep(400);
  assert(await setNum('rotate-dlg', 'angle', 90), '混合选区角度输入 90');
  await sleep(200);
  await evalJs('document.querySelector(\'[data-tf="apply-rotate"]\').click()');
  await sleep(400);
  const pos2 = JSON.parse(await evalJs('JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => [o.id, o.x, o.y]))'));
  console.log('  混合选区旋转后位置:', JSON.stringify(pos2));
  const c1 = pos2.find(p => p[0] === 999001);
  assert(c1 && (c1[1] !== 200 || c1[2] !== 192), '混合选区旋转后单点位移 (绕选区中心)');
  assert(await rootAlive(), '混合选区旋转后 React 树存活');
  await evalJs('window.__osuStore.closeTransformDialog()');
  await sleep(300);

  // ---- 场景 3: 缩放窗口同路径 (beginTransformPreview 共用) ----
  await evalJs('window.__osuStore.select([999001])');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, modifiers: 10 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, modifiers: 0 });
  await sleep(400);
  assert(await evalJs('!!document.querySelector("[data-dialog=\\"scale-dlg\\"]")'), '单点选中时缩放窗口正常打开');
  assert(await setNum('scale-dlg', 'factor', 1.5), '倍率输入 1.5 (触发预览)');
  await sleep(300);
  assert(await rootAlive(), '缩放预览后 React 树存活');
  await evalJs('window.__osuStore.closeTransformDialog()');

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
  else console.log('  ok: 全程无页面异常');
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v344 全部通过');
process.exit(failures ? 1 : 0);

// 验证器 v487: 验证器 exe 窗口不再抢焦点 (用户反馈: v406 的 showInactive 仍会抢)
//   修复: OSU_VERIFIER=1 时 BrowserWindow 加 focusable:false — 窗口永不获取 OS 焦点,
//   渲染/rAF/CDP 合成事件与 Input 域注入均不受影响。
// 运行: npm run build 后 node verifier/v487/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码');
{
  const main = read('electron/main.cjs');
  assert(/\.\.\.\(isVerifier \? \{ show: false, focusable: false \} : \{\}\)/.test(main), 'OSU_VERIFIER 窗口 focusable:false');
  assert(/if \(isVerifier\) win\.showInactive\(\)/.test(main), 'showInactive 保留 (v406)');
}

section('CDP: 窗口不持 OS 焦点且合成交互正常');
{
  const PORT = 9500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 冒烟: 合成 keydown (F2) 与渲染循环仍工作
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
      await sleep(200);
      let rafOk = false;
      await new Promise(r => requestAnimationFrame(() => { rafOk = true; r(); }));
      return { hasFocus: document.hasFocus(), visibility: document.visibilityState, rafOk,
        storeAlive: !!store.beatmap };
    })()`);
    assert(out.hasFocus === false, `窗口不持 OS 焦点 (document.hasFocus()=${out.hasFocus})`);
    assert(out.rafOk, 'rAF 渲染循环正常 (focusable:false 不抑制渲染)');
    assert(out.storeAlive, '应用就绪 (合成事件/环境正常)');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V487_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V487_ALL_TESTS_PASSED');

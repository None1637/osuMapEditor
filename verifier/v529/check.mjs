// v529: 顶栏/底栏其余常用控件接入布局、图标、文本与屏蔽配置
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
  const layout = read('src/osu/uiLayout.ts'), app = read('src/App.tsx'), tl = read('src/components/Timelines.tsx');
  for (const id of ['chrome.volume', 'chrome.hotkeys', 'chrome.display', 'chrome.reload', 'chrome.language', 'timeline.bottom.test-play']) assert(layout.includes(id), id);
  assert(/\[25, 50, 75, 100\].*timeline\.bottom\.speed\.\$\{rate\}/s.test(layout), 'timeline.bottom.speed.50 等倍率控件');
  assert(/UiText id="chrome.volume"/.test(app) && /UiText id="timeline.bottom.test-play"/.test(tl), '顶栏/底栏文本适配');
  assert(/timeline.bottom.speed.\$\{v \* 100\}/.test(tl), '倍率按钮按稳定 ID 接入');
}

console.log('== B: CDP 顶栏文本/图标 + 底栏屏蔽恢复');
{
  const PORT = 9543;
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
    const out = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const select = id => {
        const b = [...document.querySelectorAll('[data-ui-editor] button')].find(x => x.textContent.trim() === id);
        if (!b) throw new Error('找不到控件: ' + id); b.click();
      };
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('chrome.volume'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Sound');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      const icon = document.querySelector('[data-ui-layout="icon"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(icon, 'lucide:Pause');
      icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      const volume = document.querySelector('[data-ui-id="chrome.volume"]');
      out.text = volume.textContent; out.icon = !!volume.querySelector('svg.lucide-pause');
      select('timeline.bottom.speed.50'); await sleep(80);
      const checks = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks[0].click(); await sleep(100);
      const speed = document.querySelector('[data-ui-id="timeline.bottom.speed.50"]');
      out.hidden = speed.hidden;
      checks[0].click(); await sleep(100); out.shown = !speed.hidden;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Sound');
      return out;
    })()`);
    assert(out.text === 'Sound' && out.icon, `顶栏文本/图标覆盖 (${out.text}/${out.icon})`);
    assert(out.hidden && out.shown, '底栏倍率屏蔽/恢复');
    assert(out.persisted, '新增控件配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V529_FAILED: ${failures} 处失败` : '\nVERIFIER_V529_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v530: 左右侧栏与 Inspector 控件接入布局、文本、图标、屏蔽和禁用配置
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
  const layout = read('src/osu/uiLayout.ts'), app = read('src/App.tsx'), inspector = read('src/components/Inspector.tsx');
  for (const id of ['sidebar.left.panel', 'sidebar.right.panel', 'inspector.polygon', 'inspector.delete']) assert(layout.includes(id), id);
  assert(layout.includes("['rotate-ccw', 'inspector.rotate_ccw']"), 'inspector.rotate-ccw 注册');
  assert(app.includes('id="sidebar.left.library"') && app.includes('id="sidebar.left.pan-x"'), '左栏按钮和数值框稳定 ID');
  assert(inspector.includes('id="inspector.rotate-ccw"') && inspector.includes('id="inspector.curve-type"'), 'Inspector 按钮和字段稳定 ID');
  assert(read('src/components/uiLayout/UiControl.tsx').includes('Children.toArray(children)'), '动态计数文本模板兼容');
}

console.log('== B: CDP 左栏文本/图标 + Inspector 禁用 + 输入框屏蔽');
{
  const PORT = 9544;
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
      const checks = () => [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('sidebar.left.library'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Tunes');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(80);
      const icon = document.querySelector('[data-ui-layout="icon"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(icon, 'lucide:Palette');
      icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      const library = document.querySelector('[data-ui-id="sidebar.left.library"]');
      out.text = library.textContent; out.icon = !!library.querySelector('svg.lucide-palette');
      select('inspector.polygon'); await sleep(80);
      checks()[1].click(); await sleep(100);
      out.disabled = document.querySelector('[data-ui-id="inspector.polygon"]').disabled;
      checks()[1].click(); await sleep(80);
      out.enabled = !document.querySelector('[data-ui-id="inspector.polygon"]').disabled;
      select('sidebar.left.pan-x'); await sleep(80);
      checks()[0].click(); await sleep(100);
      out.hidden = document.querySelector('[data-ui-id="sidebar.left.pan-x"]').hidden;
      checks()[0].click(); await sleep(80);
      out.shown = !document.querySelector('[data-ui-id="sidebar.left.pan-x"]').hidden;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Tunes');
      return out;
    })()`);
    assert(out.text === 'Tunes' && out.icon, `左栏文本/图标覆盖 (${out.text}/${out.icon})`);
    assert(out.disabled && out.enabled, 'Inspector 自定义 Btn 禁用/恢复');
    assert(out.hidden && out.shown, '左栏数值框屏蔽/恢复');
    assert(out.persisted, '侧栏配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V530_FAILED: ${failures} 处失败` : '\nVERIFIER_V530_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

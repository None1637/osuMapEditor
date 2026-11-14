// v536: 非拖动提示框、向导、TestPlay 与全局悬浮控件布局覆盖
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
  const layout = read('src/osu/uiLayout.ts');
  for (const id of ['unsaved.panel', 'update.dialog', 'first-run.panel', 'lang-first-run.panel', 'testplay.canvas', 'fps', 'saved-flash']) assert(layout.includes(`'${id}'`), id);
  assert(read('src/components/UnsavedDialog.tsx').includes('id="unsaved.save"'), '未保存操作按钮');
  assert(read('src/components/FirstRunWizard.tsx').includes('id="first-run.finish"'), '向导完成按钮');
  assert(read('src/components/TestPlayOverlay.tsx').includes('id={`testplay.mod.${m}`}'), 'TestPlay 动态 Mod ID');
  assert(read('src/components/LangFirstRun.tsx').includes('id={`lang-first-run.${l.id}`}'), '语言按钮稳定 ID');
}

console.log('== B: CDP 更新徽章文本 + 忽略图标');
{
  const PORT = 9550;
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
      window.__osuUpdateTest({ version: '9.9.9', url: 'https://example.invalid', body: '' }); await sleep(100);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('update.open'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Update Available');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.text = document.querySelector('[data-ui-id="update.open"]').textContent;
      select('update.dismiss'); await sleep(80);
      const icon = document.querySelector('[data-ui-layout="icon"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(icon, 'lucide:Pause');
      icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      out.icon = !!document.querySelector('[data-ui-id="update.dismiss"] svg.lucide-pause');
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Update Available');
      return out;
    })()`);
    assert(out.text === 'Update Available', `更新徽章文本覆盖 (${out.text})`);
    assert(out.icon, '更新忽略图标覆盖');
    assert(out.persisted, '全局覆盖层配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V536_FAILED: ${failures} 处失败` : '\nVERIFIER_V536_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

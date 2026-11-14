// v532: 动态弹窗作用域、标题/关闭按钮与共享数值控件布局
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v532/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 动态配置纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v532/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const dialog = read('src/components/DraggableDialog.tsx'), adapter = read('src/components/uiLayout/UiControl.tsx');
  assert(adapter.includes('UiScopeContext') && adapter.includes('registerUiControls'), '动态窗口作用域注册');
  assert(dialog.includes('localId="title"') && dialog.includes('localId="close"'), '弹窗标题和关闭按钮');
  assert(dialog.includes('localId={`input.${uiId ?? testid}`}') && dialog.includes('localId={`percent.${testid}`}'), '共享 DraftNum/ClickPct 接入 (v533 支持规则 UID)');
}

console.log('== C: CDP 标题文本/关闭图标/动态数值框屏蔽');
{
  const PORT = 9546;
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
      document.querySelector('[data-ui-id="chrome.display"]').click(); await sleep(180);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.display-panel.title'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'View');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.title = document.querySelector('[data-ui-id="dialog.display-panel.title"]').textContent;
      select('dialog.display-panel.close'); await sleep(80);
      const icon = document.querySelector('[data-ui-layout="icon"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(icon, 'lucide:Pause');
      icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      out.icon = !!document.querySelector('[data-ui-id="dialog.display-panel.close"] svg.lucide-pause');
      document.querySelector('[data-dialog="ui-layout-editor"] .cursor-move button').click(); await sleep(100);
      document.querySelector('[data-ui-id="dialog.display-panel.close"]').click(); await sleep(100);
      document.querySelector('[data-ui-id="inspector.polygon"]').click(); await sleep(150);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.polygon.input.vertices'); await sleep(80);
      const visible = document.querySelector('[data-ui-editor] input[type="checkbox"]');
      visible.click(); await sleep(100);
      out.hidden = document.querySelector('[data-ui-id="dialog.polygon.input.vertices"]').hidden;
      visible.click(); await sleep(80);
      out.shown = !document.querySelector('[data-ui-id="dialog.polygon.input.vertices"]').hidden;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('dialog.polygon.input.vertices');
      return out;
    })()`);
    assert(out.title === 'View', `弹窗标题文本覆盖 (${out.title})`);
    assert(out.icon, '弹窗关闭图标覆盖');
    assert(out.hidden && out.shown, '动态 DraftNum 屏蔽/恢复');
    assert(out.persisted, '动态弹窗控件配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V532_FAILED: ${failures} 处失败` : '\nVERIFIER_V532_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

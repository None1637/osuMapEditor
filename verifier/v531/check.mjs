// v531: Song Setup 与 Timing 表单/动态行模板接入自定义布局
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
  const layout = read('src/osu/uiLayout.ts'), setup = read('src/components/SetupPage.tsx'), timing = read('src/components/TimingPanel.tsx');
  for (const id of ['timing.panel', 'timing.row-delete']) assert(layout.includes(id), id);
  assert(layout.includes("['general', 'editor', 'metadata', 'difficulty']") && layout.includes("'slider-multiplier', 'slider-tick-rate'"), 'Setup 分区和字段注册');
  assert(setup.includes('id={`setup.${id}`}') && setup.includes('id="setup.slider-multiplier"'), 'Setup 字段稳定 ID');
  assert(timing.includes('id="timing.row-time"') && timing.includes('id="timing.row-delete"'), 'Timing 动态行模板 ID');
  assert(timing.includes('id="timing.detect-bpm"') && timing.includes('id={`timing.tab-${k}`}'), 'Timing 工具栏和页签 ID');
}

console.log('== B: CDP Setup 字段屏蔽/文本 + Timing 按钮文本');
{
  const PORT = 9545;
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
      const setText = value => {
        const input = document.querySelector('[data-ui-layout="text-en"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const closeEditor = async () => {
        document.querySelector('[data-dialog="ui-layout-editor"] .cursor-move button').click(); await sleep(100);
      };
      document.querySelector('[data-ui-id="chrome.tab.setup"]').click(); await sleep(150);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('setup.audio-filename'); await sleep(80);
      setText('Audio'); await sleep(80);
      const audio = document.querySelector('[data-ui-id="setup.audio-filename"]');
      out.setupText = audio.closest('label').textContent;
      const visible = document.querySelector('[data-ui-editor] input[type="checkbox"]');
      visible.click(); await sleep(100); out.hidden = audio.hidden;
      visible.click(); await sleep(80); out.shown = !audio.hidden;
      await closeEditor();
      document.querySelector('[data-ui-id="chrome.tab.timing"]').click(); await sleep(180);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('timing.add-red'); await sleep(80); setText('Add BPM'); await sleep(100);
      out.timingText = document.querySelector('[data-ui-id="timing.add-red"]').textContent;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Add BPM');
      return out;
    })()`);
    assert(out.setupText?.trim() === 'Audio', `Setup 字段标签文本覆盖 (${out.setupText})`);
    assert(out.hidden && out.shown, 'Setup 输入框屏蔽/恢复');
    assert(out.timingText === 'Add BPM', `Timing 按钮文本覆盖 (${out.timingText})`);
    assert(out.persisted, 'Setup/Timing 配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V531_FAILED: ${failures} 处失败` : '\nVERIFIER_V531_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

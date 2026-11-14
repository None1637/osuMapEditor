// v534: 显示/音量/辅助线/快捷键/Pattern 面板控件布局覆盖
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
  const display = read('src/components/DisplayPanel.tsx'), volume = read('src/components/VolumePanel.tsx');
  const geo = read('src/components/GeoSnapPanel.tsx'), hotkey = read('src/components/HotkeyPanel.tsx'), pattern = read('src/components/PatternPanel.tsx');
  assert(display.includes('localId={`toggle.${r.key}`}') && display.includes('localId={`select.${r.key}`}'), '显示开关/下拉');
  assert(volume.includes('localId={`slider.${r.key}`}') && volume.includes('UiAutoText'), '音量滑条/文本');
  assert(geo.includes('localId="distance-value"') && geo.includes('localId={`scope.${o.v}`}'), '辅助线输入/范围');
  assert(hotkey.includes('localId={`action.${a.id}.binding.${i}`}') && hotkey.includes('uiId="reset-all"'), '快捷键行动态 ID/重置');
  assert(pattern.includes('localId="collect"') && pattern.includes('localId={`card.${p.id}.delete`}'), 'Pattern 收藏/卡片控件');
}

console.log('== B: CDP 显示开关屏蔽 + 快捷键重置文本');
{
  const PORT = 9548;
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
      const closeEditor = async () => { document.querySelector('[data-dialog="ui-layout-editor"] .cursor-move button').click(); await sleep(100); };
      document.querySelector('[data-ui-id="chrome.display"]').click(); await sleep(180);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.display-panel.toggle.showFps'); await sleep(80);
      const visible = document.querySelector('[data-ui-editor] input[type="checkbox"]');
      visible.click(); await sleep(100);
      out.hidden = document.querySelector('[data-ui-id="dialog.display-panel.toggle.showFps"]').hidden;
      visible.click(); await sleep(80);
      out.shown = !document.querySelector('[data-ui-id="dialog.display-panel.toggle.showFps"]').hidden;
      await closeEditor();
      document.querySelector('[data-ui-id="dialog.display-panel.close"]').click(); await sleep(100);
      document.querySelector('[data-ui-id="chrome.hotkeys"]').click(); await sleep(150);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.hotkey-panel.reset-all'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Reset Keys');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.text = document.querySelector('[data-ui-id="dialog.hotkey-panel.reset-all"]').textContent;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Reset Keys');
      return out;
    })()`);
    assert(out.hidden && out.shown, '显示开关屏蔽/恢复');
    assert(out.text === 'Reset Keys', `快捷键按钮文本覆盖 (${out.text})`);
    assert(out.persisted, '设置面板配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V534_FAILED: ${failures} 处失败` : '\nVERIFIER_V534_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

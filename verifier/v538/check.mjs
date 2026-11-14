// v538: 自定义布局撤销/重做与多选批量宽高
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v538/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v538/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const core = read('src/osu/uiLayout.ts'), editor = read('src/components/uiLayout/UiLayoutEditor.tsx'), app = read('src/App.tsx');
  assert(core.includes('undoUiLayout') && core.includes('setUiOverrides'), '布局历史与批量写入 API');
  assert(core.includes('beginUiLayoutGesture') && core.includes('gestureActive'), '手势历史合并');
  assert(editor.includes('e.ctrlKey || e.metaKey') && editor.includes('data-ui-multi-selection'), 'Ctrl/Cmd 多选与提示');
  assert(app.includes('isUiLayoutEditorOpen()') && app.includes("cmd.type === 'edit-undo'"), '键盘与原生菜单路由');
}

console.log('== C: CDP 多选宽高 + Ctrl+Z/Ctrl+Y');
{
  const PORT = 9552;
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) })).json();
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
      const r = await Promise.race([
        send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CDP eval 超时')), 10000)),
      ]);
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);
    const out = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const click = (id, ctrl = false) => {
        const b = document.querySelector('[data-ui-tree-select="' + id + '"]'); // v539: 树只显示末段, 用稳定选择器
        if (!b) throw new Error('找不到控件: ' + id);
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl }));
      };
      const setNum = (testid, value) => {
        const input = document.querySelector('[data-conv="' + testid + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
      };
      const widths = () => ['chrome.volume', 'chrome.hotkeys'].map(id => document.querySelector('[data-ui-id="' + id + '"]').style.width);
      const heights = () => ['chrome.volume', 'chrome.hotkeys'].map(id => document.querySelector('[data-ui-id="' + id + '"]').style.height);
      const key = (key, shift = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
      document.querySelector('[data-ui-layout-open]').click(); await sleep(200);
      click('chrome.volume'); click('chrome.hotkeys', true); await sleep(100);
      out.multi = document.querySelector('[data-ui-multi-selection]')?.textContent;
      setNum('ui-width', 120); await sleep(100); out.widths = widths();
      setNum('ui-height', 48); await sleep(100); out.heights = heights();
      key('z'); await sleep(100); out.afterUndoHeight = heights();
      key('z'); await sleep(100); out.afterUndoWidth = widths();
      key('y'); await sleep(100); key('y'); await sleep(100); out.afterRedo = [widths(), heights()];
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('"width":120');
      return out;
    })()`);
    assert(out.multi?.includes('2'), `多选提示 (${out.multi})`);
    assert(out.widths?.every(x => x === '120px') && out.heights?.every(x => x === '48px'), '批量宽高应用全部选中控件');
    assert(out.afterUndoHeight?.every(x => x === '') && out.afterUndoWidth?.every(x => x === ''), 'Ctrl+Z 分步撤销高度与批量宽度');
    assert(JSON.stringify(out.afterRedo) === JSON.stringify([['120px', '120px'], ['48px', '48px']]), 'Ctrl+Y 重做批量修改');
    assert(out.persisted, '多选布局配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V538_FAILED: ${failures} 处失败` : '\nVERIFIER_V538_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

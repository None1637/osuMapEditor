// v533: 转换弹窗业务按钮、勾选/单选/下拉及规则 UID 布局配置
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
  for (const file of ['PolygonDialog', 'SplitDialog', 'StreamDialog', 'SymSliderDialog', 'DuplicateDialog', 'AnchorStampDialog']) {
    const src = read(`src/components/convert/${file}.tsx`);
    assert(src.includes('DialogButton') && src.includes('uiId="apply"'), `${file} 应用/取消按钮`);
  }
  const stamp = read('src/components/convert/AnchorStampDialog.tsx');
  assert(stamp.includes('uiId={`rule.${r.uid}.priority`}') && stamp.includes('uiId={`rule.${r.uid}.capture`}'), '动态规则使用 UID 而非数组下标');
  assert(read('src/components/DraggableDialog.tsx').includes('export function DialogButton'), '共享弹窗文本按钮适配器');
}

console.log('== B: CDP 应用按钮文本 + New Combo 屏蔽恢复');
{
  const PORT = 9547;
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
      document.querySelector('[data-ui-id="inspector.polygon"]').click(); await sleep(150);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.polygon.apply'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Generate');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.text = document.querySelector('[data-ui-id="dialog.polygon.apply"]').textContent;
      select('dialog.polygon.new-combo'); await sleep(80);
      const visible = document.querySelector('[data-ui-editor] input[type="checkbox"]');
      visible.click(); await sleep(100);
      out.hidden = document.querySelector('[data-ui-id="dialog.polygon.new-combo"]').hidden;
      visible.click(); await sleep(80);
      out.shown = !document.querySelector('[data-ui-id="dialog.polygon.new-combo"]').hidden;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Generate');
      return out;
    })()`);
    assert(out.text === 'Generate', `业务按钮文本覆盖 (${out.text})`);
    assert(out.hidden && out.shown, '弹窗勾选项屏蔽/恢复');
    assert(out.persisted, '业务控件配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V533_FAILED: ${failures} 处失败` : '\nVERIFIER_V533_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

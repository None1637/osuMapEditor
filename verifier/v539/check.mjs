// v539: 控件树、按钮文本省略与 flow/absolute 布局方式编辑
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v539/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 树构建纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v539/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const tree = read('src/components/uiLayout/UiControlTree.tsx'), editor = read('src/components/uiLayout/UiLayoutEditor.tsx');
  assert(tree.includes('buildUiControlTree') && tree.includes('data-ui-tree-toggle'), '树组件与折叠');
  assert(tree.includes('currentButtonText') && tree.includes('block truncate'), '按钮文本与溢出省略');
  assert(editor.includes('data-ui-layout="mode"') && editor.includes('testid="ui-position-x"'), '布局模式与绝对坐标输入');
}

console.log('== C: CDP 树/文本/布局模式');
{
  const PORT = 9553;
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
      const select = id => document.querySelector('[data-ui-tree-select="' + id + '"]');
      const setSelect = value => {
        const el = document.querySelector('[data-ui-layout="mode"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const setNum = (testid, value) => {
        const el = document.querySelector('[data-conv="' + testid + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      document.querySelector('[data-ui-layout-open]').click(); await sleep(200);
      out.tree = !!document.querySelector('[data-ui-tree-toggle="chrome"]');
      document.querySelector('[data-ui-tree-toggle="chrome"]').click(); await sleep(80);
      out.collapsed = !select('chrome.volume');
      document.querySelector('[data-ui-tree-toggle="chrome"]').click(); await sleep(80);
      out.expanded = !!select('chrome.volume');
      select('chrome.volume').click(); await sleep(100);
      out.text = select('chrome.volume').textContent;
      out.title = select('chrome.volume').title;
      out.truncate = select('chrome.volume').querySelector('.truncate')?.classList.contains('truncate');
      setSelect('absolute'); await sleep(100);
      setNum('ui-position-x', 20); setNum('ui-position-y', 30); await sleep(100);
      const volume = document.querySelector('[data-ui-id="chrome.volume"]');
      out.absolute = [volume.style.position, volume.style.left, volume.style.top];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(60);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(60);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(100);
      out.flow = volume.style.position !== 'absolute';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(100);
      out.redoAbsolute = volume.style.position === 'absolute';
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('"mode":"absolute"');
      return out;
    })()`);
    assert(out.tree && out.collapsed && out.expanded, '控件树折叠/展开');
    assert(out.text?.includes('Volume') && out.title?.includes('chrome.volume') && out.truncate, `按钮文本与省略 (${out.text})`);
    assert(JSON.stringify(out.absolute) === JSON.stringify(['absolute', '20px', '30px']), 'absolute 与 x/y 生效');
    assert(out.flow && out.redoAbsolute, '撤销切回 flow, 重做恢复 absolute');
    assert(out.persisted, '布局方式配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V539_FAILED: ${failures} 处失败` : '\nVERIFIER_V539_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

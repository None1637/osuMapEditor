// v526: 菜单稳定布局 ID + 文本/隐藏/禁用同步原生与自绘菜单
// 运行: npm run build 后 node verifier/v526/check.mjs
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
  const main = read('electron/main.cjs'), bar = read('src/components/MenuBar.tsx');
  const bridge = read('src/osu/electronBridge.ts'), layout = read('src/osu/uiLayout.ts');
  assert(/serializeMenuItems\(items, prefix = "menu"\)/.test(main) && /uiId: path/.test(main), '菜单结构路径永久 ID');
  assert(/applyMenuUiOverrides\(template\)/.test(main) && /ui-menu-overrides/.test(main), '主进程应用菜单覆盖');
  assert(/registerUiControls/.test(bar) && /UiText/.test(bar), '菜单动态注册并复用文本适配器');
  assert(/uiMenuOverrides/.test(bridge), '桥接类型同步');
  assert(/registerUiControls\(defs/.test(layout), '动态控件注册核心');
}

console.log('== B: CDP 菜单文本/隐藏/禁用');
{
  const PORT = 9540;
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
      const closeEditor = () => {
        const x = document.querySelector('[data-dialog="ui-layout-editor"] .lucide-x');
        if (x) x.closest('button').click();
      };
      const listSelect = id => {
        const b = [...document.querySelectorAll('[data-ui-editor] button')].find(x => x.textContent.trim() === id);
        if (!b) throw new Error('找不到菜单控件: ' + id);
        b.click();
      };
      document.querySelector('[data-ui-layout-open]').click(); await sleep(200);
      const file = document.querySelector('[data-ui-id="menu.0"]');
      file.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(80);
      const input = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Files');
      input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(250);
      out.text = file.textContent;
      let checks = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks[0].click(); await sleep(100); out.hidden = file.hidden;
      checks[0].click(); await sleep(100); out.shown = !file.hidden;
      listSelect('menu.0.0'); await sleep(80);
      checks = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks[1].click(); await sleep(200);
      closeEditor(); await sleep(100);
      file.click(); await sleep(100);
      const newItem = () => [...document.querySelectorAll('[data-menu-item]')].find(x => x.textContent.includes('New Beatmap'));
      out.disabled = !!newItem()?.disabled;
      file.click(); await sleep(80); // 先收起, 后段再打开验证恢复
      document.querySelector('[data-ui-layout-open]').click(); await sleep(100);
      listSelect('menu.0.0'); await sleep(80);
      checks = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks[1].click(); await sleep(150); closeEditor(); await sleep(100);
      file.click(); await sleep(100);
      out.enabled = !!newItem() && !newItem().disabled;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Files');
      return out;
    })()`);
    assert(out.text === 'Files', `菜单文本覆盖 (${out.text})`);
    assert(out.hidden && out.shown, '菜单隐藏/取消隐藏');
    assert(out.disabled && out.enabled, `菜单禁用/恢复 (${out.disabled}/${out.enabled})`);
    assert(out.persisted, '菜单配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V526_FAILED: ${failures} 处失败` : '\nVERIFIER_V526_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

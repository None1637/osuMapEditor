// v524: 自定义控件布局核心 (注册表/稀疏覆盖/校验/导入导出)
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v524/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v524/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

console.log('== B: 源码契约');
{
  const src = fs.readFileSync(path.join(root, 'src/osu/uiLayout.ts'), 'utf8');
  assert(/UI_CONTROLS/.test(src) && /z\.literal\('osu-map-editor'\)/.test(src), '永久注册表 + Zod 应用校验');
  assert(/visible\?: boolean/.test(src) && /enabled\?: boolean/.test(src), '屏蔽/禁用配置');
  assert(/localStorage/.test(src) && /exportUiLayout/.test(src) && /importUiLayout/.test(src), '持久化与导入导出');
  assert(/BACKUP_KEY/.test(src) && /restoreUiLayoutBackup/.test(src), '导入前备份与恢复');
}

console.log('== C: CDP 真实控件拖动/文本/图标/隐藏/禁用');
{
  const PORT = 9538;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      document.querySelector('[data-ui-layout-open]').click(); await sleep(200);
      out.editorOpen = !!document.querySelector('[data-dialog="ui-layout-editor"]');
      const play = document.querySelector('[data-ui-id="timeline.bottom.play"]');
      const r = play.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      play.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 30, clientY: y + 15, buttons: 1, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 30, clientY: y + 15, bubbles: true }));
      await sleep(150);
      out.dragTransform = play.style.transform;
      const tab = document.querySelector('[data-ui-id="chrome.tab.timing"]');
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(100);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(text, 'TimingCustom'); text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.tabText = tab.textContent;
      play.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(100);
      const icon = document.querySelector('[data-ui-layout="icon"]');
      const ss = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      ss.call(icon, 'lucide:Pause'); icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      out.iconChanged = !!play.querySelector('svg.lucide-pause');
      const checks = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks[0].click(); await sleep(80); out.hidden = play.hidden;
      checks[0].click(); await sleep(80); out.shown = !play.hidden;
      checks[1].click(); await sleep(80);
      document.querySelector('[data-dialog="ui-layout-editor"] .lucide-x').closest('button').click(); await sleep(100);
      out.playDisabledAfterDisable = play.disabled;
      play.click(); out.disabledNoPlay = !s.playing;
      document.querySelector('[data-ui-layout-open]').click(); await sleep(100);
      play.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(100);
      const checks2 = [...document.querySelectorAll('[data-ui-editor] input[type="checkbox"]')];
      checks2[1].click(); await sleep(80);
      document.querySelector('[data-dialog="ui-layout-editor"] .lucide-x').closest('button').click(); await sleep(100);
      play.click(); out.enabledWorks = s.playing; s.pause();
      out.playDisabledAfterRestore = play.disabled;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('TimingCustom');
      return out;
    })()`);
    assert(out.editorOpen, '布局编辑器打开');
    const dm = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(out.dragTransform || '');
    assert(dm && Math.abs(parseFloat(dm[1]) - 30) < 1 && Math.abs(parseFloat(dm[2]) - 15) < 1, `真实控件拖动 (${out.dragTransform})`);
    assert((out.tabText || '').includes('TimingCustom'), '控件文本覆盖即时生效');
    assert(out.iconChanged, 'lucide 图标替换即时生效');
    assert(out.hidden && out.shown, '屏蔽后可从编辑器取消屏蔽');
    assert(out.disabledNoPlay && out.enabledWorks, `禁用不触发业务操作, 恢复后正常 (${JSON.stringify(out)})`);
    assert(out.persisted, '配置写入 localStorage');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V524_FAILED: ${failures} 处失败` : '\nVERIFIER_V524_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

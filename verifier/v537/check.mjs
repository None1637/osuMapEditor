// v537: 曲库/皮肤/时间轴/零散弹窗与布局编辑器自身控件覆盖
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
  const layout = read('src/osu/uiLayout.ts'), library = read('src/components/SongLibrary.tsx');
  for (const id of ['library.panel', 'library.entry', 'skin-picker.panel', 'skin-list.row', 'timeline.bottom.canvas', 'timeline.selection-info', 'shift-all.panel']) assert(layout.includes(`'${id}'`), id);
  assert(library.includes('id="library.search"') && library.includes('id="library.open"'), '曲库搜索/打开');
  assert(read('src/components/Timelines.tsx').includes('id="timeline.top.wave-mode"'), '时间轴波形控件');
  const editor = read('src/components/uiLayout/UiLayoutEditor.tsx');
  assert(editor.includes('localId="search"') && editor.includes('localId="export"') && editor.includes('localId="reset-all"'), '布局编辑器自身控件');
  assert(editor.includes("!c.id.startsWith('dialog.ui-layout-editor.item.')"), '派生列表项过滤, 防止递归注册');
}

console.log('== B: CDP 编辑器打开/控件选择 + 时间轴图标');
{
  const PORT = 9551;
  // 标准隔离环境; 本用例不打开曲库, 不扫描 Songs 目录
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
    await evalJs(`document.querySelector('[data-ui-layout-open]').click(); 'opened'`);
    await evalJs(`document.querySelector('[data-ui-tree-select="timeline.top.zoom-in"]').click(); 'selected'`); // v539 树选择器
    const out = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const icon = document.querySelector('[data-ui-layout="icon"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(icon, 'lucide:Pause');
      icon.dispatchEvent(new Event('change', { bubbles: true })); await sleep(150);
      return {
        icon: !!document.querySelector('[data-ui-id="timeline.top.zoom-in"] svg.lucide-pause'),
        persisted: (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('timeline.top.zoom-in'),
      };
    })()`);
    assert(out.icon, '时间轴缩放图标覆盖');
    assert(out.persisted, '末批控件配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V537_FAILED: ${failures} 处失败` : '\nVERIFIER_V537_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

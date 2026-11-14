// v528: 自定义 PNG/WebP 图标上传、资源持久化和导出
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v528/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v528/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const layout = read('src/osu/uiLayout.ts'), editor = read('src/components/uiLayout/UiLayoutEditor.tsx');
  assert(/addUiIconAsset/.test(layout) && /Only PNG\/WebP/.test(layout), 'PNG/WebP 白名单资源库');
  assert(/data-ui-layout="icon-upload"/.test(editor), '布局编辑器图标上传入口');
  assert(/asset:/.test(read('src/components/uiLayout/UiControl.tsx')), 'UiIcon 支持资源引用');
}

console.log('== C: CDP 实际上传与应用');
{
  const PORT = 9542;
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
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      const play = document.querySelector('[data-ui-id="timeline.bottom.play"]');
      play.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(80);
      const input = document.querySelector('[data-ui-layout="icon-upload"]');
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9q6ioAAAAASUVORK5CYII=';
      const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300);
      const img = play.querySelector('img');
      return { custom: !!img && img.src.startsWith('data:image/png;base64,'),
        persisted: (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('"assets"') };
    })()`);
    assert(out.custom, '上传 PNG 后控件实际显示自定义图标');
    assert(out.persisted, '自定义图标随配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V528_FAILED: ${failures} 处失败` : '\nVERIFIER_V528_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

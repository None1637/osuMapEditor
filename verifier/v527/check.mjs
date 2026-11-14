// v527: Canvas/自绘区域布局 — 尺寸覆盖、缓存失效、游玩区预留与命中同步
// 运行: npm run build 后 node verifier/v527/check.mjs
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
  const layout = read('src/osu/uiLayout.ts'), zoom = read('src/osu/uiZoom.ts');
  const canvas = read('src/components/EditorCanvas.tsx'), control = read('src/components/uiLayout/UiControl.tsx');
  assert(/timeline\.top\.canvas/.test(layout) && /playfield\.canvas/.test(layout), 'Canvas 永久 ID 注册');
  assert(/invalidateUiZoomRectCache/.test(zoom), '布局变化主动失效 rect 缓存');
  assert(/useEffect\(\(\) => \{ invalidateUiZoomRectCache\(\)/.test(control), 'DOM/Canvas 适配器调用缓存失效');
  assert(/reservedTop/.test(canvas) && /reservedBottom/.test(canvas), '时间轴高度进入游玩区预留');
}

console.log('== B: CDP 高度覆盖与命中一致');
{
  const PORT = 9541;
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
      const base = s.beatmap;
      const circle = { id: 527001, type: 'circle', x: 256, y: 192, time: 0, newCombo: true, comboSkip: 0, hitSound: 0 };
      s.load({ ...base, hitObjects: [circle] }, s.audioUrl); s.pause(); s.seek(0); s.clearSelection();
      const out = { before: window.__osuToClient(256, 192) };
      const select = id => {
        const b = [...document.querySelectorAll('[data-ui-editor] button')].find(x => x.textContent.trim() === id);
        if (!b) throw new Error('找不到控件: ' + id); b.click();
      };
      const setHeight = value => {
        const el = document.querySelector('[data-conv="ui-height"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      document.querySelector('[data-ui-layout-open]').click(); await sleep(200);
      select('timeline.top.canvas'); await sleep(80); setHeight(130); await sleep(250);
      out.topHeight = document.querySelector('[data-ui-id="timeline.top.canvas"]').getBoundingClientRect().height;
      out.after = window.__osuToClient(256, 192);
      select('timeline.bottom.panel'); await sleep(80); setHeight(110); await sleep(200);
      out.bottomHeight = document.querySelector('[data-ui-id="timeline.bottom.panel"]').getBoundingClientRect().height;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('"height":130');
      document.querySelector('[data-dialog="ui-layout-editor"] .lucide-x').closest('button').click(); await sleep(100);
      return out;
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: out.after.x, y: out.after.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: out.after.x, y: out.after.y, button: 'left', clickCount: 1 });
    await sleep(150);
    out.hit = await evalJs(`window.__osuStore.selected.has(527001)`);
    assert(out.topHeight === 130 && out.bottomHeight === 110, `时间轴高度覆盖 (${out.topHeight}/${out.bottomHeight})`);
    assert(out.after.y - out.before.y > 15, `游玩区随时间轴尺寸调整 (${out.before.y}→${out.after.y})`);
    assert(out.hit, '调整后点击新位置仍能选中物件');
    assert(out.persisted, 'Canvas 尺寸配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V527_FAILED: ${failures} 处失败` : '\nVERIFIER_V527_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v478: 两件事 (soulten: 英文菜單字有點小 然後關閉按鈕重疊到頂部 無法透過點選關閉)
//   1) 菜单栏字号 15px → 17px (顶栏标签 + 下拉项; v225 √zoom 缓缩下 1080p 视觉 13px 太小,
//      英文尤其; 快捷键 13px 不动)。
//   2) DraggableDialog 顶栏避让 + 内容滚动: 标题栏(含 X) 恒在 data-app-chrome (菜单栏+页签栏)
//      底沿之下 (打开居中/拖拽钳制/resize 钳制三处); 内容自然高超过剩余视口时内容区
//      maxHeight + overflow-y auto 滚动, 不再只靠 dialogFit 整窗缩小 (英文长文本可读性)。
// 运行: npm run build 后 node verifier/v478/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 菜单栏 17px (v478)');
{
  const mb = read('src/components/MenuBar.tsx');
  assert(!/text-\[15px\]/.test(mb), 'MenuBar 不再有 text-[15px]');
  const n = (mb.match(/text-\[17px\]/g) ?? []).length;
  assert(n === 3, `MenuBar 三处 text-[17px] (顶栏+子菜单行+叶子项, 命中 ${n})`);
  const css = read('src/index.css');
  assert(/\.text-\\\[17px\\\] \{ font-size: max\(calc\(17px \* var\(--fs-comp/.test(css), 'index.css 补 text-[17px] 补偿规则');
}

section('源码: DraggableDialog 顶栏避让 + 内容滚动 (v478)');
{
  const dd = read('src/components/DraggableDialog.tsx');
  assert(/data-app-chrome/.test(dd) && /function chromeBottom/.test(dd), 'chromeBottom() 读顶栏底沿');
  assert(/window\.innerHeight - chrome/.test(dd), '居中区 = 顶栏之下');
  assert(/Math\.max\(chrome, Math\.min\(pos\.y/.test(dd), 'resize 钳制 y 下界 = 顶栏');
  assert(/Math\.max\(chromeBottom\(\), e\.clientY - d\.dy\)/.test(dd), '拖拽 y 下界 = 顶栏');
  assert(/overflowY: 'auto'/.test(dd) && /maxHeight: contentMaxH/.test(dd), '内容区 maxHeight + overflow-y auto');
  const app = read('src/App.tsx');
  assert(/data-app-chrome/.test(app), 'App 页签栏打 data-app-chrome 点');
}

section('CDP: 1920x1080 英文 — 对话框在顶栏之下/内容可滚/X 可点/菜单字号加大');
{
  const PORT = 9487;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs); // 内含切英文
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);

    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setDisplayPanelOpen(true);
      await sleep(800);
      const dlg = document.querySelector('[data-dialog="display-panel"]');
      if (!dlg) return { err: 'no dialog' };
      const chrome = document.querySelector('[data-app-chrome]').getBoundingClientRect().bottom;
      const dr = dlg.getBoundingClientRect();
      const content = dlg.querySelector('.p-3.space-y-2');
      const btn = dlg.querySelector('.flex.items-center.justify-between button');
      const br = btn.getBoundingClientRect();
      const menuTop = document.querySelector('[data-menu-top]');
      const menuFs = parseFloat(getComputedStyle(menuTop).fontSize);
      const zoom = parseFloat(getComputedStyle(document.querySelector('.ui-zoom-root')).zoom);
      return {
        chrome: Math.round(chrome), dlgY: Math.round(dr.y), dlgBottom: Math.round(dr.bottom), vh: window.innerHeight,
        overflow: getComputedStyle(content).overflowY, scrollable: content.scrollHeight > content.clientHeight + 4,
        btnCx: br.x + br.width / 2, btnCy: br.y + br.height / 2,
        menuVisualFs: Math.round(menuFs * zoom * 10) / 10, zoom,
      };
    })()`);
    assert(!r1.err, 'Display Settings 窗口打开');
    assert(r1.dlgY >= r1.chrome, `对话框顶 ≥ 顶栏底沿 (dlgY=${r1.dlgY} chrome=${r1.chrome})`);
    assert(r1.dlgBottom <= r1.vh, `对话框底不超出视口 (bottom=${r1.dlgBottom} vh=${r1.vh})`);
    assert(r1.overflow === 'auto' && r1.scrollable, `英文长内容内容区可滚动 (overflow=${r1.overflow} scrollable=${r1.scrollable})`);
    assert(r1.menuVisualFs >= 14, `菜单视觉字号 ≥ 14px (实际 ${r1.menuVisualFs}px @ zoom=${r1.zoom}; v478 前 13px)`);

    // 真实点击 X 关闭
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r1.btnCx, y: r1.btnCy, button: 'left', clickCount: 1 });
    }
    await sleep(400);
    const closed = await evalJs('!window.__osuStore.displayPanelOpen');
    assert(closed, '真实点击 X 关闭窗口');

    // 拖拽也不能把标题栏拖进顶栏 (合成指针事件拖到 y=-200)
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setDisplayPanelOpen(true);
      await sleep(800);
      const dlg = document.querySelector('[data-dialog="display-panel"]');
      const title = dlg.querySelector('.flex.items-center.justify-between');
      const tr = title.getBoundingClientRect();
      const sx = tr.x + 40, sy = tr.y + tr.height / 2;
      const opts = (x, y) => ({ clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, pointerId: 7 });
      title.dispatchEvent(new PointerEvent('pointerdown', opts(sx, sy)));
      title.dispatchEvent(new PointerEvent('pointermove', opts(sx, -200)));
      title.dispatchEvent(new PointerEvent('pointerup', opts(sx, -200)));
      await sleep(300);
      const dr2 = dlg.getBoundingClientRect();
      const chrome = document.querySelector('[data-app-chrome]').getBoundingClientRect().bottom;
      const closed2 = !store.displayPanelOpen || !document.querySelector('[data-dialog="display-panel"]');
      return { dlgY: Math.round(dr2.y), chrome: Math.round(chrome), stillOpen: !closed2 };
    })()`);
    assert(r2.stillOpen, '拖拽过程中窗口未意外关闭');
    assert(r2.dlgY >= r2.chrome, `拖拽钳制: 对话框顶 ≥ 顶栏底沿 (dlgY=${r2.dlgY} chrome=${r2.chrome})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V478_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V478_ALL_TESTS_PASSED');

// 验证器 v467: 两个显示/选中行为 —
//   1) 关「note 打击动画」(暂留模式) 时滑条在结束 240ms (HIT_FADE) 后不可选中 (点选/框选):
//      滑条大容易误选 — objectSelectableAt 门控 (滑条按滑条身窗口 sliderAnchorInteractiveAt,
//      不随 isVisibleAt 的 HIT_LINGER 残留放到 800ms); 单点/转盘不变; 已选中物件例外照旧 (v273/v277)。
//   2) 测试游玩默认开 note 打击动画 — TestPlayOverlay 挂载期间强制 displaySettings.hitAnimation = true
//      (不持久化), 退出恢复原值; __osuDisplaySettings 暴露供断言。
// 运行: npm run build 后 node verifier/v467/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: objectSelectableAt 门控 + 测试游玩强制开动画');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const objectSelectableAt = \(bm: Beatmap, o: HitObject, time: number\): boolean =>\s*\n?\s*o\.type === 'slider' \? sliderAnchorInteractiveAt\(bm, o, time\) : isVisibleAt\(bm, o, time\);/.test(ec),
    'objectSelectableAt: 滑条按滑条身窗口, 其余 isVisibleAt');
  assert(/hitTest[\s\S]{0,700}?objectSelectableAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\)/.test(ec),
    '单击 hitTest 候选走 objectSelectableAt (v273 选中例外保留)');
  assert(/!objectSelectableAt\(bm, o, store\.currentTime\) && store\.selected\.has\(o\.id\)/.test(ec), '框选 keepHidden 走同一门控 (v277)');
  assert(/objectsInRect\([\s\S]{0,120}?bm\.hitObjects\.filter\(o => objectSelectableAt\(bm, o, store\.currentTime\)\)/.test(ec), '框选候选走同一门控');
  const tp = read('src/components/TestPlayOverlay.tsx');
  assert(/const prevHitAnimation = displaySettings\.hitAnimation;\s*\n\s*displaySettings\.hitAnimation = true;/.test(tp), '挂载时强制开打击动画 (记住原值)');
  assert(/displaySettings\.hitAnimation = prevHitAnimation;/.test(tp), '退出恢复原值');
  assert(!/setDisplayFlag\('hitAnimation'/.test(tp), '不走 setDisplayFlag (不持久化)');
  assert(/__osuDisplaySettings = displaySettings/.test(read('src/osu/displaySettings.ts')), 'displaySettings 暴露给 CDP');
}

section('CDP: 暂留模式滑条 end+240 后不可选 + 测试游玩强制开动画');
{
  const PORT = 9499;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await sleep(500);

    const r = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = { ...base.timingPoints.find(p => p.uninherited), time: 1000, beatLength: 500 };
      const SM = base.difficulty.sliderMultiplier;
      const t = 5000, L = 100 * SM; // 时长恰好 500ms → end = 5500
      const slider = { id: 967001, type: 'slider', x: 256, y: 192, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 400, y: 192 }], slides: 1, length: L };
      store.load({ ...base, timingPoints: [red0], hitObjects: [slider] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.clearSelection();
      const cv = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
      const click = async () => {
        const p = window.__osuToClient(256, 192); // 滑条头中心
        cv.dispatchEvent(new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, button: 0, bubbles: true, cancelable: true }));
        cv.dispatchEvent(new MouseEvent('mouseup', { clientX: p.x, clientY: p.y, button: 0, bubbles: true }));
        await sleep(120);
        return store.selected.has(967001);
      };
      const out = {};
      // 暂留模式 (打击动画关): end+500 (240<dt<800, 头/尾圈仍残留可见) 点头 → 不可选
      store.setDisplayFlag('hitAnimation', false);
      store.seek(6000); await sleep(100);
      out.lingerLate = await click();
      // end+100 (<240) → 可选
      store.clearSelection(); store.seek(5600); await sleep(100);
      out.lingerEarly = await click();
      // 对照: 打击动画开, end+500 → 不可见不可选 (新旧一致)
      store.setDisplayFlag('hitAnimation', true);
      store.clearSelection(); store.seek(6000); await sleep(100);
      out.animLate = await click();
      // 框选门控: 暂留模式 end+500, 框住整个游玩区 → 滑条不入选
      store.setDisplayFlag('hitAnimation', false);
      store.clearSelection(); store.seek(6000); await sleep(100);
      {
        const rect = cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 2, clientY: rect.top + 2, button: 0, bubbles: true, cancelable: true }));
        cv.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.right - 2, clientY: rect.bottom - 2, bubbles: true }));
        await sleep(150);
        out.marqueeLate = store.selected.has(967001);
        cv.dispatchEvent(new MouseEvent('mouseup', { clientX: rect.right - 2, clientY: rect.bottom - 2, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: rect.right - 2, clientY: rect.bottom - 2, bubbles: true }));
        await sleep(80);
      }
      // 测试游玩: 进入强制开, 退出恢复
      store.setDisplayFlag('hitAnimation', false);
      out.beforeTP = window.__osuDisplaySettings.hitAnimation;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
      let opened = false;
      for (let i = 0; i < 30 && !opened; i++) { await sleep(300); opened = store.testPlayOpen === true; }
      out.tpOpened = opened;
      out.duringTP = window.__osuDisplaySettings.hitAnimation;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      let closed = false;
      for (let i = 0; i < 30 && !closed; i++) { await sleep(300); closed = store.testPlayOpen === false; }
      out.tpClosed = closed;
      out.afterTP = window.__osuDisplaySettings.hitAnimation;
      store.setDisplayFlag('hitAnimation', true); // 还原默认
      return out;
    })()`);
    assert(r.lingerLate === false, '暂留模式 end+500 点头不可选 (滑条已结束 >240ms)');
    assert(r.lingerEarly === true, '暂留模式 end+100 点头可选 (<240ms)');
    assert(r.animLate === false, '对照: 打击动画开 end+500 同样不可选 (行为一致)');
    assert(r.marqueeLate === false, '暂留模式 end+500 框选不含该滑条');
    assert(r.tpOpened === true, 'F5 打开测试游玩');
    assert(r.beforeTP === false && r.duringTP === true, `测试游玩期间强制开打击动画 (${r.beforeTP}→${r.duringTP})`);
    assert(r.tpClosed === true && r.afterTP === false, `退出测试游玩恢复原值 (closed=${r.tpClosed}, after=${r.afterTP})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V467_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V467_ALL_TESTS_PASSED');

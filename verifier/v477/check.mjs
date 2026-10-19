// 验证器 v477: 旋转窗口打开自动聚焦角度框 (soulten: 打開的時候能不能直接透過鍵盤輸入角度)
//   TransformDialog rotate 模式挂载后 focus + select 角度输入框, 键入直接替换当前值。
// 运行: npm run build 后 node verifier/v477/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 旋转窗口自动聚焦角度框 (v477)');
{
  const td = read('src/components/TransformDialog.tsx');
  assert(/v477: 打开旋转窗口自动聚焦角度输入框并全选/.test(td), 'v477 注释在');
  assert(/mode !== 'rotate'\) return;[\s\S]{0,200}el\?\.focus\(\);[\s\S]{0,50}el\?\.select\(\);/.test(td), 'rotate 模式挂载后 focus + select');
  assert(/\[data-dialog="rotate-dlg"\] \[data-conv="angle"\]/.test(td), '选择器指向 rotate-dlg 角度框');
}

section('CDP: 打开旋转窗口 → 焦点在角度框且全选 → 键入直接替换');
{
  const PORT = 9483;
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
    await normalizeEnv(evalJs);

    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const circle = { ...(base.hitObjects.find(o => o.type === 'circle') || base.hitObjects[0]),
        id: 477001, type: 'circle', time: 5000, x: 100, y: 100 };
      store.load({ ...base, hitObjects: [circle] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      store.seek(4500); store.select([477001]);
      store.openTransformDialog('rotate');
      await sleep(300);
      const el = document.querySelector('[data-dialog="rotate-dlg"] [data-conv="angle"]');
      if (!el) return { found: false };
      const focused = document.activeElement === el;
      const selected = el.selectionStart === 0 && el.selectionEnd === el.value.length;
      return { found: true, focused, selected, value: el.value };
    })()`);
    assert(r1.found, '角度输入框存在');
    assert(r1.focused, `打开即聚焦角度框 (${JSON.stringify(r1)})`);
    // number 输入框不支持 selection API (Chrome selectionStart 恒 null) — 全选与否由下方键入替换行为证明
    assert(r1.selected || r1.value === '0', `当前值就绪 (selectionStart=null 是 number 框常态)`);

    // 键入 45 (CDP Input.insertText = 真实文本输入, 替换选区)
    await send('Input.insertText', { text: '45' });
    await sleep(300);
    const r2 = await evalJs(`(() => {
      const el = document.querySelector('[data-dialog="rotate-dlg"] [data-conv="angle"]');
      return { value: el.value, x: window.__osuStore.beatmap.hitObjects.find(o => o.id === 477001).x,
        y: window.__osuStore.beatmap.hitObjects.find(o => o.id === 477001).y };
    })()`);
    assert(r2.value === '45', `键入后角度框 = 45 (= 全选替换生效, 否则会得到 045; 实际 ${r2.value})`);
    // 默认原点 = 选区中心, 单物件绕自身中心旋转不动 — 改原点为游玩区中心验预览生效
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setOriginMode('playfield');
      await sleep(300);
      const o = store.beatmap.hitObjects.find(x => x.id === 477001);
      return { x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10 };
    })()`);
    // 预览态: (100,100) 绕 (256,192) 顺时针 45° (屏幕 y 向下, cw: x'=x·c-y·s, y'=x·s+y·c):
    //   Δ=(-156,-92) → Δ'=(-64·0.7071, -248·0.7071)=(-45.3,-175.4) → ≈(210.7, 16.6)
    assert(Math.abs(r3.x - 210.7) < 0.6 && Math.abs(r3.y - 16.6) < 0.6,
      `45° 实时预览生效 (期望 ≈(210.7,16.6), rotateObjects 结果取整; 实际 ${JSON.stringify(r3)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V477_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V477_ALL_TESTS_PASSED');

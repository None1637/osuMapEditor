// 验证器 v475: 两件事
//   1) 缩放浮窗双按钮 (soulten: 下面按鈕來個應用倍率(會關閉) 跟應用倍率但不關閉的功能) —
//      「应用倍率」应用后自动关窗 (同 v463 旋转); 新增「应用倍率但不关闭」保持开窗可连续应用。
//   2) 全局视觉最小字号 12px → 13px (soulten: 字體會不會有點小) — index.css 的
//      max(calc(原补偿), calc(13px / var(--ui-zoom,1))) 下限上调, zoom=1 时 <13px 基础字号
//      (text-xs 与 9/10/11/12px 任意值类) 一并抬到 13px。
// 运行: npm run build 后 node verifier/v475/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 缩放浮窗双按钮 (会关闭 / 但不关闭)');
{
  const td = read('src/components/TransformDialog.tsx');
  assert(td.includes('scaleObjects(objs, c, sx, sy)); store.closeTransformDialog();'),
    '「应用倍率」onClick = commit + closeTransformDialog (会关闭)');
  assert(/data-tf="apply-scale-stay"/.test(td), '「应用倍率但不关闭」按钮存在 (data-tf=apply-scale-stay)');
  const stayAt = td.indexOf('data-tf="apply-scale-stay"');
  assert(!td.slice(stayAt - 400, stayAt).includes('closeTransformDialog'), '「应用倍率但不关闭」不关窗');
  const dict = read('src/i18n/dicts/zh-CN/transform.ts');
  assert(/'transform\.apply_scale_stay': '应用倍率但不关闭'/.test(dict), 'zh-CN apply_scale_stay 文案');
  assert(/'transform\.apply_scale_stay_title':/.test(dict), 'zh-CN apply_scale_stay_title 文案');
  assert(/「应用倍率」应用后自动关窗; 「应用倍率但不关闭」保持打开可连续应用/.test(dict), 'zh-CN footer_hint 更新为双按钮语义');
}

section('源码: 视觉最小字号 13px (v475)');
{
  const css = read('src/index.css');
  assert(!/calc\(12px \/ var\(--ui-zoom/.test(css), '旧 12px 下限已移除');
  const n = (css.match(/calc\(13px \/ var\(--ui-zoom, 1\)\)/g) ?? []).length;
  assert(n >= 13, `全部字号规则下限改 13px/--ui-zoom (命中 ${n} 处)`);
  assert(/v475: 下限 12px → 13px/.test(css), 'v475 注释在');
}

section('CDP: 缩放浮窗行为 (stay 应用且不关窗 / apply 关窗)');
{
  const PORT = 9476;
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
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await sleep(800);

    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const circle = { ...(base.hitObjects.find(o => o.type === 'circle') || base.hitObjects[0]),
        id: 475001, type: 'circle', time: 5000, x: 100, y: 100 };
      store.load({ ...base, hitObjects: [circle] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      store.seek(4500); store.select([475001]);
      store.setOriginMode('playfield'); // 原点 = 游玩区中心 (256,192), 单物件缩放才有位移
      store.openTransformDialog('scale');
      await sleep(300);
      const dlg0 = !!document.querySelector('[data-dialog="scale-dlg"]');
      // 设倍率 1.5 (React 受控 input: 原生 setter + input 事件)
      const slider = document.querySelector('[data-dialog="scale-dlg"] [data-tf="factor-slider"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '1.5');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      // 「应用倍率但不关闭」— 应用且保持开窗
      document.querySelector('[data-dialog="scale-dlg"] [data-tf="apply-scale-stay"]').click();
      await sleep(300);
      const o1 = store.beatmap.hitObjects.find(x => x.id === 475001);
      const stayedOpen = !!document.querySelector('[data-dialog="scale-dlg"]') && store.transformDialog === 'scale';
      const scaled = { x: o1.x, y: o1.y }; // 期望 (22, 54): 256+(100-256)*1.5=22, 192+(100-192)*1.5=54
      // 再点「应用倍率」(factor 已重置? 不关心理论值) — 应关窗
      document.querySelector('[data-dialog="scale-dlg"] [data-tf="apply-scale"]').click();
      await sleep(300);
      const closedAfterApply = !document.querySelector('[data-dialog="scale-dlg"]') && !store.transformDialog;
      return { dlg0, stayedOpen, scaled, closedAfterApply };
    })()`);
    assert(r1.dlg0, '缩放浮窗打开');
    assert(r1.stayedOpen, `「应用倍率但不关闭」保持开窗 (${JSON.stringify(r1)})`);
    // 滑条只驱动 x 倍率 (y 框独立, 默认 1 → y 不动); 期望 x: 256+(100-256)*1.5=22, y 不变
    assert(r1.scaled.x === 22 && r1.scaled.y === 100, `stay 按钮实际应用了缩放 (x 100→22 = 1.5x; y 框独立默认 1 不动; 实际 ${JSON.stringify(r1.scaled)})`);
    assert(r1.closedAfterApply, `「应用倍率」点击后自动关窗 (${JSON.stringify(r1)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V475_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V475_ALL_TESTS_PASSED');

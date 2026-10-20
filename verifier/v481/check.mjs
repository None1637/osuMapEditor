// 验证器 v481: 滑条转连打窗口「下半部分不记忆, 上半有」修复 (soulten 反馈)
//   根因: v398 migrateStreamParams 用 {...DEFAULT, ...raw} 把遗留字段 curve/endPercent/exponent
//   原样带回结果; v242 关窗保存又写回 localStorage → 每次开窗重新迁移, 迁移分支的
//   expoBase/rampPercent 映射覆盖用户对下半部分 (自定义连打间距组) 的修改。
//   修复: 迁移时解构剥掉遗留字段, 迁移结果干净; 老用户首次开窗仍迁移一次 (最后一次),
//   之后关窗保存即干净 blob, 不再重触发。
// 运行: npm run build 后 node verifier/v481/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码');
{
  const stream = read('src/osu/convert/stream.ts');
  assert(/const \{ curve: _c, endPercent: _e, exponent: _x, \.\.\.rest \} = raw/.test(stream), '迁移解构剥掉遗留字段 (v481)');
  assert(/\{ \.\.\.DEFAULT_STREAM_PARAMS, \.\.\.rest \}/.test(stream), '合并改用剥离后的 rest (不再带回 curve)');
  const dlg = read('src/components/convert/StreamDialog.tsx');
  assert(/useSaveParamsOnClose\('stream', params\)/.test(dlg), '关窗保存仍在 (v242)');
  assert(/migrateStreamParams\(loadParams\('stream'/.test(dlg), '开窗走迁移入口');
}

section('CDP: 遗留 blob → 迁移一次 → 改下半部分 → 关窗保存 → 重开全保持');
{
  const PORT = 9492;
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
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    async function evalJs(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result?.result?.value;
    }
    await send('Runtime.enable');
    const waitStore = async () => {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false); }
      if (!ready) throw new Error('store 未就绪');
    };
    await waitStore();
    await normalizeEnv(evalJs);
    // normalizeEnv 清掉了 conv:*, 播种带遗留字段的旧 blob 后刷新页面模拟老用户
    await evalJs(`localStorage.setItem('osu-editor:conv:stream', '{"mode":"count","count":6,"spacingBeats":0.5,"customSpacing":true,"expoBase":3.2,"rampPercent":215,"repeats":2,"mirrorRepeat":true,"curve":"expo","endPercent":50,"exponent":2}'); location.reload(); 'reloading'`);
    await sleep(1500);
    await waitStore();

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const slider = { ...(base.hitObjects.find(o => o.type === 'slider') || base.hitObjects[0]), id: 481001,
        type: 'slider', time: 5000, x: 200, y: 200, curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 300 };
      store.load({ ...base, hitObjects: [slider] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      store.seek(4500); store.select([481001]);
      const g = (sel) => { const el = document.querySelector('[data-dialog="stream"] [data-conv="' + sel + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; };
      // 第一次开窗: 遗留 blob 触发最后一次迁移 (下半部分被遗留映射覆盖一次, 可接受)
      store.openConversion('stream');
      await sleep(400);
      const setNum = (testid, v) => {
        const el = document.querySelector('[data-dialog="stream"] [data-conv="' + testid + '"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const setChk = (sel, on) => {
        const el = document.querySelector('[data-dialog="stream"] [data-conv="' + sel + '"]');
        if (el.checked !== on) el.click();
      };
      // 用户重新设置下半部分
      setNum('expo-base', 3.2);
      setNum('ramp-percent', 215);
      setNum('repeats', 2);
      setChk('mirror-repeat', true);
      await sleep(200);
      document.querySelector('[data-dialog="stream"] .flex.items-center.justify-between button').click(); // X 关窗
      await sleep(300);
      const savedRaw = localStorage.getItem('osu-editor:conv:stream');
      const saved = savedRaw ? JSON.parse(savedRaw) : null;
      // 重开
      store.openConversion('stream');
      await sleep(400);
      const reopened = { modeCount: g('mode-count'), count: g('count'), customSpacing: g('custom-spacing'),
        expoBase: g('expo-base'), rampPercent: g('ramp-percent'), repeats: g('repeats'), mirrorRepeat: g('mirror-repeat') };
      // 再关再开一次, 确认不会二次迁移
      document.querySelector('[data-dialog="stream"] .flex.items-center.justify-between button').click();
      await sleep(300);
      store.openConversion('stream');
      await sleep(400);
      const third = { expoBase: g('expo-base'), rampPercent: g('ramp-percent'), repeats: g('repeats'), mirrorRepeat: g('mirror-repeat') };
      document.querySelector('[data-dialog="stream"] .flex.items-center.justify-between button').click();
      return { saved, reopened, third };
    })()`);

    assert(out.saved && !('curve' in out.saved) && !('endPercent' in out.saved) && !('exponent' in out.saved),
      '关窗保存的 blob 已剥掉遗留字段 (curve/endPercent/exponent), 实际: ' + JSON.stringify(out.saved && Object.keys(out.saved)));
    const r = out.reopened;
    assert(r.expoBase === '3.2', `重开后指数底数保持 3.2, 实际 ${r.expoBase}`);
    assert(r.rampPercent === '215', `重开后倍率保持 215, 实际 ${r.rampPercent}`);
    assert(r.repeats === '2', `重开后重复次数保持 2, 实际 ${r.repeats}`);
    assert(r.mirrorRepeat === true, '重开后镜像重复保持开');
    assert(r.count === '6', `上半部分数量保持 6, 实际 ${r.count}`);
    assert(r.customSpacing === true, '自定义连打间距保持开');
    assert(out.third.expoBase === '3.2' && out.third.repeats === '2' && out.third.mirrorRepeat === true,
      '第三次开窗仍保持 (无二次迁移), 实际: ' + JSON.stringify(out.third));
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

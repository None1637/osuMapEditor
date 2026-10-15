// 验证器 v419: 测试游玩 HUD — Skip 跳过按钮
//  - currentTime 在首个物件前且距离 >3000ms 时, 画面下方中间显示 DOM 按钮「跳过」(i18n);
//  - 点击 store.seek(首物件时间 - 2000), 落地后按钮隐藏; 点按钮不触发击打判定 (data-skip-btn 防护);
//  - 按钮样式参照 mod 栏, 显式 cursor-pointer (v416 覆盖层隐藏系统光标)。
// 运行: npm run build 后 node verifier/v419/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v419/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v419/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V419_TESTS_*)
fs.unlinkSync(out);

section('源码: 显示条件/seek 目标/防护/i18n');
{
  const hud = read('src/osu/gameplay/hud.ts');
  assert(/export function canSkip/.test(hud) && /time < firstTime - 3000/.test(hud), 'canSkip: 首物件前 >3000ms');
  assert(/export function skipTarget/.test(hud) && /firstTime - 2000/.test(hud), 'skipTarget: 首物件 -2000ms');

  const ov = read('src/components/TestPlayOverlay.tsx');
  assert(/canSkip\(time, session\.firstTime\)/.test(ov), 'rAF 内按时间更新可见性');
  assert(/sk !== skipRef\.current/.test(ov), '可见性变化才 setState (不每帧刷新)');
  assert(/data-testid="testplay-skip"/.test(ov) && /data-skip-btn/.test(ov), '跳过按钮挂载点 + 防护属性');
  assert(/store\.seek\(skipTarget\(firstTimeRef\.current\)\)/.test(ov), '点击 seek 到首物件前 2s');
  assert(/\[data-mods-bar\],\[data-skip-btn\]/.test(ov), 'mousedown 防护: 点跳过按钮不触发击打');
  assert(/bottom-16 left-1\/2 -translate-x-1\/2/.test(ov), '按钮位于画面下方中间');
  assert(/testplay-skip"[\s\S]{0,200}?cursor-pointer/.test(ov) || /cursor-pointer"\s*\n?\s*data-testid="testplay-skip"/.test(ov), '跳过按钮恢复 cursor:pointer (v416)');
  assert(/t\('testplay\.skip', 'Skip'\)/.test(ov), 'i18n 键 testplay.skip');

  const dict = read('src/i18n/dicts/zh-CN/panels.ts');
  assert(/'testplay\.skip': '跳过'/.test(dict), 'zh-CN 词典: 跳过');
}

section('CDP: 进测试游玩 → 跳过按钮出现 → 点击 seek → 隐藏 → 退出还原');
{
  const PORT = 9494;
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
    await normalizeEnv(evalJs);

    // 造图: 首物件 10000ms (距开头 >3s, 满足跳过条件), 末物件 14000ms; seek 回开头后进测试游玩
    const entered = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      const base = store.beatmap;
      const mk = (id, t) => ({ id, type: 'circle', x: 256, y: 192, time: t, newCombo: id === 970001, comboSkip: 0, hitSound: 0 });
      store.load({ ...base, hitObjects: [mk(970001, 10000), mk(970002, 14000)] }, store.audioUrl, null);
      store.pause && store.pause();
      store.seek(0);
      document.querySelector('[data-testplay-btn]').click();
      for (let i = 0; i < 30; i++) {
        await sleep(200);
        if (document.querySelector('[data-testid="testplay-overlay"]')) break;
      }
      return { overlay: !!document.querySelector('[data-testid="testplay-overlay"]'), time: store.currentTime };
    })()`);
    assert(entered.overlay, '进入测试游玩覆盖层');
    assert(entered.time <= 100, `从头起播 (editorTime=0 → startTime=0; 实际 ${Math.round(entered.time)})`);

    // 等跳过按钮出现 (rAF 里 canSkip 置 state), 出现后点击
    const rSkip = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      let btn = null;
      for (let i = 0; i < 40 && !btn; i++) { await sleep(200); btn = document.querySelector('[data-testid="testplay-skip"]'); }
      if (!btn) return { shown: false };
      const text = btn.textContent;
      btn.click();
      await sleep(300);
      const afterSeek = store.currentTime;
      let hidden = false;
      for (let i = 0; i < 15; i++) {
        await sleep(200);
        if (!document.querySelector('[data-testid="testplay-skip"]')) { hidden = true; break; }
      }
      return { shown: true, text, afterSeek, hidden };
    })()`);
    assert(rSkip.shown, '跳过按钮出现 (首物件 10s 前 >3s)');
    if (rSkip.shown) {
      assert(rSkip.text === 'Skip', `按钮文案走 i18n (en=Skip; 实际 "${rSkip.text}")`);
      assert(Math.abs(rSkip.afterSeek - 8000) < 1200, `点击 seek 到 首物件-2000=8000 (实际 ${Math.round(rSkip.afterSeek)})`);
      assert(rSkip.hidden, '跳过落地后按钮隐藏 (8000 > 10000-3000)');
    }

    // 退出还原: Esc 按钮 → 覆盖层关闭, 时间回到 editorTime (0)
    const rExit = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      document.querySelector('[data-testid="testplay-exit"]').click();
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        if (!document.querySelector('[data-testid="testplay-overlay"]')) break;
      }
      return { overlayGone: !document.querySelector('[data-testid="testplay-overlay"]'), time: store.currentTime };
    })()`);
    assert(rExit.overlayGone, '退出按钮关闭覆盖层');
    assert(Math.abs(rExit.time) <= 100, `退出还原 editorTime=0 (实际 ${Math.round(rExit.time)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V419_FAILED: ${failures} 处失败` : '\nVERIFIER_V419_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

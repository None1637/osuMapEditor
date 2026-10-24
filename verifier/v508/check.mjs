// 验证器 v508: Timing 菜单「测量全曲 timing / 测量当前 bookmark 区间 timing」
//   A: 源码契约 (菜单项/App 处理/store 区间替换/对话框区间切片)
//   B: CDP — 全曲检测应用; bookmark 区间只替换区间内红线; 无书签提示
// 运行: npm run build 后 node verifier/v508/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

section('A: 源码契约');
{
  const main = read('electron/main.cjs');
  assert(/menu\.bpm_detect_song/.test(main) && /menu\.bpm_detect_bookmark/.test(main), 'Timing 菜单两个检测项');
  assert(/bpm-detect-song/.test(main) && /bpm-detect-bookmark/.test(main), '菜单命令发送');
  const app = read('src/App.tsx');
  assert(/cmd\.type === 'bpm-detect-song'\) \{ store\.openBpmDetect\(\)/.test(app), 'App 全曲入口');
  assert(/cmd\.type === 'bpm-detect-bookmark'\) \{ store\.openBpmDetectBookmark\(\)/.test(app), 'App bookmark 入口');
  const st = read('src/osu/store.ts');
  assert(/openBpmDetectBookmark\(\)/.test(st) && /applyDetectedTiming\(points: \{ time: number; bpm: number; meter\?: number \}\[\], range\?: \{ startMs: number; endMs: number \}\)/.test(st), 'store bookmark 入口 + range 替换');
  const dlg = read('src/components/BpmDetectDialog.tsx');
  assert(/store\.bpmDetectNoBookmark/.test(dlg) && /range\.startMs/.test(dlg) && /slice\(start, end\)/.test(dlg), '对话框区间切片与无书签提示');
}

section('B: CDP');
{
  const PORT = 9519;
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
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await evalJs(`(async () => { const s = window.__osuStore; for (let i = 0; i < 120 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250)); })()`);
    // 注入 128BPM 合成点击轨
    await evalJs(`(() => {
      const s = window.__osuStore;
      const sr = 44100, spb = 60000 / 128;
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, Math.ceil((500 + 60 * spb + 500) / 1000 * sr), sr);
      const d = buf.getChannelData(0);
      const put = (t, amp) => {
        const st = Math.round(t / 1000 * sr), len = Math.round(0.03 * sr);
        for (let i = 0; i < len && st + i < d.length; i++) { const tt = i / sr; d[st + i] += Math.sin(2 * Math.PI * 2000 * tt) * Math.exp(-tt / 0.006) * amp; }
      };
      for (let i = 0; i < 60; i++) { put(500 + i * spb, 0.9); put(500 + (i + 0.5) * spb, 0.35); }
      s.audioBuffer = buf;
      s.emit();
    })()`);
    // 菜单定义含两项
    const menuOk = await evalJs(`(async () => {
      const def = await window.osuEditor.getMenuDefinition();
      const tm = def.find(m => m.label === 'Timing');
      return tm && tm.submenu.some(m => (m.label ?? '').includes('Whole Song')) && tm.submenu.some(m => (m.label ?? '').includes('Bookmark Range'));
    })()`);
    assert(menuOk, 'Timing 菜单含全曲/bookmark 两项');
    // 经菜单 click 触发全曲检测
    await evalJs(`(async () => {
      const def = await window.osuEditor.getMenuDefinition();
      const tm = def.find(m => m.label === 'Timing');
      window.osuEditor.menuItemClick(tm.submenu.find(m => (m.label ?? '').includes('Whole Song')).id);
      return true;
    })()`);
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(500);
      done = await evalJs(`!!document.querySelector('[data-conv="bpm-detect-bpm"]')`).catch(() => false);
    }
    assert(done, '全曲检测完成');
    for (let i = 0; i < 2; i++) {
      await evalJs(`document.querySelector('[data-testid="bpm-detect-apply"]')?.click()`);
      await sleep(250);
      if (!(await evalJs(`!!document.querySelector('[data-dialog="bpm-detect-dialog"]')`))) break;
    }
    const reds = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => t.uninherited).map(t => ({ time: t.time, bl: t.beatLength }))`);
    assert(reds.length === 1 && Math.abs(reds[0].bl - 468.75) < 0.01, `全曲应用单红线 (${JSON.stringify(reds)})`);
    // bookmark 区间: 设置两条书签并 seek 到区间内
    await evalJs(`(() => {
      const s = window.__osuStore;
      s.beatmap.editor.bookmarks = [5000, 12000];
      s.seek(6000);
      s.emit();
      return true;
    })()`);
    await evalJs(`(async () => {
      const def = await window.osuEditor.getMenuDefinition();
      const tm = def.find(m => m.label === 'Timing');
      window.osuEditor.menuItemClick(tm.submenu.find(m => (m.label ?? '').includes('Bookmark Range')).id);
      return true;
    })()`);
    done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(500);
      done = await evalJs(`!!document.querySelector('[data-conv="bpm-detect-bpm"]')`).catch(() => false);
    }
    assert(done, 'bookmark 区间检测完成');
    const off = await evalJs(`parseFloat(document.querySelector('[data-conv="bpm-detect-offset"]').value)`);
    assert(off >= 5000 && off < 12000, `区间 offset 落在 [5000,12000) (${off})`);
    for (let i = 0; i < 2; i++) {
      await evalJs(`document.querySelector('[data-testid="bpm-detect-apply"]')?.click()`);
      await sleep(250);
      if (!(await evalJs(`!!document.querySelector('[data-dialog="bpm-detect-dialog"]')`))) break;
    }
    const reds2 = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => t.uninherited).map(t => ({ time: t.time, bl: t.beatLength }))`);
    const inRange = reds2.filter(r => r.time >= 5000 && r.time < 12000);
    const outRange = reds2.filter(r => r.time < 5000 || r.time >= 12000);
    assert(inRange.length === 1 && Math.abs(inRange[0].bl - 468.75) < 0.01 && outRange.length === 0,
      `区间应用: 区间内 1 根新线, 区间外 0 根 (${JSON.stringify(reds2)})`);
    // 无书签提示
    await evalJs(`(() => { const s = window.__osuStore; s.beatmap.editor.bookmarks = []; s.emit(); s.openBpmDetectBookmark(); return true; })()`);
    await sleep(400);
    const err = await evalJs(`document.querySelector('[data-testid="bpm-detect-error"]')?.textContent ?? ''`);
    assert(/bookmark/i.test(err), `无书签提示 (${err})`);
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V508_FAILED: ${failures} 处失败` : '\nVERIFIER_V508_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

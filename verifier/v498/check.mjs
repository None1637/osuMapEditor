// 验证器 v498: 自动 BPM 检测 (恒速优先)
//   A: 合成纯函数 (tests.ts) — 恒速 128/160 单红线网格 ≥99%; 变速 20 段 ≥75% (回归监控, 非验收线);
//      恒速+半程 breakdown 1/8 细分合并 ≥99%
//   B: 真实谱面 (real.ts, 仅本地 F:\Backup\D\osu!\Songs  fixture, 音频/谱面不入库) —
//      Yoko/Turupeta 全图 ≥99%; Carnival 恒速区 (0~187s) ≥99%
//   C: 源码契约 (worker/store/对话框/i18n)
//   D: CDP 冒烟 — 页面内合成 128BPM 点击轨 → Timing 页「检测 BPM」→ 对话框显示
//      BPM+offset (网格覆盖 ≥99%) → 应用替换红线 → undo 还原
// 运行: npm run build 后 node verifier/v498/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

section('A: 合成纯函数 + B: 真实谱面 (本地 fixture)');
if (!process.env.V498_SKIP_AB) for (const [name, src, marker] of [['A 合成', 'tests', 'V498_PURE_PASSED'], ['B 真实谱面', 'real', 'V498_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v498/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v498/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v498/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
    console.log(out.trim());
    assert(out.includes(marker), `${name}: ${marker}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL: ${name} 执行失败\n${e.stdout ?? ''}${e.message}`);
  }
}

section('C: 源码契约');
{
  const w = read('src/osu/bpmDetectWorker.ts');
  assert(/detectBpm\(buf, \{ onProgress/.test(w) && /extractConstantTempo\(result\)/.test(w), 'worker: 检测 + 恒速提炼 + 进度');
  const st = read('src/osu/store.ts');
  assert(/applyDetectedTiming\(points: \{ time: number; bpm: number; meter\?: number \}\[\]\)/.test(st), 'store.applyDetectedTiming');
  assert(/this\.pushUndo\(\);[\s\S]{0,200}?filter\(tp => !tp\.uninherited\)/.test(st), '一次 undo 替换全部红线保留绿线');
  const dlg = read('src/components/BpmDetectDialog.tsx');
  for (const id of ['bpm-detect-dialog', 'bpm-detect-bpm', 'bpm-detect-offset', 'bpm-detect-apply', 'bpm-detect-open'])
    assert(id === 'bpm-detect-open' ? read('src/components/TimingPanel.tsx').includes(id) : dlg.includes(id), `testid ${id}`);
  assert(/new Worker\(new URL\('\.\.\/osu\/bpmDetectWorker\.ts', import\.meta\.url\)/.test(dlg), '对话框接 worker');
  const dict = read('src/i18n/dicts/zh-CN/timing.ts');
  for (const k of ['timing.detect_bpm', 'timing.bpmdetect_title', 'timing.bpmdetect_offset', 'timing.bpmdetect_coverage', 'timing.bpmdetect_variable_hint', 'timing.bpmdetect_confirm_replace'])
    assert(dict.includes(`'${k}'`), `zh-CN ${k}`);
  const tp = read('src/components/TimingPanel.tsx');
  assert(/setShowBpmDetect\(true\)/.test(tp) && /<BpmDetectDialog onClose/.test(tp), 'TimingPanel 入口接线');
}

section('D: CDP 冒烟 (页面内合成 128BPM 点击轨 → 检测 → 应用 → undo)');
{
  const PORT = 9513;
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

    // 页面内合成 128BPM 点击轨 (自生成音频, 不入库): 60 拍, 500ms 起, 半拍 0.35 弱击
    await evalJs(`(() => {
      const s = window.__osuStore;
      const sr = 44100, bpm = 128, spb = 60000 / bpm, beats = 60;
      const durMs = 500 + beats * spb + 500;
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, Math.ceil(durMs / 1000 * sr), sr);
      const d = buf.getChannelData(0);
      const put = (t, amp) => {
        const st = Math.round(t / 1000 * sr), len = Math.round(0.03 * sr);
        for (let i = 0; i < len && st + i < d.length; i++) {
          const tt = i / sr;
          d[st + i] += Math.sin(2 * Math.PI * 2000 * tt) * Math.exp(-tt / 0.006) * amp;
        }
      };
      for (let i = 0; i < beats; i++) { put(500 + i * spb, 0.9); put(500 + (i + 0.5) * spb, 0.35); }
      s.audioBuffer = buf;
      s.emit();
      return true;
    })()`);
    // tab-timing 由 App 自己的 onMenuCommand 回调处理 (不经 electronMenu), 用 F2 热键切页签
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true }))`);
    await sleep(300);
    const opened = await evalJs(`(() => { const b = document.querySelector('[data-testid="bpm-detect-open"]'); if (!b) return false; b.click(); return true; })()`);
    assert(opened, 'Timing 页「检测 BPM」按钮可点');
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(500);
      done = await evalJs(`!!document.querySelector('[data-conv="bpm-detect-bpm"]')`).catch(() => false);
      const err = await evalJs(`document.querySelector('[data-testid="bpm-detect-error"]')?.textContent ?? ''`).catch(() => '');
      if (err) throw new Error('检测对话框报错: ' + err);
    }
    assert(done, '检测完成 (BPM+offset 显示)');
    const det = await evalJs(`({ bpm: parseFloat(document.querySelector('[data-conv="bpm-detect-bpm"]').value), offset: parseFloat(document.querySelector('[data-conv="bpm-detect-offset"]').value) })`);
    console.log('  检出:', det);
    // 网格覆盖: 参考 1/2 细分 (128BPM, 500ms 起, 60 拍)
    {
      const half = 30000 / det.bpm;
      const grid = [];
      for (let t = det.offset; t < 500 + 60 * 468.75; t += half) grid.push(t);
      for (let t = det.offset - half; t > 0; t -= half) grid.push(t);
      grid.sort((a, b) => a - b);
      let ok = 0, tot = 0;
      for (let i = 0; i < 60; i++) {
        for (const t of [500 + i * 468.75, 500 + (i + 0.5) * 468.75]) {
          tot++;
          let lo = 0, hi = grid.length - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (grid[m] < t) lo = m + 1; else hi = m; }
          const dd = Math.min(Math.abs(grid[lo] - t), lo > 0 ? Math.abs(grid[lo - 1] - t) : 1e9);
          if (dd < 15) ok++;
        }
      }
      assert(ok / tot >= 0.99, `CDP 检出网格覆盖 ≥99% (实际 ${(ok / tot * 100).toFixed(1)}%)`);
    }
    // 应用 (已有红线 → 二次确认) → 单红线; undo 还原
    const before = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => t.uninherited).length`);
    for (let i = 0; i < 2; i++) {
      await evalJs(`document.querySelector('[data-testid="bpm-detect-apply"]')?.click()`);
      await sleep(250);
      const stillOpen = await evalJs(`!!document.querySelector('[data-dialog="bpm-detect-dialog"]')`);
      if (!stillOpen) break;
    }
    const after = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => t.uninherited).map(t => ({ time: t.time, bl: t.beatLength }))`);
    if (after.length !== 1 || Math.abs(after[0].bl - 60000 / det.bpm) >= 0.01) {
      const dlgText = await evalJs(`document.querySelector('[data-dialog="bpm-detect-dialog"]')?.textContent ?? '(已关闭)'`);
      console.log('  诊断: 对话框内容=', dlgText);
      console.log('  诊断: applyDetectedTiming 类型=', await evalJs(`typeof window.__osuStore.applyDetectedTiming`));
    }
    assert(after.length === 1 && Math.abs(after[0].bl - 60000 / det.bpm) < 0.01 && after[0].time === Math.round(det.offset),
      `应用后单条红线 (实际 ${JSON.stringify(after)}, 原 ${before} 条)`);
    const undone = await evalJs(`(() => { const s = window.__osuStore; s.undo(); return s.beatmap.timingPoints.filter(t => t.uninherited).length; })()`);
    assert(undone === before, `undo 还原红线数 (${undone}=${before})`);
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 冒烟异常:', e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V498_FAILED: ${failures} 处失败` : '\nVERIFIER_V498_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

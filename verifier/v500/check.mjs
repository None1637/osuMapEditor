// 验证器 v500: 容差 ms 可选 + 恒速/变速检测模式
//   A: 纯函数 (默认容差兼容 / 容差单调影响覆盖率 / 判定回归)
//   B: 源码契约 (模式/容差/段列表 testid, i18n)
//   C: CDP — 恒速模式应用单红线 (沿用 v498 流程) + 切变速模式删一段后应用多红线
// 运行: npm run build 后 node verifier/v500/check.mjs
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

section('A: 纯函数 (容差)');
try {
  execSync('npx esbuild verifier/v500/tests.ts --bundle --format=esm --platform=node --outfile=verifier/v500/.tests.mjs --log-level=error --alias:@=./src', { cwd: root, stdio: 'pipe' });
  const out = execSync('node verifier/v500/.tests.mjs', { cwd: root, encoding: 'utf8' });
  console.log(out.trim());
  assert(out.includes('V500_PURE_PASSED'), 'A: V500_PURE_PASSED');
} catch (e) {
  failures++;
  console.error(`  FAIL: A 执行失败\n${e.stdout ?? ''}${e.message}`);
}

section('B: 源码契约');
{
  const dlg = read('src/components/BpmDetectDialog.tsx');
  for (const id of ['bpm-detect-mode-constant', 'bpm-detect-mode-variable', 'bpm-detect-tolerance', 'bpm-detect-segments'])
    assert(dlg.includes(id), `testid ${id}`);
  assert(/extractConstantTempo\(result, 0\.1, tolMs\)/.test(dlg), '容差变化本地重算 (不重跑检测)');
  assert(/result\.segments\.filter\(\(_, i\) => !deletedSegs\.has\(i\)\)/.test(dlg), '变速模式可删段后应用');
  const bp = read('src/osu/bpmDetect.ts');
  assert(/extractConstantTempo\(result: BpmDetectResult, quantize = 0\.1, tolMs = 15\)/.test(bp), 'extractConstantTempo tolMs 参数');
  const dict = read('src/i18n/dicts/zh-CN/timing.ts');
  for (const k of ['timing.bpmdetect_mode_constant', 'timing.bpmdetect_mode_variable', 'timing.bpmdetect_tolerance', 'timing.bpmdetect_segments'])
    assert(dict.includes(`'${k}'`), `zh-CN ${k}`);
}

section('C: CDP (变速模式删段应用 + 容差)');
{
  const PORT = 9515;
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
    await evalJs(`(() => {
      const s = window.__osuStore;
      const sr = 44100;
      const ctx = new AudioContext();
      // 前 30 拍 128 + 后 30 拍 200 (保证变速段列表 ≥2 段, 覆盖删段分支)
      const buf = ctx.createBuffer(1, Math.ceil((500 + 30 * (60000 / 128) + 30 * 300 + 500) / 1000 * sr), sr);
      const d = buf.getChannelData(0);
      const put = (t, amp) => {
        const st = Math.round(t / 1000 * sr), len = Math.round(0.03 * sr);
        for (let i = 0; i < len && st + i < d.length; i++) { const tt = i / sr; d[st + i] += Math.sin(2 * Math.PI * 2000 * tt) * Math.exp(-tt / 0.006) * amp; }
      };
      let t = 500;
      for (const [bpm, n] of [[128, 30], [200, 30]]) {
        const spb = 60000 / bpm;
        for (let i = 0; i < n; i++) { put(t, 0.9); put(t + spb / 2, 0.35); t += spb; }
      }
      s.audioBuffer = buf;
      s.emit();
    })()`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true }))`);
    await sleep(300);
    await evalJs(`document.querySelector('[data-testid="bpm-detect-open"]').click()`);
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(500);
      done = await evalJs(`!!document.querySelector('[data-conv="bpm-detect-bpm"]')`).catch(() => false);
    }
    assert(done, '检测完成');
    // 容差框存在且可调
    const tolOk = await evalJs(`(() => {
      const el = document.querySelector('[data-conv="bpm-detect-tolerance"]');
      if (!el) return false;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '30');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
      return true;
    })()`);
    assert(tolOk, '容差输入框可调为 30ms');
    // 切变速模式
    await evalJs(`document.querySelector('[data-testid="bpm-detect-mode-variable"]').click()`);
    await sleep(300);
    const segCount = await evalJs(`document.querySelectorAll('[data-seg-del]').length`);
    assert(segCount >= 1, `变速模式段列表显示 (${segCount} 段)`);
    // 删一段再应用
    if (segCount >= 2) await evalJs(`document.querySelector('[data-seg-del]').click()`);
    await sleep(200);
    const expectN = segCount >= 2 ? segCount - 1 : segCount;
    for (let i = 0; i < 2; i++) {
      await evalJs(`document.querySelector('[data-testid="bpm-detect-apply"]')?.click()`);
      await sleep(250);
      const stillOpen = await evalJs(`!!document.querySelector('[data-dialog="bpm-detect-dialog"]')`);
      if (!stillOpen) break;
    }
    const reds = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => t.uninherited).length`);
    assert(reds === expectN, `变速模式应用后红线数 (${reds}=${expectN})`);
    const undone = await evalJs(`(() => { const s = window.__osuStore; s.undo(); return s.beatmap.timingPoints.filter(t => t.uninherited).length; })()`);
    assert(undone === 1, `undo 还原 (${undone}=1)`);
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V500_FAILED: ${failures} 处失败` : '\nVERIFIER_V500_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v503: 多层波形/频谱预览 + 短段误报过滤
//   A: 纯函数 (开头短异速段不报 / 长真变速段仍报)
//   B: 真实谱面 (Carnival 开头 30s 内无误报变速线)
//   C: 源码契约 (BpmPreview / drawWave / drawSpectro / testid)
//   D: CDP — 预览画布存在且可缩放, 频谱切换, 点击 seek
// 运行: npm run build 后 node verifier/v503/check.mjs
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

section('A: 纯函数 + B: 真实谱面 (本地 fixture)');
for (const [name, src, marker] of [['A 纯函数', 'tests', 'V503_PURE_PASSED'], ['B 真实谱面', 'real', 'V503_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v503/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v503/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v503/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
    console.log(out.trim());
    assert(out.includes(marker), `${name}: ${marker}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL: ${name} 执行失败\n${e.stdout ?? ''}${e.message}`);
  }
}

section('C: 源码契约');
{
  const pv = read('src/components/BpmPreview.tsx');
  assert(/drawWave\(g, buf, t0, winMs, W, waveH, dpr\)/.test(pv), 'drawWave 复用');
  assert(/drawWave\(g, buf, t0, winMs, W, waveH, dpr\)/.test(pv) && /drawSpectro\(g, buf, t0, winMs, W, specH/.test(pv), 'v505: 每层上波形下频谱');
  assert(/onSeek={ms => store.seek\(ms\)}/.test(read('src/components/BpmDetectDialog.tsx')), '点击 seek 接线');
  assert(/data-testid="bpm-detect-preview"/.test(read('src/components/BpmDetectDialog.tsx')), '预览 testid');
  assert(/6000 \/ \(\(store\.beatmap\?\.editor\.timelineZoom \|\| 1\) \* 1000\)/.test(read('src/components/BpmDetectDialog.tsx')), 'v505: 默认缩放与上方时间轴一致');
  assert(/formatMsTime\(t\)/.test(pv) && /store\.beatSnap/.test(pv), 'v505: 每 4/1 拍时间标注 + beatSnap 细分刻度');
  const dict = read('src/i18n/dicts/zh-CN/timing.ts');
  for (const k of ['timing.bpmdetect_spectro', 'timing.bpmdetect_preview']) assert(dict.includes(`'${k}'`), `zh-CN ${k}`);
}

section('D: CDP 预览');
{
  const PORT = 9517;
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
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true }))`);
    await sleep(300);
    await evalJs(`document.querySelector('[data-testid="bpm-detect-open"]').click()`);
    let done = false;
    for (let i = 0; i < 120 && !done; i++) {
      await sleep(500);
      done = await evalJs(`!!document.querySelector('[data-conv="bpm-detect-bpm"]')`).catch(() => false);
    }
    assert(done, '检测完成');
    const h0 = await evalJs(`document.querySelector('[data-testid="bpm-detect-preview"] canvas')?.height ?? 0`);
    assert(h0 > 0, `预览画布存在 (高 ${h0})`);
    // 滚轮缩小每行时长 → 行数变多 → 画布变高
    await evalJs(`(() => {
      const cv = document.querySelector('[data-testid="bpm-detect-preview"] canvas');
      cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(400);
    const h1 = await evalJs(`document.querySelector('[data-testid="bpm-detect-preview"] canvas')?.height ?? 0`);
    assert(h1 > h0, `滚轮缩放后画布变高 (${h0}→${h1})`);
    // v505: 每层上波形下频谱 (行高 = 48+64), 默认与上方时间轴同缩放 (6s/行)
    const wh = await evalJs(`document.querySelector('[data-testid="bpm-detect-preview"] canvas')?.height ?? 0`);
    assert(wh > 0 && wh % 112 === 0, `v505: 每层上波形下频谱 (行高 112 的倍数, 实际 ${wh})`);
    // 点击 seek
    const before = await evalJs(`window.__osuStore.currentTime`);
    await evalJs(`(() => {
      const cv = document.querySelector('[data-testid="bpm-detect-preview"] canvas');
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.top + 20, bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    const after = await evalJs(`window.__osuStore.currentTime`);
    assert(Math.abs(after - before) > 1000, `点击预览可 seek (${before}→${after})`);
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V503_FAILED: ${failures} 处失败` : '\nVERIFIER_V503_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

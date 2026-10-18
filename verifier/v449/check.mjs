// v449: 刷新谱面 (v350 reloadMap) 内存泄漏回归 — 循环刷新 20 次, 采样内存曲线 + 门槛断言
// 背景: 用户任务管理器报本编辑器 2.5GB, 确认在多次刷新谱面后; loadDifficulty 每次
//   URL.createObjectURL(audio/bg) 而 store.setAudio/setBackground 换 URL 从不 revoke 旧值 —
//   每个 blob URL 钉住整个 File (音频 3.1MB + 背景 0.6MB, 本图每次刷新漏 ~3.7MB;
//   用户真实大图 10-20MB/次), N 次刷新累积 N 份。
// 做法: CDP 隔离 Electron 开 cygnus → 等解码 → 点 [data-reload-map-btn] × 20
//   (真实 reloadMap 路径: loadDifficulty → store.load), 每次等重解码完成 + HeapProfiler.collectGarbage
//   后采样: 页内 JS 堆 + OS 进程树 RSS (分主进程/renderer; blob 存储在主进程, 漏了它单调涨)。
// 断言: ① 20 次刷新全部成功且音频/背景/物件完好 ② 暖机(前3次)后 主进程RSS增量 < 25MB
//   ③ 进程树总RSS增量 < 150MB ④ v444 缓存命中路径新 URL 被立即 revoke (合成用例)。
// 运行: node verifier/v449/check.mjs [out.json] [--no-assert]   (默认 mem-after.json; 修复前基线用 mem-before.json --no-assert)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9464;
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'mem-after.json';
const NO_ASSERT = process.argv.includes('--no-assert');
const RELOADS = 20;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const execFileP = promisify(execFile);

const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };

// OS 侧: 本实例 electron 进程树 RSS (同 v447; 按临时 profile 名过滤), 分 type 汇总
async function procTreeRss(profileName) {
  const ps = [
    `$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${profileName}*' }`,
    `$rows = foreach ($p in $procs) { $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($gp) { [pscustomobject]@{ id=$p.ProcessId; type=([regex]::Match($p.CommandLine, '--type=([a-z]+)').Groups[1].Value); rssMB=[math]::Round($gp.WorkingSet64/1MB,1) } } }`,
    `$rows | ConvertTo-Json -Compress`,
  ].join('; ');
  try {
    const { stdout } = await execFileP('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000 });
    const rows = JSON.parse(stdout.trim() || '[]');
    const list = Array.isArray(rows) ? rows : [rows];
    const by = {};
    for (const r of list) by[r.type || 'browser'] = +((by[r.type || 'browser'] || 0) + r.rssMB).toFixed(1);
    return { totalMB: +list.reduce((s, r) => s + r.rssMB, 0).toFixed(1), browserMB: by.browser ?? -1, rendererMB: by.renderer ?? -1 };
  } catch (e) { return { totalMB: -1, browserMB: -1, rendererMB: -1, error: String(e).slice(0, 200) }; }
}

// 页内采样: JS 堆 + 结构清点 (blob 泄漏不在 JS 堆, 但解码缓存/撤销栈等 regression 会体现)
const INVENTORY = `(() => {
  const s = window.__osuStore;
  const mb = (b) => +(b / 1048576).toFixed(2);
  const mem = performance.memory ? { usedJSHeapMB: mb(performance.memory.usedJSHeapSize), totalJSHeapMB: mb(performance.memory.totalJSHeapSize) } : null;
  const ab = s.audioBuffer;
  return {
    mem,
    audio: ab ? { durS: +ab.duration.toFixed(1), pcmMB: mb(ab.length * ab.numberOfChannels * 4) } : null,
    bgLoaded: !!(s.backgroundImg && s.backgroundImg.naturalWidth),
    objects: s.beatmap ? s.beatmap.hitObjects.length : 0,
    audioUrlIsBlob: !!(s.audioUrl && s.audioUrl.startsWith('blob:')),
  };
})()`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const { proc, profile } = launchIsolatedElectron(root, PORT);
const profileName = path.basename(profile);
const report = { map: MAP.file, reloads: RELOADS, steps: [] };
let target;
try {
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('CONNECT_FAILED');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  await send('HeapProfiler.enable');

  async function sample(tag) {
    await send('HeapProfiler.collectGarbage'); // 强制 GC: 堆读数稳定 (blob 泄漏在主进程, 不受影响藏不住)
    await sleep(300);
    const page = await evalJs(INVENTORY);
    const os = await procTreeRss(profileName);
    const row = { tag, page, os };
    report.steps.push(row);
    console.log(`[${tag}] RSS树 ${os.totalMB}MB (主 ${os.browserMB} / 渲染 ${os.rendererMB}) | heap ${page.mem?.usedJSHeapMB ?? '?'}MB | pcm ${page.audio?.pcmMB ?? 0}MB | bg ${page.bgLoaded} | obj ${page.objects}`);
    return row;
  }

  await normalizeEnv(evalJs);
  await sleep(1000);

  // 开 cygnus, 等首次解码完成
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const ok = await evalJs(`(() => { const s = window.__osuStore; return !!s.audioBuffer; })()`);
    if (ok) break;
  }
  const init = await evalJs(INVENTORY);
  if (!init.audio) throw new Error('首次解码未完成');
  await sleep(1500);
  await sample('r0-loaded');

  // 循环刷新: 真实按钮点击 → reloadMap → loadDifficulty → store.load;
  // 完成检测 = beatmap 对象 identity 变化 (load 换新解析结果) 且重解码完成
  for (let i = 1; i <= RELOADS; i++) {
    const done = await evalJs(`(async () => {
      const s = window.__osuStore; const prev = s.beatmap;
      const btn = document.querySelector('[data-reload-map-btn]');
      if (!btn || btn.disabled) return 'btn-disabled';
      btn.click();
      const t0 = performance.now();
      while (s.beatmap === prev) { if (performance.now() - t0 > 20000) return 'timeout-load'; await new Promise(r => setTimeout(r, 100)); }
      while (!s.audioBuffer) { if (performance.now() - t0 > 40000) return 'timeout-decode'; await new Promise(r => setTimeout(r, 200)); }
      return 'ok';
    })()`);
    if (done !== 'ok') { check(`刷新 #${i}`, false, done); break; }
    await sleep(1200); // 沉淀: 旧 PCM/旧 File 待 GC
    await sample(`r${i}`);
  }

  // ---- 断言 ----
  const steps = report.steps.filter(s => /^r\d+$/.test(s.tag));
  if (steps.length >= RELOADS + 0) {
    const warm = steps.slice(0, 3);           // 前 3 次暖机 (首解码/首次渲染缓存等)
    const tail = steps.slice(-3);
    const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
    const dBrowser = +(avg(tail, x => x.os.browserMB) - avg(warm, x => x.os.browserMB)).toFixed(1);
    const dTotal = +(avg(tail, x => x.os.totalMB) - avg(warm, x => x.os.totalMB)).toFixed(1);
    const dHeap = +(avg(tail, x => x.page.mem?.usedJSHeapMB ?? 0) - avg(warm, x => x.page.mem?.usedJSHeapMB ?? 0)).toFixed(1);
    report.deltas = { browserMB: dBrowser, totalMB: dTotal, heapMB: dHeap };
    console.log(`\n增量 (末3次均值 - 前3次均值): 主进程RSS ${dBrowser}MB | 总RSS ${dTotal}MB | JS堆 ${dHeap}MB`);
    check('20 次刷新全部成功', steps.length === RELOADS, `完成 ${steps.length} 次`);
    check('主进程 RSS 平顶 (blob 不泄漏)', dBrowser < 25, `${dBrowser}MB < 25MB`);
    check('进程树总 RSS 平顶', dTotal < 150, `${dTotal}MB < 150MB`);
    const last = steps[steps.length - 1].page;
    check('刷新后音频解码完好', !!last.audio && Math.abs(last.audio.durS - init.audio.durS) < 0.5, `dur ${last.audio?.durS}s`);
    check('刷新后背景图完好', last.bgLoaded === true);
    check('刷新后物件数不变', last.objects === init.objects, `${last.objects}`);
  } else {
    check('刷新循环完成', false, `仅 ${steps.length} 个采样点`);
  }

  // 功能: 刷新后播放/暂停照常 (走一遍真实播放确认音频链路没坏)
  const playOk = await evalJs(`(async () => {
    const s = window.__osuStore; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    s.seek(1000); s.play(); await sleep(500);
    const playing = s.playing; s.pause();
    return playing;
  })()`);
  check('刷新后播放/暂停可用', playOk === true);

  // v444 缓存命中分支: 新 blob URL 未被消费 → 应立即 revoke (合成用例: 同 audioKey 传入新 blob)
  const cacheHit = await evalJs(`(async () => {
    const s = window.__osuStore;
    if (!s.audioCache) return 'no-cache';
    const u = URL.createObjectURL(new Blob(['x']));
    const prevUrl = s.audioUrl; const prevBuf = s.audioBuffer;
    s.load(s.beatmap, u, null, undefined, s.mapSource, s.audioCache.key);
    let revoked = false;
    try { await fetch(u); } catch { revoked = true; }
    return { revoked, urlKept: s.audioUrl === prevUrl, bufKept: s.audioBuffer === prevBuf };
  })()`);
  check('v444 缓存命中: 新 URL 立即 revoke', cacheHit && cacheHit.revoked === true, JSON.stringify(cacheHit));
  check('v444 缓存命中: 复用旧 URL/buffer', cacheHit && cacheHit.urlKept === true && cacheHit.bufKept === true);
  // 合成用例把背景清了 (传了 null), 补一次真实刷新还原, 顺带再验证一次端到端
  await evalJs(`document.querySelector('[data-reload-map-btn]').click()`);
  await sleep(4000);
  const restored = await evalJs(INVENTORY);
  check('合成用例后真实刷新还原背景', restored.bgLoaded === true && !!restored.audio);

  fs.writeFileSync(path.join(root, 'verifier/v449', OUT), JSON.stringify(report, null, 2));
  console.log(`\nwritten: verifier/v449/${OUT}`);
} finally {
  await killIsolated(proc, profile);
}

if (!NO_ASSERT && failures > 0) { console.error(`\n${failures} 项断言失败`); process.exit(1); }
console.log(NO_ASSERT ? '\n(基线模式, 不断言)' : '\n全部断言通过');

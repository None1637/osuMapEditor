// v447: 内存占用分阶段画像 — 优化前/后同条件复测用 (先量化再砍, 不猜)
// 阶段: s0 空app基线 → s1 开cygnus+解码 → s2 双变速引擎并存 → s3 撤销栈填满(210次pushUndo)
//       → s4 频谱模式扫全程(填LRU) → s5 测试游玩 → s6 退出游玩
// 每阶段采样: 页内 JS堆(performance.memory) + measureUserAgentSpecificMemory(可用则带breakdown)
//   + 结构清点(音频PCM/引擎副本/撤销栈JSON字节/采样缓存/背景图) + OS侧进程树RSS(electron.exe 按profile路径过滤)
// 运行: node verifier/v447/mem-profile.mjs [out.json]   (默认 mem-baseline.json; 优化后跑 mem-after.json)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9463;
const OUT = process.argv[2] || 'mem-baseline.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const execFileP = promisify(execFile);

const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };

// OS 侧: 本实例的 electron 进程树 RSS (CommandLine 含临时 profile 名, 与用户真实实例/其他 electron 区分)
async function procTreeRss(profileName) {
  const ps = [
    `$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${profileName}*' }`,
    `$rows = foreach ($p in $procs) { $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($gp) { [pscustomobject]@{ id=$p.ProcessId; parent=$p.ParentProcessId; type=([regex]::Match($p.CommandLine, '--type=([a-z]+)').Groups[1].Value); rssMB=[math]::Round($gp.WorkingSet64/1MB,1) } } }`,
    `$rows | ConvertTo-Json -Compress`,
  ].join('; ');
  try {
    const { stdout } = await execFileP('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000 });
    const rows = JSON.parse(stdout.trim() || '[]');
    const list = Array.isArray(rows) ? rows : [rows];
    return { totalMB: +list.reduce((s, r) => s + r.rssMB, 0).toFixed(1), procs: list };
  } catch (e) { return { totalMB: -1, procs: [], error: String(e).slice(0, 200) }; }
}

// 页内清点 (store 的 private 仅 TS 编译期, 运行时可读; snapshot() 公开)
const INVENTORY = `(async () => {
  const s = window.__osuStore;
  const mb = (b) => +(b / 1048576).toFixed(2);
  const mem = performance.memory ? { usedJSHeapMB: mb(performance.memory.usedJSHeapSize), totalJSHeapMB: mb(performance.memory.totalJSHeapSize) } : null;
  let uasm = null;
  try { if (performance.measureUserAgentSpecificMemory) { const r = await performance.measureUserAgentSpecificMemory(); uasm = { bytesMB: mb(r.bytes), breakdown: (r.breakdown || []).map(b => ({ bytesMB: mb(b.bytes), types: b.types })) }; } } catch (e) { uasm = { error: String(e).slice(0, 120) }; }
  const ab = s.audioBuffer;
  const pcmBytes = ab ? ab.length * ab.numberOfChannels * 4 : 0;
  let snapJsonBytes = 0;
  try { snapJsonBytes = JSON.stringify(s.snapshot()).length; } catch { /* 无谱面 */ }
  let hitBytes = 0, hitCount = 0;
  try { for (const [, b] of s.hitBuffers) { hitBytes += b.length * b.numberOfChannels * 4; hitCount++; } } catch { /* noop */ }
  const ds = s.debugState ? s.debugState() : {};
  return {
    mem, uasm,
    audio: ab ? { sr: ab.sampleRate, ch: ab.numberOfChannels, durS: +ab.duration.toFixed(1), pcmMB: mb(pcmBytes) } : null,
    engines: { tempoReady: !!ds.tempoReady, rateReady: !!ds.rateReady, tempoActive: !!ds.tempoActive, rateActive: !!ds.rateActive, estEnginePcmMB: ((ds.tempoReady ? 1 : 0) + (ds.rateReady ? 1 : 0)) * mb(pcmBytes) },
    undo: { undoLen: s.undoStack ? s.undoStack.length : -1, redoLen: s.redoStack ? s.redoStack.length : -1, snapJsonMB: mb(snapJsonBytes), estUndoMB: s.undoStack ? mb(snapJsonBytes * 2 * (s.undoStack.length + s.redoStack.length)) : 0 },
    hitSounds: { count: hitCount, bytesMB: mb(hitBytes) },
    bg: s.backgroundImg ? { w: s.backgroundImg.naturalWidth, h: s.backgroundImg.naturalHeight, estMB: mb(s.backgroundImg.naturalWidth * s.backgroundImg.naturalHeight * 4) } : null,
    waveMode: s.waveMode,
    objects: s.beatmap ? s.beatmap.hitObjects.length : 0,
  };
})()`;

const { proc, profile } = launchIsolatedElectron(root, PORT);
const profileName = path.basename(profile);
const report = { map: MAP.file, stages: {} };
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

  async function sample(tag) {
    // 先触发 GC 语义上的沉淀: 等 2 帧再读 heap (无强制 GC 接口, --js-flags 不加保持真实)
    const page = await evalJs(INVENTORY);
    const os = await procTreeRss(profileName);
    report.stages[tag] = { page, os };
    const heap = page.mem ? `heap ${page.mem.usedJSHeapMB}/${page.mem.totalJSHeapMB}MB` : 'heap n/a';
    const uasm = page.uasm?.bytesMB != null ? `uasm ${page.uasm.bytesMB}MB` : 'uasm n/a';
    console.log(`[${tag}] RSS树 ${os.totalMB}MB | ${heap} | ${uasm} | pcm ${page.audio?.pcmMB ?? 0}MB 引擎x${page.engines.estEnginePcmMB ? page.engines.estEnginePcmMB / (page.audio?.pcmMB || 1) : 0} | undo ${page.undo.undoLen}+${page.undo.redoLen} (~${page.undo.estUndoMB}MB) | snap ${page.undo.snapJsonMB}MB`);
  }

  await normalizeEnv(evalJs);
  await sleep(1500);
  await sample('s0-baseline');

  // s1: 开 cygnus, 等解码+当前模式引擎就绪
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ok = await evalJs(`(() => { const s = window.__osuStore; const d = s.debugState(); return !!s.audioBuffer && (d.tempoReady || d.rateReady); })()`);
    if (ok) break;
  }
  await sleep(2000);
  await sample('s1-mapLoaded');

  // s2: 切一次变调模式 → 另一引擎也建出 (旧引擎不销毁) → 双 PCM 副本并存
  await evalJs(`(() => { const s = window.__osuStore; s.setRateAdjustPitch(!s.rateAdjustPitch); })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const both = await evalJs(`(() => { const d = window.__osuStore.debugState(); return d.tempoReady && d.rateReady; })()`);
    if (both) break;
  }
  await sleep(1000);
  await sample('s2-bothEngines');
  await evalJs(`(() => { const s = window.__osuStore; s.setRateAdjustPitch(false); })()`); // 还原用户默认(不变调)

  // s3: 撤销栈填满 (210 次 pushUndo, 上限 200 → shift)
  await evalJs(`(() => { const s = window.__osuStore; for (let i = 0; i < 210; i++) s.pushUndo(); return s.undoStack.length; })()`);
  await sleep(1500);
  await sample('s3-undoFull');
  // 采样后清掉合成撤销数据, 还原真实状态
  await evalJs(`(() => { const s = window.__osuStore; s.undoStack.length = 0; s.redoStack.length = 0; })()`);

  // s4: 频谱模式 + 扫全程填 LRU (mono mixdown + 列缓存)
  await evalJs(`window.__osuStore.setWaveMode('spectro')`);
  await evalJs(`(async () => {
    const s = window.__osuStore; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const dur = s.songLength(); const steps = 14;
    for (let i = 0; i <= steps; i++) { s.pause(); s.seek((dur * i) / steps); await sleep(260); }
    s.seek(0);
  })()`);
  await sleep(1200);
  await sample('s4-spectroFull');
  await evalJs(`window.__osuStore.setWaveMode('wave')`);

  // s5: 测试游玩 (覆盖层背景层/游玩渲染常驻)
  await evalJs(`document.querySelector('[data-testplay-btn]').click()`);
  await sleep(3500);
  await sample('s5-testplay');
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(1500);
  await sample('s6-afterTestplay');

  fs.writeFileSync(path.join(root, 'verifier/v447', OUT), JSON.stringify(report, null, 2));
  console.log(`\nwritten: verifier/v447/${OUT}`);
} finally {
  await killIsolated(proc, profile);
}

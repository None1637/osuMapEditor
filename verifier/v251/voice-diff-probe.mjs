// v251 诊断探针2: voice 级对比 — 滚轮风暴后哪些 hit 丢了/换了 buffer
// 方法: 包装 scheduler sink (记录每个排程 hit 的 mapMs/soundId/atCtx) 与 trackVoice
//   (记录实际发声 voice 的 mapMs + buffer 指纹), pass1 正常播放 vs pass2 滚轮风暴后,
//   对比同一测量窗 [61s, 64s] 内两边 voice 列表。
// 运行: node verifier/v251/voice-diff-probe.mjs (Electron, 内嵌 dist, 音频路径同打包 exe)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9437;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const electron = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuMenuCmd)').catch(() => false)) break;
    await sleep(500);
  }
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).then(() => !!window.__osuStore.beatmap).catch(e => 'ERR ' + e)`);
  console.log('打开谱面:', opened);
  for (let i = 0; i < 90; i++) {
    if (await evalJs('(window.__osuStore.audioBuffer?.duration ?? 0) > 100').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.seek(10000); s.play(); return 1; })()`);
  await sleep(300);
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); return 1; })()`);

  // 装 voice 级记录器
  const inst = await evalJs(`(() => {
    const s = window.__osuStore;
    const ck = s.clock;
    // buffer 指纹: 时长+采样率和 (区分用哪个采样)
    const fp = (buf) => {
      const d = buf.getChannelData(0);
      let h = 0; const n = Math.min(2000, d.length);
      for (let i = 0; i < n; i += 7) h = (h * 31 + (d[i] * 1e6 | 0)) | 0;
      return buf.duration.toFixed(3) + '@' + buf.sampleRate + '#' + h.toString(16);
    };
    window.__schedLog = [];  // sink.schedule 记录: 排程事件
    window.__voiceLog = [];  // trackVoice 记录: 实际创建的 voice
    window.__seekLog = [];   // seekWhilePlaying 落点
    const sink = s.scheduler.sink; // TS private 运行时可访问
    const origSched = sink.schedule.bind(sink);
    sink.schedule = (at, soundId, fallbacks, volume) => {
      const mapMs = ck.mapOffsetMs + (at - ck.phaseStartSec) * 1000 * ck.rate;
      window.__schedLog.push({ mapMs: +mapMs.toFixed(1), at: +at.toFixed(3), anchor: +ck.phaseStartSec.toFixed(3),
        soundId, past: at < s.actx.currentTime });
      return origSched(at, soundId, fallbacks, volume);
    };
    const origTV = s.trackVoice.bind(s);
    s.trackVoice = (buf, src, gain, startCtx, endCtx) => {
      const mapMs = ck.mapOffsetMs + (startCtx - ck.phaseStartSec) * 1000 * ck.rate;
      window.__voiceLog.push({ mapMs: +mapMs.toFixed(1), at: +startCtx.toFixed(3), anchor: +ck.phaseStartSec.toFixed(3), fp: fp(buf) });
      src.addEventListener('ended', () => { (window.__endedLog ??= []).push({ at: +startCtx.toFixed(3), t: +s.actx.currentTime.toFixed(3) }); });
      return origTV(buf, src, gain, startCtx, endCtx);
    };
    const origSWP = s.seekWhilePlaying.bind(s);
    s.seekWhilePlaying = (t) => {
      const r = origSWP(t);
      window.__seekLog.push({ target: Math.round(t), rawAfter: Math.round(ck.rawNowMs()) });
      return r;
    };
    return { outputLatency: s.actx.outputLatency ?? null, baseLatency: s.actx.baseLatency ?? null,
      sampleRate: s.actx.sampleRate, rate: s.playbackRate, tempo: s.tempoActive };
  })()`);
  console.log('环境:', JSON.stringify(inst));

  const T0 = 60000, GATE = 61000, WEND = 64000;
  const RUN_PASS = `(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < ${GATE}) await new Promise(r => setTimeout(r, 30));
    // 测量窗开始: 打快照起点 (日志按 mapMs 过滤, 不用清空)
    const t0 = performance.now();
    while (s.positionMs() < ${WEND} && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 50));
    return { pos: Math.round(s.positionMs()) };
  })()`;

  console.log('== pass1: 正常播放');
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${T0}); s.play(); return 1; })()`);
  await sleep(200);
  await evalJs(RUN_PASS);
  const sched1 = await evalJs(`window.__schedLog.filter(e => e.mapMs >= ${GATE} - 20 && e.mapMs < ${WEND})`);
  const voice1 = await evalJs(`window.__voiceLog.filter(e => e.mapMs >= ${GATE} - 20 && e.mapMs < ${WEND})`);
  console.log(`  pass1: 排程 ${sched1.length}, voice ${voice1.length}`);

  console.log('== pass2: 滚轮风暴后播放');
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${T0}); s.play(); return 1; })()`);
  await sleep(200);
  await evalJs(`(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < ${GATE}) await new Promise(r => setTimeout(r, 30));
    // 风暴: 滚回段首
    for (let i = 0; i < 60 && s.positionMs() > ${T0} + 100; i++) {
      s.wheelSeek(-120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    for (let i = 0; i < 20 && s.positionMs() < ${T0} - 100; i++) {
      s.wheelSeek(120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    return 1;
  })()`);
  const seekLog = await evalJs('window.__seekLog.slice(-15)');
  console.log('  风暴落点(末15):', JSON.stringify(seekLog));
  await evalJs(RUN_PASS);
  const sched2 = await evalJs(`window.__schedLog.filter(e => e.mapMs >= ${GATE} - 20 && e.mapMs < ${WEND})`);
  const voice2 = await evalJs(`window.__voiceLog.filter(e => e.mapMs >= ${GATE} - 20 && e.mapMs < ${WEND})`);
  console.log(`  pass2: 排程 ${sched2.length}, voice ${voice2.length}`);

  // diff: 按 mapMs 分组统计每个事件被排程/发声的次数与锚点
  const grp = (arr) => {
    const g = new Map();
    for (const e of arr) { const k = e.mapMs.toFixed(0); (g.get(k) ?? g.set(k, []).get(k)).push(e); }
    return g;
  };
  const g1 = grp(sched1), g2 = grp(sched2);
  const dup2 = [...g2.entries()].filter(([, v]) => v.length > 1)
    .map(([k, v]) => ({ mapMs: k, n: v.length, anchors: v.map(e => e.anchor), ats: v.map(e => e.at) }));
  console.log(`  pass1 事件数 ${g1.size} (重复 ${[...g1.values()].filter(v => v.length > 1).length}), pass2 事件数 ${g2.size} (重复 ${dup2.length})`);
  console.log('  pass2 重复排程样例(前5):', JSON.stringify(dup2.slice(0, 5)));
  // 被 stop 的 voice: ended 时刻早于其预定发声时刻 => 未发声就被杀
  const endedStat = await evalJs(`(() => {
    const log = window.__endedLog ?? [];
    const voices = window.__voiceLog;
    // 按 at 匹配 voice 的 ended: t < at-0.002 = 发声前被杀; at <= t < at+0.8 = 发声中被截断; 否则播完
    let killedPre = 0, truncated = 0, full = 0, noEnd = 0;
    for (const v of voices) {
      const e = log.find(x => Math.abs(x.at - v.at) < 0.002);
      if (!e) { noEnd++; continue; }
      if (e.t < v.at - 0.002) killedPre++;
      else if (e.t < v.at + 0.8) truncated++;
      else full++;
    }
    return { total: voices.length, killedPre, truncated, full, noEnd };
  })()`);
  console.log('  voice 结局:', JSON.stringify(endedStat));
  await evalJs('window.__osuStore.pause()');
} finally {
  try { electron.kill(); } catch { /* noop */ }
  await sleep(800);
}
process.exit(0);

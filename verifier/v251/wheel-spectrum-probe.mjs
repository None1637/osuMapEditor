// v251 诊断探针: 播放中滚轮 seek 后音乐频谱是否降质 (16kHz+ 消失)
// 方法: AnalyserNode 并联搭到音乐总线 (不影响发声), 同一段落播两遍:
//   pass1 = 正常播放; 然后播放中连续 wheelSeek 滚回段首 (用户复现路径), pass2 = 滚后播放。
// 比较 16k+ 高频带与 1-4k 中频带能量比 (排除两遍响度差)。
// 运行: node verifier/v251/wheel-spectrum-probe.mjs (需 7100 dev server)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// ENGINE=electron: 跑 Electron (exe 环境, userData 有 songsDir 配置可载 cygnus 音频); 默认无头 Edge (dev server)
const ENGINE = process.env.ENGINE || 'edge';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = ENGINE === 'electron' ? 'http://127.0.0.1:7199/' : 'http://localhost:7100/';
const DEBUG_PORT = 9436;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v251-'));
const edge = ENGINE === 'electron'
  ? spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' })
  : spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', APP_URL,
  ], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('EDGE_CONNECT_FAILED'); process.exit(2); }
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
  // 打开用户反馈的谱面 (真实歌曲, 16k+ 有内容; dev 默认谱面 24s 无高频, 测不出差异)
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).then(() => !!window.__osuStore.beatmap).catch(e => 'ERR ' + e)`);
  console.log('打开谱面:', opened);
  for (let i = 0; i < 90; i++) {
    // 等 cygnus 的音频 (130s) 换掉旧谱面 buffer (不能只看 truthy — 旧谱面也有 buffer)
    if (await evalJs('(window.__osuStore.audioBuffer?.duration ?? 0) > 100').catch(() => false)) break;
    await sleep(500);
  }

  // 搭 analyser 并联到音乐总线; 找一个音量足且长度够的段落
  const setup = await evalJs(`(() => {
    const s = window.__osuStore;
    const actx = s.actx;
    if (!actx) return { err: 'no actx (先 play 一次才会建)' };
    return { sampleRate: actx.sampleRate, dur: s.audioBuffer.duration, state: actx.state };
  })()`);
  console.log('环境:', JSON.stringify(setup));

  // 确保 actx 存在 (play 一瞬再暂停)
  await evalJs(`(() => { const s = window.__osuStore; s.seek(10000); s.play(); return 1; })()`);
  await sleep(300);
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); return 1; })()`);

  const info = await evalJs(`(() => {
    const s = window.__osuStore;
    const actx = s.actx;
    // 音乐/hitsound 各搭一个 analyser (并联 tap, 不改变发声), 分开定位降质来源
    const mk = () => { const an = actx.createAnalyser(); an.fftSize = 16384; an.smoothingTimeConstant = 0.5; return an; };
    window.__anMusic = mk(); window.__anHit = mk();
    s.musicBus.connect(window.__anMusic);
    s.ensureHitBus().connect(window.__anHit);
    // hitsound voice 计数 (trackVoice 是所有 hitsound/循环音/节拍器入口; TS private 运行时可访问)
    window.__voiceCount = 0;
    const orig = s.trackVoice.bind(s);
    s.trackVoice = (...a) => { window.__voiceCount++; return orig(...a); };
    return { sampleRate: actx.sampleRate, state: actx.state, fftBins: 8192 };
  })()`);
  console.log('analyser:', JSON.stringify(info));

  const MEASURE = (gateMs, ms) => `(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < ${gateMs}) await new Promise(r => setTimeout(r, 30)); // 对齐测量窗起点
    window.__voiceCount = 0;
    window.__osuStore.debugLog.length = 0; // 只统计本测量窗内的 hitsound 类型
    const sr = ${info.sampleRate};
    const meas = async (an, ms2) => {
      const n = an.frequencyBinCount;
      const binHz = sr / 2 / n;
      const acc = new Float64Array(n);
      let frames = 0;
      const data = new Float32Array(n);
      const t0 = performance.now();
      while (performance.now() - t0 < ms2) {
        an.getFloatFrequencyData(data);
        for (let i = 0; i < n; i++) acc[i] += data[i];
        frames++;
        await new Promise(r => setTimeout(r, 50));
      }
      const band = (f0, f1) => {
        let sum = 0, cnt = 0;
        for (let i = Math.floor(f0 / binHz); i < Math.min(n, Math.ceil(f1 / binHz)); i++) { sum += Math.max(-200, acc[i] / frames); cnt++; }
        return cnt ? +(sum / cnt).toFixed(1) : -200;
      };
      return { low: band(1000, 4000), mid: band(8000, 12000), hf: band(16000, 20000) };
    };
    // 两总线同时测 (各自窗口)
    // 循环音活性监测: 测量窗内每 100ms 采样一次发声中的滑条循环数
    let loopMax = 0; const t1 = performance.now();
    const loopWatch = (async () => { while (performance.now() - t1 < ${ms}) { loopMax = Math.max(loopMax, s.activeLoopNodes.size); await new Promise(r => setTimeout(r, 100)); } })();
    const [m, h] = await Promise.all([meas(window.__anMusic, ${ms}), meas(window.__anHit, ${ms})]);
    await loopWatch;
    return { music: m, hit: h, loopMax };
  })()`;

  const LOG_SNAP = `(() => {
    const m = {};
    for (const e of window.__osuStore.debugLog) {
      const k = e.kind + ':' + e.soundId + (e.used === 'MISS' ? ':MISS' : '');
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  })()`;

  const T0 = 60000, SEG = 3000, GATE = T0 + 1000; // 两遍都测 [61s, 64s] 同一窗口
  console.log('== pass1: 正常播放 (对照)');
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${T0}); s.play(); return 1; })()`);
  await sleep(200);
  const p1 = await evalJs(MEASURE(GATE, SEG));
  const v1 = await evalJs('window.__voiceCount');
  const log1 = await evalJs(LOG_SNAP);
  console.log('  pass1:', JSON.stringify(p1), 'hitsound voices:', v1, '类型:', JSON.stringify(log1));

  console.log('== 播放中连续 wheelSeek 滚回段首 (复现用户操作)');
  await evalJs(`(async () => {
    const s = window.__osuStore;
    // 滚回: 每 60ms 一个滚轮刻度, 直到位置 <= T0+100
    for (let i = 0; i < 60 && s.positionMs() > ${T0} + 100; i++) {
      s.wheelSeek(-120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    // 回滚过头则往前滚到段首附近
    for (let i = 0; i < 20 && s.positionMs() < ${T0} - 100; i++) {
      s.wheelSeek(120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    return { pos: Math.round(s.positionMs()), playing: s.playing };
  })()`);
  await sleep(150);
  const mid = await evalJs('(() => { const s = window.__osuStore; return { pos: Math.round(s.positionMs()), playing: s.playing, voices: s.voiceLimiter ? undefined : 0 }; })()');
  console.log('  滚后状态:', JSON.stringify(mid));

  console.log('== pass2: 滚后播放同段 (测量)');
  const p2 = await evalJs(MEASURE(GATE, SEG));
  const v2 = await evalJs('window.__voiceCount');
  const log2 = await evalJs(LOG_SNAP);
  console.log('  pass2:', JSON.stringify(p2), 'hitsound voices:', v2, '类型:', JSON.stringify(log2));

  const spans = await evalJs(`(() => {
    const bm = window.__osuStore.beatmap;
    return bm.hitObjects.filter(o => o.type === 'slider' && o.time < 64500 && (o.endTime ?? o.time) > 59500)
      .map(o => ({ t: o.time, end: Math.round(o.endTime ?? 0) }));
  })()`);
  console.log('  60-64s 附近滑条:', JSON.stringify(spans));
  await evalJs('window.__osuStore.pause()');

  const dh = +(p2.hit.hf - p1.hit.hf).toFixed(1), dm = +(p2.music.hf - p1.music.hf).toFixed(1);
  console.log(`== 16k+ 变化: hitsound总线 ${dh}dB, 音乐总线 ${dm}dB; voices ${v1} vs ${v2}`);
  console.log(Math.abs(dh) < 3 && Math.abs(dm) < 3 ? 'SPECTRUM_SAME (应用输出无降质)' : 'SPECTRUM_CHANGED (复现了降质!)');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1000);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
process.exit(0);

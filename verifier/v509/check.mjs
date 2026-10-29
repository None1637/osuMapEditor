// v509: 慢放保时音高兜底 + 原始 PCM 主路径诊断
// A: 源码契约; B: 合成 440Hz WAV 的 CDP 运行时回归 (不依赖/不提交真实歌曲)。
// 运行: npm run build 后 node verifier/v509/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

section('A: 源码契约');
{
  const st = read('src/osu/store.ts');
  assert(/playbackRate !== 1 && !this\.rateAdjustPitch && !this\.tempoNode\)/.test(st), 'signalsmith 未就绪时进入独立慢放兜底');
  assert(/this\.audio\.preservesPitch = true/.test(st) && /webkitPreservesPitch = true/.test(st), '兜底 <audio> 强制保时音高');
  assert(!/本次退回 playbackRate \(变调\)/.test(st), '旧原生 playbackRate 慢放兜底已移除');
  assert(/private htmlAudioActive = false/.test(st), 'HTML 兜底播放状态显式记录');
  assert((st.match(/this\.audioBuffer && this\.(?:actx && this\.)?clock && !this\.htmlAudioActive/g) ?? []).length === 3, 'position/seek/pause 不读未启动的 WebAudio 时钟');
  assert(/this\.playing && this\.audioBuffer && this\.clock && !this\.htmlAudioActive/.test(st), 'pause 从 HTMLAudio 取回位置');
  assert(/this\.audio\?\.pause\(\); \/\/ v509: 从 HTML 慢放兜底切回/.test(st), '引擎接管时关闭 HTML 第二路声音');
  assert(/this\.playbackRate !== 1 && this\.rateAdjustPitch && !this\.rateNode/.test(st), 'DT/HT 变调支路保持原语义');
}

// 自生成 12 秒双声道 440Hz + 弱谐波，仅供本地/验证器测试。
function toneWav() {
  const sr = 48000, channels = 2, frames = sr * 12;
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + frames * channels * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    const v = Math.round((Math.sin(2 * Math.PI * 440 * t) * 0.5 + Math.sin(2 * Math.PI * 1320 * t) * 0.1) * 32767);
    b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4);
  }
  return b.toString('base64');
}

section('B: CDP 合成音频运行时');
{
  const PORT = 9524;
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    const initialReady = await evalJs(`(async () => {
      const s = window.__osuStore;
      s.pause();
      for (let i = 0; i < 120 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250));
      return !!s.audioBuffer;
    })()`);
    assert(initialReady, '初始音频解码完毕（防止异步覆盖合成音频）');

    const b64 = toneWav();
    await evalJs('window.__v509parts = []; true');
    for (let i = 0; i < b64.length; i += 900000) {
      await evalJs(`window.__v509parts.push(${JSON.stringify(b64.slice(i, i + 900000))}); true`);
    }
    const loaded = await evalJs(`(async () => {
      const s = window.__osuStore;
      const bin = atob(window.__v509parts.join(''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__v509parts = null;
      s.setAudio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
      for (let i = 0; i < 120 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250));
      if (!s.audioBuffer) return false;
      window.__v509ensureTempo = s.ensureTempoNode;
      s.ensureTempoNode = () => {}; // 固定留在兜底，先验证最差路径
      s.tempoLoading = null;
      s.tempoNode = null;
      s.rateAdjustPitch = false;
      s.playbackRate = 0.5;
      s.currentTime = 0;
      s.play();
      return true;
    })()`);
    assert(loaded, '合成 WAV 解码并启动 0.5× 慢放');

    const fallback = await evalJs(`(() => {
      const s = window.__osuStore;
      return {
        html: s.htmlAudioActive, preservesPitch: s.audio?.preservesPitch,
        rate: s.audio?.playbackRate, nativeSource: !!s.source,
        tempoActive: s.tempoActive, clockRunning: s.clock?.running,
      };
    })()`);
    assert(fallback.html && fallback.preservesPitch && fallback.rate === 0.5, `兜底保时音高且倍率正确 (${JSON.stringify(fallback)})`);
    assert(!fallback.nativeSource && !fallback.tempoActive && !fallback.clockRunning, '兜底不创建降调 BufferSource，也不启动错误时钟');

    await sleep(600);
    const advancing = await evalJs(`(() => {
      const s = window.__osuStore;
      return { position: s.positionMs(), media: s.audio.currentTime * 1000, paused: s.audio.paused };
    })()`);
    assert(!advancing.paused && advancing.position > 100 && advancing.position < 900 && Math.abs(advancing.position - advancing.media) < 50,
      `HTML 兜底位置随 0.5× 播放推进 (${JSON.stringify(advancing)})`);

    await evalJs('window.__osuStore.seekWhilePlaying(3000); true');
    await sleep(120);
    const sought = await evalJs(`(() => {
      const s = window.__osuStore;
      return { position: s.positionMs(), media: s.audio.currentTime * 1000, clockRunning: s.clock.running, html: s.htmlAudioActive };
    })()`);
    assert(sought.html && !sought.clockRunning && Math.abs(sought.position - sought.media) < 50 && sought.media >= 3000 && sought.media < 3400,
      `播放中 seek 直接移动 HTMLAudio (${JSON.stringify(sought)})`);

    const paused = await evalJs(`(() => {
      const s = window.__osuStore;
      const before = s.audio.currentTime * 1000;
      s.pause();
      return { before, after: s.currentTime, mediaPaused: s.audio.paused, html: s.htmlAudioActive };
    })()`);
    assert(paused.mediaPaused && !paused.html && Math.abs(paused.before - paused.after) < 40,
      `暂停保留 HTMLAudio 实际位置 (${JSON.stringify(paused)})`);

    await evalJs(`(() => {
      const s = window.__osuStore;
      s.currentTime = 11500;
      s.play();
      return true;
    })()`);
    await sleep(1600);
    const ended = await evalJs(`(() => {
      const s = window.__osuStore;
      return { playing: s.playing, html: s.htmlAudioActive, currentTime: s.currentTime, mediaEnded: s.audio.ended };
    })()`);
    assert(!ended.playing && !ended.html && ended.mediaEnded && Math.abs(ended.currentTime - 12000) < 2,
      `兜底自然播完停在曲尾而不回跳 (${JSON.stringify(ended)})`);

    await evalJs(`(() => {
      const s = window.__osuStore;
      s.currentTime = 3000;
      s.ensureTempoNode = window.__v509ensureTempo;
      s.tempoLoading = null;
      s.play();
      return true;
    })()`);
    let handedOff = false;
    for (let i = 0; i < 80 && !handedOff; i++) {
      await sleep(250);
      handedOff = await evalJs(`(() => {
        const s = window.__osuStore;
        return !!(s.tempoNode && s.tempoActive && !s.htmlAudioActive && s.audio?.paused && !s.source);
      })()`);
    }
    assert(handedOff, 'signalsmith 就绪后自动接管，HTML 声音停止且无双路播放');
    await evalJs('window.__osuStore.pause(); true');
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V509_FAILED: ${failures} 处失败` : '\nVERIFIER_V509_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v509: 从 tempoGain 直接抓原始 PCM (不经系统混音/Opus)，用于慢放对比。
// 用法: node verifier/v509/realtime-raw.mjs <mapDir> <rate> <seconds> <outWav>
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const [mapDir, rateText = '0.75', secondsText = '8', outRel = 'verifier/v509/realtime-raw.wav'] = process.argv.slice(2);
const rate = Number(rateText);
const seconds = Number(secondsText);
if (!mapDir || !(rate > 0) || !(seconds > 0)) {
  console.error('用法: node verifier/v509/realtime-raw.mjs <mapDir> <rate> <seconds> <outWav>');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9523;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  if (!target) throw new Error('no target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1200));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);
  // 等初始谱面音频解码结束，避免后到的 decode 覆盖测试音频。
  const initialReady = await evalJs(`(async () => {
    const s = window.__osuStore;
    s.pause();
    for (let i = 0; i < 120 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250));
    return !!s.audioBuffer;
  })()`);
  if (!initialReady) throw new Error('初始音频未解码完成');

  const files = fs.readdirSync(mapDir);
  const audioName = files.find(f => /\.(mp3|ogg|wav|flac|m4a)$/i.test(f));
  if (!audioName) throw new Error('谱面目录中找不到音频: ' + mapDir);
  const b64 = fs.readFileSync(path.join(mapDir, audioName)).toString('base64');
  const CH = 900000;
  await evalJs('window.__mp3parts = []; true');
  for (let i = 0; i < b64.length; i += CH) {
    await evalJs(`window.__mp3parts.push(${JSON.stringify(b64.slice(i, i + CH))}); true`);
  }
  const info = await evalJs(`(async () => {
    const s = window.__osuStore;
    const bin = atob(window.__mp3parts.join(''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.__mp3parts = null;
    s.setAudio(URL.createObjectURL(new Blob([bytes])));
    for (let i = 0; i < 240 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250));
    if (!s.audioBuffer) return null;
    s.setRateAdjustPitch(false);
    s.playbackRate = ${rate};
    s.ensureTempoNode();
    if (s.tempoLoading) await s.tempoLoading;
    return {
      sampleRate: s.actx.sampleRate,
      bufferSampleRate: s.audioBuffer.sampleRate,
      channels: s.audioBuffer.numberOfChannels,
      duration: s.audioBuffer.duration,
      tempoReady: !!s.tempoNode,
      preservesPitchMode: !s.rateAdjustPitch,
    };
  })()`);
  if (!info) throw new Error('测试音频未解码完成');
  if (!info.tempoReady) throw new Error('signalsmith-stretch 未就绪');
  console.log('audio:', info);

  const workletCode = `
    class RecProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.recording = false;
        this.port.onmessage = e => {
          if (e.data === 'start') this.recording = true;
          if (e.data === 'stop') this.recording = false;
        };
      }
      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        for (let c = 0; c < output.length; c++) {
          output[c].fill(0);
          if (input[c]) output[c].set(input[c]);
        }
        if (this.recording && input.length) {
          this.port.postMessage(input.map(ch => ch.slice()));
        }
        return true;
      }
    }
    registerProcessor('v509-recorder', RecProcessor);
  `;
  await evalJs(`(async () => {
    const s = window.__osuStore;
    const actx = s.actx;
    const src = ${JSON.stringify(workletCode)};
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    await actx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const rec = new AudioWorkletNode(actx, 'v509-recorder', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
    });
    const chunks = [];
    rec.port.onmessage = e => chunks.push(e.data);
    const sink = actx.createGain();
    sink.gain.value = 0; // 只拉取录音支路，不额外向扬声器叠一份声音
    s.tempoGain.connect(rec);
    rec.connect(sink);
    sink.connect(actx.destination);
    window.__v509rec = rec;
    window.__v509chunks = chunks;
    window.__v509sink = sink;
    return true;
  })()`);

  const result = await evalJs(`(async () => {
    const s = window.__osuStore;
    const rec = window.__v509rec;
    const chunks = window.__v509chunks;
    s.pause();
    s.currentTime = 0;
    s.playbackRate = ${rate};
    chunks.length = 0;
    rec.port.postMessage('start');
    s.play();
    const started = { tempoActive: s.tempoActive, rateActive: s.rateActive, nativeSource: !!s.source };
    await new Promise(r => setTimeout(r, ${seconds * 1000}));
    rec.port.postMessage('stop');
    s.pause();
    await new Promise(r => setTimeout(r, 100));
    s.tempoGain.disconnect(rec);
    rec.disconnect();
    window.__v509sink.disconnect();
    const total = chunks.reduce((n, block) => n + (block[0]?.length || 0), 0);
    const channels = 2;
    const sampleRate = s.actx.sampleRate;
    const buffer = new ArrayBuffer(44 + total * channels * 2);
    const dv = new DataView(buffer);
    const write = (off, text) => { for (let i = 0; i < text.length; i++) dv.setUint8(off + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); dv.setUint32(4, 36 + total * channels * 2, true); write(8, 'WAVE');
    write(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, channels, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * channels * 2, true); dv.setUint16(32, channels * 2, true);
    dv.setUint16(34, 16, true); write(36, 'data'); dv.setUint32(40, total * channels * 2, true);
    let off = 44;
    let sum = 0;
    let peak = 0;
    for (const block of chunks) {
      const frames = block[0]?.length || 0;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          const ch = block[c] || block[0];
          const v = ch ? Math.max(-1, Math.min(1, ch[i])) : 0;
          sum += v * v;
          peak = Math.max(peak, Math.abs(v));
          dv.setInt16(off, Math.round(v * 32767), true);
          off += 2;
        }
      }
    }
    const bytes = new Uint8Array(buffer);
    let bin = '';
    const step = 32768;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return { wav: btoa(bin), started, total, sampleRate, rms: Math.sqrt(sum / (total * channels)), peak };
  })()`);
  if (!result?.wav) throw new Error('录音失败');
  const out = path.resolve(root, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(result.wav, 'base64'));
  console.log('playback:', result.started);
  console.log('saved:', out, 'frames:', result.total, 'sampleRate:', result.sampleRate,
    'rms:', result.rms.toFixed(6), 'peak:', result.peak.toFixed(6));
} finally {
  await killIsolated(electron, profile);
}

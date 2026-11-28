// v599: 真实 Electron + 曲库 MP3 — 慢放必须走原生 BASS, 不走 signalsmith/sinc/HTML
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 9559;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { proc, profile } = launchIsolatedElectron(root, port, {
  exePath: process.env.PACKAGED_EXE ?? null,
  settingsPatch: {
    songsDir: 'F:\\Backup\\D\\osu!\\Songs',
    recents: [{ folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu', label: 'v599' }],
  },
});
let ws, msgId = 0, failures = 0;
const pending = new Map(), exceptions = [];
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const send = (method, params = {}) => new Promise(resolve => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url)); } catch { /* retry */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('找不到 Electron 页面');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  };
  await send('Runtime.enable');
  await normalizeEnv(evalJs);
  await evalJs(`(() => { const s = window.__osuStore; s.setVolume('master', 0); s.seek(0); s.playbackRate = 0.5; s.play(); })()`);
  await sleep(1500);
  const state = await evalJs(`(() => { const s = window.__osuStore; return { bass: s.bassActive, tempo: s.tempoActive, rate: s.rateActive, html: s.htmlAudioActive, playing: s.playing, time: s.currentTime }; })()`);
  console.log('  state:', JSON.stringify(state));
  ok(state.bass && state.playing, '0.5x 原生 BASS 正在播放');
  ok(!state.tempo && !state.rate && !state.html, 'signalsmith/sinc/HTML 音乐支路均未启用');
  await evalJs('window.__osuStore.pause()');
  await evalJs('window.__osuStore.seek(1000); window.__osuStore.play()');
  await sleep(500);
  ok(await evalJs('window.__osuStore.bassActive'), '暂停后重进仍走 BASS');
  await evalJs('window.__osuStore.seekWhilePlaying(2000)');
  await sleep(300);
  ok(await evalJs('window.__osuStore.bassActive'), '播放中 seek 仍走 BASS');
  await evalJs('window.__osuStore.pause(); window.__osuStore.mapSource = null; window.__osuStore.play()');
  await sleep(1000);
  ok(await evalJs('window.__osuStore.bassActive'), '非曲库音频字节也走 BASS 临时文件通道');
  await evalJs('window.__osuStore.pause()');
  ok(exceptions.length === 0, `无页面异常 (${exceptions.join('; ')})`);
} catch (e) { failures++; console.error('  FAIL:', e?.stack ?? e); }
finally { if (ws) ws.close(); await killIsolated(proc, profile); }
console.log(failures ? `V599_E2E_FAILED: ${failures}` : 'V599_E2E_PASSED');
process.exit(failures ? 1 : 0);

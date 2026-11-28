// v619: BASS 唯一时间源, hitsound 共用 AudioClock 映射; 无 Available 动态缓冲
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sidecar = fs.readFileSync(path.join(root, 'native/BassAudioSidecar/Program.cs'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(sidecar.includes('}, null, 0, 50)') && sidecar.includes('now - lastBufferSampleMs >= 1000'), '50ms 轻量位置事件, Available 仅每秒校准 (v620)');
ok(store.includes('msg.requestId !== this.bassRequestId'), '旧流位置事件被丢弃');
ok(store.includes('this.clock.onStartedAtCtxTime(this.actx.currentTime, msg.seconds * 1000 - bufferMs)'), 'hitsound 的 AudioClock 使用 BASS 可闻位置 (v620)');
ok(store.includes('p.seconds * 1000 - p.bufferMs + (performance.now() - p.atMs) * this.playbackRate'), '时间轴由 BASS 可闻位置推进 (v620)');
ok(store.includes('const bassPosition = this.bassActive ? this.positionMs() : null'), '暂停保留 BASS 位置');

const port = 9561, sleep = ms => new Promise(r => setTimeout(r, ms));
const { proc, profile } = launchIsolatedElectron(root, port, {
  exePath: process.env.PACKAGED_EXE ?? null,
  settingsPatch: {
    songsDir: 'F:\\Backup\\D\\osu!\\Songs',
    recents: [{ folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu', label: 'v619' }],
  },
});
let ws, msgId = 0;
const pending = new Map(), exceptions = [];
const send = (method, params = {}) => new Promise(resolve => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url)); } catch { }
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
  await evalJs(`(() => { const s = window.__osuStore; s.setVolume('master', 0); s.seek(0); s.playbackRate = 0.25; s.play(); })()`);
  await sleep(4000);
  const sync = await evalJs(`(() => { const s = window.__osuStore; return { bass: s.bassActive, sync: s.bassSync, now: performance.now(), current: s.positionMs(), clockRaw: s.clock.rawNowMs() }; })()`);
  ok(sync.bass && sync.sync, `25% BASS 唯一时间源运行 (${JSON.stringify(sync)})`);
  if (sync.sync) {
    const expected = sync.sync.seconds * 1000 - sync.sync.bufferMs + (sync.now - sync.sync.atMs) * 0.25;
    ok(Math.abs(sync.current - expected) < 20, `时间轴与 BASS 位置差 <20ms (${(sync.current - expected).toFixed(1)}ms)`);
    ok(Math.abs(sync.clockRaw - expected) < 20, `hitsound 时钟与 BASS 位置差 <20ms (${(sync.clockRaw - expected).toFixed(1)}ms)`);
  }
  const perf = await evalJs(`(async () => {
    const s = window.__osuStore, intervals = [], positions = [];
    let prev = performance.now();
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now(); intervals.push(now - prev); prev = now; positions.push(s.positionMs());
    }
    intervals.shift(); positions.shift();
    const sorted = [...intervals].sort((a,b) => a-b);
    let maxBack = 0;
    for (let i = 1; i < positions.length; i++) maxBack = Math.max(maxBack, positions[i-1] - positions[i]);
    return { avg: intervals.reduce((a,b) => a+b, 0) / intervals.length, p95: sorted[Math.floor(sorted.length*.95)], maxBack };
  })()`);
  ok(perf.avg < 12 && perf.p95 < 25, `25% 帧耗时正常 avg=${perf.avg.toFixed(2)}ms p95=${perf.p95.toFixed(2)}ms`);
  ok(perf.maxBack <= 0.01, `播放位置无回退 (${perf.maxBack}ms)`);
  const paused = await evalJs(`(() => { const s = window.__osuStore, before = s.positionMs(); s.pause(); return { before, paused: s.currentTime }; })()`);
  ok(Math.abs(paused.before - paused.paused) < 20, `暂停保留 BASS 位置 (${(paused.paused - paused.before).toFixed(1)}ms)`);
  await sleep(100); await evalJs('window.__osuStore.play()'); await sleep(300);
  const resumed = await evalJs('window.__osuStore.positionMs()');
  ok(resumed >= paused.paused && resumed - paused.paused < 150, `恢复不随机提前 (${(resumed - paused.paused).toFixed(1)}ms)`);
  await evalJs('window.__osuStore.pause()');
  ok(exceptions.length === 0, `无页面异常 (${exceptions.join('; ')})`);
} catch (e) { failures++; console.error('  FAIL:', e?.stack ?? e); }
finally { if (ws) ws.close(); await killIsolated(proc, profile); }
console.log(failures ? `VERIFIER_V619_FAILED: ${failures}` : 'VERIFIER_V619_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

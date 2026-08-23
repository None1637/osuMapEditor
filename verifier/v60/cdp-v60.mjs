// CDP v60 端到端: 变速不变调 — signalsmith-stretch 引擎接管 / 时间按倍速推进 / 频谱峰值证明音高不变 / ended / seek / rate1 绕过
// 运行: node verifier/v60/cdp-v60.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9395;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v60-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900',
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
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuStore.debugState().hasAudioBuffer)');
  }
  if (!ready) throw new Error('应用未就绪');
  // demo 音频已解码, signalsmith-stretch 引擎应已预热
  await evalJs('window.__osuStore.pause(); "ok"');
  const warm = await evalJs('window.__osuStore.debugState().tempoReady');
  assert(warm === true, `解码后 signalsmith-stretch 引擎已预热 (tempoReady=${warm})`);

  console.log('== A) rate=0.5: signalsmith-stretch 引擎接管, 时间半速推进');
  {
    await evalJs(`document.querySelector('[data-speed-input="0.5"]').click(); "ok"`);
    await sleep(200);
    await evalJs('window.__osuStore.seek(2000); window.__osuStore.play(); "ok"');
    await sleep(800);
    const st = await evalJs('window.__osuStore.debugState()');
    assert(st.tempoActive === true, `tempoActive=true (signalsmith-stretch 接管, 实际 ${st.tempoActive})`);
    const t1 = await evalJs('window.__osuStore.currentTime');
    await sleep(800);
    const t2 = await evalJs('window.__osuStore.currentTime');
    const adv = t2 - t1;
    assert(adv > 200 && adv < 600, `半速推进 ~400ms/800ms (实际 ${Math.round(adv)}ms)`);
    await evalJs('window.__osuStore.pause(); "ok"');
  }

  console.log('== B) rate=0.25: 频谱峰值证明音高不变 (变调路径峰值会降到 1/4)');
  {
    // demo 旋律: 每 1s 谱面时间一个音 (523.25/587.33/659.25/783.99/880/1046.5), 前半段发音后半段休止;
    // 从 1000ms 起播 (音符刚触发), 14 次采样覆盖 rt 0.3~3.4s = map 1000~1775 (旋律活跃段)
    await evalJs(`document.querySelector('[data-speed-input="0.25"]').click(); "ok"`);
    await sleep(200);
    await evalJs('window.__osuStore.seek(1000); window.__osuStore.play(); "ok"');
    await sleep(300);
    const res = await evalJs(`(() => {
      const an = window.__osuStore.tempoAnalyser;
      if (!an) return 'no-analyser';
      const sr = an.context.sampleRate;
      const buf = new Float32Array(an.fftSize);
      const peaks = [];
      return new Promise(resolve => {
        let n = 0;
        const tick = () => {
          an.getFloatFrequencyData(buf);
          let bi = 0, bv = -Infinity;
          for (let i = 3; i < buf.length / 4; i++) if (buf[i] > bv) { bv = buf[i]; bi = i; }
          const f = bi * sr / an.fftSize;
          peaks.push(bv > -60 ? Math.round(f) : 0); // 静音窗记 0
          if (++n < 14) setTimeout(tick, 220); else resolve({ peaks, sr });
        };
        tick();
      });
    })()`);
    if (res === 'no-analyser') {
      assert(false, 'tempoAnalyser 不可用');
    } else {
      const VALID = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1000]; // 旋律 + 1000Hz 节拍滴答, 皆为原音高证据
      const voiced = res.peaks.filter(f => f > 0);
      const matches = voiced.filter(f => VALID.some(o => Math.abs(f - o) / o < 0.06)).length;
      const quartered = voiced.filter(f => VALID.some(o => Math.abs(f - o / 4) / (o / 4) < 0.06)).length;
      assert(matches >= 4, `有声窗峰值 ≥4 次命中原音高集合 (实际 ${matches}/${voiced.length}, 峰值 ${res.peaks})`);
      assert(quartered === 0, `无 1/4 频率峰值 (变调证据应为 0, 实际 ${quartered})`);
    }
    await evalJs('window.__osuStore.pause(); "ok"');
  }

  console.log('== C) tempo 模式 seek: 位置跳转且引擎保持');
  {
    await evalJs('window.__osuStore.play(); "ok"');
    await sleep(500);
    await evalJs('window.__osuStore.seek(8000); "ok"');
    await sleep(500);
    const [t, active, playing] = await evalJs('[window.__osuStore.currentTime, window.__osuStore.tempoActive, window.__osuStore.playing]');
    assert(active === true && playing === true, `seek 后仍在 tempo 播放 (实际 ${active}, ${playing})`);
    assert(t > 7900 && t < 8800, `seek 到 8000ms 附近 (实际 ${Math.round(t)}ms)`);
    await evalJs('window.__osuStore.pause(); "ok"');
  }

  console.log('== D) ended: 播到末尾自动停止');
  {
    const len = await evalJs('window.__osuStore.songLength()');
    await evalJs(`window.__osuStore.seek(${len - 600}); window.__osuStore.play(); "ok"`);
    // 0.25x 下剩余 600ms 谱面 = 2.4s 实时
    await sleep(3600);
    const [playing, t] = await evalJs('[window.__osuStore.playing, window.__osuStore.currentTime]');
    assert(playing === false, `播完自动停止 (实际 playing=${playing})`);
    assert(Math.abs(t - len) < 200, `停止位置 = 曲末 (实际 ${Math.round(t)} vs ${Math.round(len)})`);
  }

  console.log('== E) rate=1: 不走 signalsmith-stretch (source 节点原样播放)');
  {
    await evalJs(`document.querySelector('[data-speed-input="1"]').click(); "ok"`);
    await sleep(200);
    await evalJs('window.__osuStore.seek(2000); window.__osuStore.play(); "ok"');
    await sleep(600);
    const active = await evalJs('window.__osuStore.tempoActive');
    assert(active === false, `rate=1 tempoActive=false (实际 ${active})`);
    const t1 = await evalJs('window.__osuStore.currentTime');
    await sleep(700);
    const t2 = await evalJs('window.__osuStore.currentTime');
    const adv = t2 - t1;
    assert(adv > 500 && adv < 900, `1x 正常推进 (实际 ${Math.round(adv)}ms)`);
    await evalJs('window.__osuStore.pause(); "ok"');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
if (failures) { console.error(`\nVERIFIER_V60_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V60_CDP_PASSED');

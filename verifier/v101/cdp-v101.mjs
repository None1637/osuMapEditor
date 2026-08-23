// CDP v101 端到端: hitsound 总线 + 同采样并发上限 (lazer SAMPLE_CONCURRENCY=6)
// 页内直接驱动 sink: 连排 20 个同 stem hitsound (间隔 20ms, 模拟 1/4 密集段)
// A) 并发峰值 = 6 (上限生效, 最老被停)  B) 总线增益 = 0.8  C) 播完后 voice 全部注销
// 运行: node verifier/v101/cdp-v101.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9421;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v101-'));
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!window.__osuStore');
  }
  if (!ready) throw new Error('应用未就绪');

  // 创建时钟 + 等默认采样 (normal-hitnormal) 加载完
  await evalJs(`window.__osuStore.ensureClock(); window.__osuStore.actx.resume(); 'ok'`);
  let samplesReady = false;
  for (let i = 0; i < 30 && !samplesReady; i++) {
    await sleep(500);
    samplesReady = await evalJs(`window.__osuStore.defaultBuffers.has('normal-hitnormal')`);
  }
  if (!samplesReady) throw new Error('默认采样未加载');

  // A) 连排 20 个同 stem hitsound (20ms 间隔, 比 1/4 连打更密), 验证并发上限
  const r = await evalJs(`
    (() => {
      const s = window.__osuStore;
      const sink = s.scheduler.sink;
      const t0 = s.actx.currentTime + 0.05;
      for (let i = 0; i < 20; i++) sink.schedule(t0 + i * 0.02, 'normal-hitnormal', [], 100);
      return JSON.stringify({
        maxSeen: s.debugVoiceStats.maxSeen,
        active: s.debugVoiceStats.active,
        limiterTotal: s.voiceLimiter.totalCount(),
        busGain: s.hitBus ? s.hitBus.gain.value : null,
        ctxState: s.actx.state,
      });
    })()
  `);
  const a = JSON.parse(r);
  console.log('  排程后:', r);
  assert(Math.abs(a.busGain - 0.8) < 1e-6, `hitsound 总线增益 = 0.8 (实际 ${a.busGain})`);
  assert(a.maxSeen === 6, `并发峰值 = 6, 上限生效 (实际 ${a.maxSeen}; 无上限时 = 20)`);
  assert(a.limiterTotal <= 6, `限流器总量 ≤ 6 (实际 ${a.limiterTotal})`);

  // B) 排程进行中 (voice 尾巴 ~1.2s) 轮询, 任何时刻都不超上限
  let pollMax = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    const n = await evalJs(`window.__osuStore.debugVoiceStats.active`);
    if (n > pollMax) pollMax = n;
  }
  assert(pollMax <= 6, `播放中轮询并发 ≤ 6 (实际峰值 ${pollMax})`);

  // C) 播完 (采样 1.245s + 排程窗口) 后 voice 全部注销
  if (a.ctxState === 'running') {
    await sleep(2000);
    const left = await evalJs(`window.__osuStore.voiceLimiter.totalCount()`);
    assert(left === 0, `播完后 voice 全部注销 (残留 ${left})`);
  } else {
    console.log('  (AudioContext 未 running, 跳过注销衰减断言; 上限断言已在排程侧同步生效)');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V101_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V101_CDP_PASSED');

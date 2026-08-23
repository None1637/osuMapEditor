// CDP hitsound 排程延迟测试: 证明"播放中物件音效明显晚于音乐/画面"的 bug 及其修复
// 原理: 拦截 AudioBufferSourceNode.start(), 记录每个音源的排程时刻;
//   音乐源(长 buffer) 给出 ctx 时间线锚点 W, hitsound(短 buffer) 的实际排程时刻应与
//   W + (物件谱面时间 - 播放起点)/rate 精确对应 (采样级, 容差 50ms)。
//   修复前: ctxTimeForMapTime 误减 phaseSec (≈ -(页面加载到 ctx 启动的秒数)),
//   所有 hitsound 统一晚该时长 (秒级) -> 本测试必失败。
// 运行: node verifier/v17/cdp-latency.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9337;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-latency-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const targets = await res.json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

const target = await getTarget();
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
  // 等页面加载 + demo 谱面/音频就绪, 并故意停留 4 秒放大"页面打开 -> 首次播放"的原点差
  await sleep(4000);
  const ready = await evalJs(`!!window.__osuStore && !!window.__osuStore.beatmap`);
  assert(ready, 'demo 谱面已加载');

  // 拦截所有 AudioBufferSourceNode.start
  await evalJs(`
    window.__startLog = [];
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, dur) {
      window.__startLog.push({ when: when ?? 0, bufDur: this.buffer ? this.buffer.duration : -1, loop: !!this.loop });
      return origStart.call(this, when, offset, dur);
    };
    'patched'
  `);

  const t0 = await evalJs(`window.__osuStore.currentTime`);
  await evalJs(`window.__osuStore.play()`);
  await sleep(3000);
  await evalJs(`window.__osuStore.pause()`);

  const result = await evalJs(`JSON.stringify({
    log: window.__startLog,
    events: window.__osuStore.scheduler.events.map(e => e.mapTimeMs),
  })`);
  const { log, events } = JSON.parse(result);

  console.log('== start() 拦截记录: ' + log.length + ' 条');
  const music = log.filter(e => e.bufDur > 5);
  const hits = log.filter(e => e.bufDur > 0 && e.bufDur <= 5 && !e.loop);
  const loops = log.filter(e => e.loop);
  console.log('  音乐源: ' + music.length + ', hitsound: ' + hits.length + ', slide 循环: ' + loops.length);
  assert(music.length >= 1, '音乐源已启动');
  assert(hits.length >= 3, '播放 3 秒内排程了至少 3 个 hitsound (实际 ' + hits.length + ')');

  if (music.length && hits.length) {
    const W = music[0].when; // ctx 时间线上谱面位置 = t0 的时刻
    // 窗口内应被排程的事件 (250ms lookahead + 播放 3s -> 约 t0 ~ t0+3250)
    const winEvents = events.filter(t => t >= t0 - 1 && t <= t0 + 3000);
    // 每个事件都应在 W + (t - t0)/1000 处有一次对应的 start (贪心多重集匹配, 容差 50ms)
    const used = new Array(hits.length).fill(false);
    let matched = 0, maxErr = 0;
    const unmatched = [];
    for (const t of winEvents) {
      const expected = W + (t - t0) / 1000;
      let best = -1, bestErr = Infinity;
      for (let i = 0; i < hits.length; i++) {
        if (used[i]) continue;
        const err = Math.abs(hits[i].when - expected);
        if (err < bestErr) { bestErr = err; best = i; }
      }
      if (best >= 0 && bestErr < 0.05) { used[best] = true; matched++; maxErr = Math.max(maxErr, bestErr); }
      else unmatched.push(t);
    }
    console.log('  窗口内事件: ' + winEvents.length + ', 精确匹配: ' + matched + ', max 误差: ' + (maxErr * 1000).toFixed(1) + 'ms');
    if (unmatched.length) console.log('  未匹配事件时刻: ' + unmatched.join(', '));
    assert(unmatched.length === 0, '每个 hitsound 事件都在正确时刻排程 (修复前统一晚 |phaseSec|≈页面打开到播放的秒数)');
    assert(maxErr < 0.05, '排程误差 < 50ms (实际 max ' + (maxErr * 1000).toFixed(1) + 'ms)');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '无未捕获异常');

  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v17-latency.json'), JSON.stringify({ t0, log }, null, 2));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V17_CDP_LATENCY_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V17_CDP_LATENCY_PASSED');

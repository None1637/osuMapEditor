// CDP v59 端到端: 底栏右侧倍速页签 (点击切速/激活加粗/播放中切速不中断)
// 运行: node verifier/v59/cdp-v59.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9394;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v59-'));
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
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  console.log('== A) 四档页签存在于底栏右侧 (lazer PlaybackTabControl)');
  {
    const tabs = await evalJs(`[...document.querySelectorAll('[data-speed-input]')].map(b => [b.dataset.speedInput, b.textContent])`);
    assert(tabs.length === 4, `4 个页签 (实际 ${tabs.length})`);
    assert(JSON.stringify(tabs.map(t => t[1])) === JSON.stringify(['25%', '50%', '75%', '100%']),
      `标签 25%/50%/75%/100% (实际 ${JSON.stringify(tabs)})`);
    const def = await evalJs(`window.__osuStore.playbackRate`);
    assert(def === 1, `默认 1.00 倍速 (实际 ${def})`);
    const activeDef = await evalJs(`document.querySelector('[data-speed-input="1"]').className.includes('font-bold')`);
    assert(activeDef, '默认 100% 页签激活加粗');
  }

  console.log('== B) 点击切速 (暂停态)');
  for (const [v, expect] of [['0.5', 0.5], ['0.25', 0.25], ['0.75', 0.75], ['1', 1]]) {
    await evalJs(`document.querySelector('[data-speed-input="${v}"]').click(); "ok"`);
    await sleep(250);
    const rate = await evalJs('window.__osuStore.playbackRate');
    assert(rate === expect, `点击 ${v * 100}% -> playbackRate=${expect} (实际 ${rate})`);
    const bold = await evalJs(`document.querySelector('[data-speed-input="${v}"]').className.includes('font-bold')`);
    assert(bold, `${v * 100}% 页签激活加粗`);
  }

  console.log('== C) 播放中切速: 不中断播放 (lazer tempoAdjustment 实时生效)');
  {
    await evalJs('window.__osuStore.seek(1000); window.__osuStore.play(); "ok"');
    await sleep(600);
    const playing0 = await evalJs('window.__osuStore.playing');
    assert(playing0 === true, `已开始播放 (实际 ${playing0})`);
    await evalJs(`document.querySelector('[data-speed-input="0.5"]').click(); "ok"`);
    await sleep(600);
    const [playing1, rate1] = await evalJs('[window.__osuStore.playing, window.__osuStore.playbackRate]');
    assert(playing1 === true && rate1 === 0.5, `播放中切 50%: 仍在播放且 rate=0.5 (实际 ${playing1}, ${rate1})`);
    // 半速下时间前进速率应约为 1x 的一半: 采样 800ms 内的推进量
    const t1 = await evalJs('window.__osuStore.currentTime');
    await sleep(800);
    const t2 = await evalJs('window.__osuStore.currentTime');
    const adv = t2 - t1;
    assert(adv > 200 && adv < 600, `半速播放推进 ~400ms/800ms (实际 ${Math.round(adv)}ms)`);
    await evalJs('window.__osuStore.pause(); "ok"');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
if (failures) { console.error(`\nVERIFIER_V59_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V59_CDP_PASSED');

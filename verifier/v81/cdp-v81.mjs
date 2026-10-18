// CDP v81 端到端: 无用按钮删除 + 保存反馈变迁
// A) 工具栏无「打开 .osu / .osz / 音频」「导出 .osu」按钮
// B) (v461 适配) Ctrl+S 后标题区不再有 [已导出] 绿字前缀 — 成功反馈 = v460 中央「地图已保存」横条
// 运行: node verifier/v81/cdp-v81.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v81-'));
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  console.log('== A) 无用按钮已删除');
  {
    const found = await evalJs(`
      [...document.querySelectorAll('button')].map(b => b.textContent)
        .filter(t => t.includes('打开 .osu') || t.includes('导出 .osu')).join('|')
    `);
    assert(found === '', `工具栏无打开/导出按钮 (实际残留: "${found}")`);
    const fileInput = await evalJs(`!!document.querySelector('input[type="file"]')`);
    assert(!fileInput, '隐藏 file input 已移除');
  }

  console.log('== B) Ctrl+S 后 (v461): 谱面信息不再变绿加前缀, 改弹中央「地图已保存」横条');
  {
    // 拦截下载 (与 v67 相同)
    await evalJs(`(() => { window.__cap = null; HTMLAnchorElement.prototype.click = function () { window.__cap = { n: this.download }; }; return 'ok'; })()`);
    const seq0 = await evalJs(`window.__osuStore.saveFlashSeq`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); "ok"`);
    await sleep(500);
    const seq1 = await evalJs(`window.__osuStore.saveFlashSeq`);
    assert(seq1 > seq0, `v460: 中央横条触发 (saveFlashSeq ${seq0} → ${seq1})`);
    const flash = await evalJs(`!!document.querySelector('[data-saved-flash]')`);
    assert(flash, 'v460: 中央「地图已保存」横条显示中');
    const old = await evalJs(`!!document.querySelector('[data-save-message]')`);
    assert(!old, 'v461: 标题区不再出现保存反馈元素 (无 [已导出] 绿字)');
    const msgNull = await evalJs(`window.__osuStore.saveMessage === null`);
    assert(msgNull, 'v461: saveMessage 保持 null (成功路径已删赋值)');
    const nameShown = await evalJs(`(() => { const bm = window.__osuStore.beatmap; return document.body.textContent.includes(bm.metadata.artist) && document.body.textContent.includes(bm.metadata.title); })()`);
    assert(nameShown, '页签栏仍显示完整谱面名称 (artist - title)');
    // 横条 1.6s 后消失
    await sleep(2400);
    const gone = await evalJs(`!document.querySelector('[data-saved-flash]')`);
    assert(gone, '横条动画结束后消失');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V81_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V81_CDP_PASSED');

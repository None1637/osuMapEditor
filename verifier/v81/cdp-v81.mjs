// CDP v81 端到端: 无用按钮删除 + 保存反馈挪右上角标题
// A) 工具栏无「打开 .osu / .osz / 音频」「导出 .osu」按钮
// B) Ctrl+S 后右上角标题出现 [已导出] 绿色前缀 + 谱面名称, data-save-message 兼容
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

  console.log('== B) Ctrl+S 后标题前缀 [已导出] 绿色 (浏览器 = 下载兜底路由)');
  {
    // 拦截下载 (与 v67 相同)
    await evalJs(`(() => { window.__cap = null; HTMLAnchorElement.prototype.click = function () { window.__cap = { n: this.download }; }; return 'ok'; })()`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); "ok"`);
    await sleep(500);
    const info = await evalJs(`(() => {
      const el = document.querySelector('[data-save-message]');
      if (!el) return null;
      return {
        text: el.textContent, green: el.className.includes('text-emerald-400'),
        wide: el.className.includes('max-w-[36rem]'),
        attr: el.getAttribute('data-save-message'),
      };
    })()`);
    assert(info !== null, '标题区出现保存反馈元素');
    if (info) {
      assert(info.text.startsWith('[已导出] '), `名称前加前缀 (实际 "${info.text.slice(0, 40)}...")`);
      assert(info.green, '前缀行整体绿色 text-emerald-400');
      assert(info.wide, '标题宽度 max-w-[36rem] (2 倍)');
      assert(info.attr && info.attr.startsWith('已导出'), `data-save-message="${info.attr}"`);
    }
    const nameShown = await evalJs(`(() => { const el = document.querySelector('[data-save-message]'); const bm = window.__osuStore.beatmap; return el.textContent.includes(bm.metadata.artist) && el.textContent.includes(bm.metadata.title); })()`);
    assert(nameShown, '反馈行仍显示完整谱面名称 (artist - title)');
    // 2.6s 后消失
    await sleep(2400);
    const gone = await evalJs(`!document.querySelector('[data-save-message]')`);
    assert(gone, '反馈 2.6s 后消失');
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

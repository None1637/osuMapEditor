// CDP v67 端到端: Ctrl+S 保存谱面 — 无来源走下载 / 服务器来源写回原文件 / 失败反馈
// 运行: node verifier/v67/cdp-v67.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9402;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v67-'));
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
const pressSave = () => evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); "ok"`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.mapSource = null;
      s.lastSave = null;
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(200);

  console.log('== A) 无来源 (演示谱面) => 下载通道, stable 命名');
  {
    await pressSave();
    await sleep(400);
    const r = await evalJs(`(() => {
      const s = window.__osuStore;
      return s.lastSave ? [s.lastSave.route, s.lastSave.fileName, s.lastSave.text.includes('osu file format v14'), s.saveMessage] : null;
    })()`);
    assert(r !== null && r[0] === 'download', `路由 = download (实际 ${JSON.stringify(r)})`);
    const expectName = await evalJs(`import('/src/osu/saveMap.ts').then(m => m.mapFileName(window.__osuStore.beatmap))`);
    assert(r[1] === expectName, `文件名 = stable 命名 (${r[1]})`);
    assert(r[2] === true, '写出内容含 v14 头部');
    assert(typeof r[3] === 'string' && r[3].startsWith('已导出'), `反馈消息 "${r[3]}"`);
    const ui = await evalJs(`!!document.querySelector('[data-save-message]')`);
    assert(ui, '工具栏显示保存反馈');
  }

  console.log('== B) 服务器来源 => 写回原文件, 含修改后的物件');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        window.__cap = null;
        s.beatmap.hitObjects = [{ id: 1, type: 'circle', x: 256, y: 192, time: 777, hitSound: 0, newCombo: false, comboOffset: 0 }];
        s.mapSource = {
          dir: {
            kind: 'directory', name: 'mock-song',
            entries: async function* () {},
            getFileHandle: async () => { throw new Error('x'); },
            writeFile: async (n, c) => { window.__cap = { n, c }; },
          },
          fileName: 'Artist - Title (mapper) [Insane].osu',
        };
        s.emit();
        return 'ok';
      })()
    `);
    await pressSave();
    await sleep(400);
    const r = await evalJs(`(() => {
      const s = window.__osuStore;
      return [s.lastSave?.route, s.lastSave?.fileName, window.__cap?.n,
        window.__cap ? window.__cap.c.includes('256,192,777,') : false,
        window.__cap ? window.__cap.c.includes('[HitObjects]') : false, s.saveMessage];
    })()`);
    assert(r[0] === 'server' && r[1] === 'Artist - Title (mapper) [Insane].osu', `路由 = server, 原文件名 (实际 ${JSON.stringify(r)})`);
    assert(r[2] === 'Artist - Title (mapper) [Insane].osu', 'writeFile 收到原文件名');
    assert(r[3] === true, '写回内容含修改后的物件 (777ms)');
    assert(r[4] === true, '写回内容含 [HitObjects]');
    assert(typeof r[5] === 'string' && r[5].startsWith('已保存'), `反馈消息 "${r[5]}"`);
  }

  console.log('== C) 写回失败 => 错误反馈, lastSave 不被覆盖');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.mapSource.dir.writeFile = async () => { throw new Error('保存失败 (500): disk full'); };
        return 'ok';
      })()
    `);
    await pressSave();
    await sleep(400);
    const r = await evalJs(`[window.__osuStore.saveMessage, window.__osuStore.lastSave?.route]`);
    assert(typeof r[0] === 'string' && r[0].startsWith('保存失败'), `错误反馈 "${r[0]}"`);
    assert(r[1] === 'server', 'lastSave 保留上次成功结果');
  }

  console.log('== D) 反馈消息自动清除');
  {
    await sleep(2400); // 已过 ~2.6s 清除点 (C 段结束起算)
    const msg = await evalJs(`window.__osuStore.saveMessage`);
    assert(msg === null, `saveMessage 已清除 (实际 ${msg})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V67_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V67_CDP_PASSED');

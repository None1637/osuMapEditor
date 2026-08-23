// CDP v58 端到端: 选区信息面板在超长 Prev/Next (如 3000.00x(600px)) 下不换行
// 运行: node verifier/v58/cdp-v58.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9393;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v58-'));
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.beatDivisor = 1; s.beatmap.editor.timelineZoom = 1;
      // 1ms 内 600px -> 期望间距 0.2px, 倍率 3000.00x: 比 999.00x(600px) 更长的极端串
      s.beatmap.hitObjects = [
        { id: 98010, type: 'circle', x: 0, y: 0, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98011, type: 'circle', x: 600, y: 0, time: 1001, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98012, type: 'circle', x: 0, y: 0, time: 1002, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.selected = new Set([98011]);
      s.seek(1001);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 极端长 Prev/Next 值渲染出来 (应力用例在场)');
  {
    const txt = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => /^Prev: |^Next: /.test(d.textContent ?? '') && d.children.length <= 1);
      return rows.map(d => d.textContent);
    })()`);
    assert(txt.some(t => /x\(600px\)/.test(t)), `Prev/Next 含 x(600px) 长值 (实际 ${JSON.stringify(txt)})`);
  }

  console.log('== B) 面板加宽且三行均不换行');
  {
    const r = await evalJs(`(() => {
      const row = [...document.querySelectorAll('div')].find(d => /^Prev: /.test(d.textContent ?? '') && d.children.length <= 1);
      if (!row) return 'no-row';
      const panel = row.parentElement;
      const rows = [...panel.children];
      return {
        panelW: panel.offsetWidth,
        rowHeights: rows.map(d => d.offsetHeight),
        overflow: panel.scrollHeight - panel.clientHeight,
      };
    })()`);
    assert(r.panelW === 160, `面板宽 160px (w-40, 实际 ${r.panelW})`);
    assert(r.rowHeights.length === 3 && r.rowHeights.every(h => h <= 21), `三行均单行 (leading-5=20px, 实际 ${JSON.stringify(r.rowHeights)})`);
    assert(r.overflow <= 1, `面板无纵向溢出 (实际 ${r.overflow})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
if (failures) { console.error(`\nVERIFIER_V58_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V58_CDP_PASSED');

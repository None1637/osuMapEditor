// CDP v70 端到端: 全页签显示上下时间轴 + timing 页签紧凑窗口四项
// 布景: red(0,500) green(1000,-100) red(1500,500) green(2000,-50), 无物件, timelineZoom=1
// A) timing 页签下上/下时间轴都在, 且 [data-tp-row] 行渲染
// B) 绿线行(序号 1)的 [data-tp-fmt] === '0:00:01.000'
// C) seek(1000) 后鼠标悬停上时间轴中心 => timelineHoverTp=绿线 & 行高亮; 移开 => 清除
// D) seek 改变 => [data-active-green] 实时跟随 (1200=>行1, 1600=>无, 2100=>行3)
// 运行: node verifier/v70/cdp-v70.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9405;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v70-'));
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
/** 上时间轴 canvas 的 client rect (宽>600 的第一个 canvas) */
const topCanvasRect = () => evalJs(`
  (() => {
    const cs = [...document.querySelectorAll('canvas')]
      .map(c => ({ c, r: c.getBoundingClientRect() }))
      .filter(x => x.r.width > 600)
      .sort((a, b) => a.r.top - b.r.top);
    if (!cs.length) return null;
    const r = cs[0].r;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()
`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        { time: 1000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
        { time: 1500, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        { time: 2000, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 40, uninherited: false, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.seek(1000);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) timing 页签: 上+下时间轴都在, 且 tp 行渲染');
  {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === 'timing').click(); "ok"`);
    await sleep(500);
    const canvases = await evalJs(`
      [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect())
        .filter(r => r.width > 300).sort((a, b) => a.top - b.top).length
    `);
    assert(canvases >= 2, `上+下时间轴 canvas 都在 (宽>300 的 canvas 数=${canvases})`);
    const rows = await evalJs(`document.querySelectorAll('[data-tp-row]').length`);
    assert(rows === 4, `4 条 timing 点行渲染 (实际 ${rows})`);
    const topRect = await topCanvasRect();
    assert(topRect !== null, '上时间轴 canvas 可见');
  }

  console.log('== B) 时分秒格式显示');
  {
    const fmt = await evalJs(`
      (() => {
        const row = document.querySelector('[data-tp-row="1"]');
        return row ? row.querySelector('[data-tp-fmt]')?.textContent : null;
      })()
    `);
    assert(fmt === '0:00:01.000', `绿线 @1000 显示 ${fmt} (期望 0:00:01.000)`);
  }

  console.log('== C) 悬停上时间轴红绿线 => 行高亮, 移开清除');
  {
    const rect = await topCanvasRect();
    // seek(1000) 后绿线 @1000 在 canvas 水平中心
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
    await sleep(300);
    const hoverTime = await evalJs(`window.__osuStore.timelineHoverTp?.time ?? null`);
    assert(hoverTime === 1000, `悬停命中绿线 @1000 (实际 ${hoverTime})`);
    const hoverRow = await evalJs(`document.querySelector('[data-hover-tp]')?.getAttribute('data-tp-row') ?? null`);
    assert(hoverRow === '1', `对应行高亮 (data-tp-row=${hoverRow})`);
    // 移到无线位置: 窗 [-2000,4000] (宽 6000ms), 取 0.75 => 2500, 距 2000 线 500ms >> 4px
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.left + rect.width * 0.75, y: cy });
    await sleep(300);
    const cleared = await evalJs(`window.__osuStore.timelineHoverTp === null`);
    assert(cleared, '移开后悬停清除');
    const noHoverRow = await evalJs(`document.querySelector('[data-hover-tp]') === null`);
    assert(noHoverRow, '移开后无高亮行');
  }

  console.log('== D) 当前时间生效绿线实时高亮');
  {
    await evalJs(`window.__osuStore.seek(1200); "ok"`);
    await sleep(300);
    let row = await evalJs(`document.querySelector('[data-active-green]')?.getAttribute('data-tp-row') ?? null`);
    assert(row === '1', `t=1200 生效绿线行=1 (实际 ${row})`);
    await evalJs(`window.__osuStore.seek(1600); "ok"`);
    await sleep(300);
    row = await evalJs(`document.querySelector('[data-active-green]')?.getAttribute('data-tp-row') ?? null`);
    assert(row === null, `t=1600 红线后无生效绿线 (实际 ${row})`);
    await evalJs(`window.__osuStore.seek(2100); "ok"`);
    await sleep(300);
    row = await evalJs(`document.querySelector('[data-active-green]')?.getAttribute('data-tp-row') ?? null`);
    assert(row === '3', `t=2100 生效绿线行=3 (实际 ${row})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V70_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V70_CDP_PASSED');

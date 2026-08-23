// CDP v65 端到端: 批量复制 — 弹窗/预览/参数实时更新/旋转锚点三模式/应用一次 undo
// 运行: node verifier/v65/cdp-v65.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9400;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v65-'));
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
async function setNum(testid, val) {
  await evalJs(`(() => {
    const inp = document.querySelector('[data-conv=${testid}]');
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '${val}');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    return 'ok';
  })()`);
  await sleep(250);
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 90001, type: 'circle', x: 100, y: 100, time: 1000, comboSkip: 0, hitSound: 0 },
        { id: 90002, type: 'circle', x: 150, y: 100, time: 1500, comboSkip: 0, hitSound: 2 },
      ];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4;
      s.seek(1000);
      s.selected = new Set([90001, 90002]);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) Inspector 按钮开弹窗 + 默认预览 (2 源 × 2 次)');
  {
    await evalJs(`document.querySelector('[data-conv-open=duplicate]').click(); "ok"`);
    await sleep(400);
    assert(await evalJs(`window.__osuStore.conversionDialog`) === 'duplicate', '弹窗打开');
    const prev = await evalJs(`(() => {
      const p = window.__osuStore.conversionPreview;
      return p ? [p.hideIds.length, p.objects.length] : null;
    })()`);
    assert(prev !== null && prev[0] === 0 && prev[1] === 4, `预览 4 副本, 原物件不隐藏 (实际 ${JSON.stringify(prev)})`);
    const t = await evalJs(`window.__osuStore.conversionPreview.objects.map(o => o.time).sort((a,b)=>a-b)`);
    assert(JSON.stringify(t) === '[1500,2000,2000,2500]', `时间 +1/+2 拍 (实际 ${JSON.stringify(t)})`);
  }

  console.log('== B) 参数实时更新: 次数 3 + 间隔 1.5 拍');
  {
    await setNum('count', '3');
    await setNum('intervalBeats', '1.5');
    const n = await evalJs(`window.__osuStore.conversionPreview?.objects.length`);
    assert(n === 6, `预览 2×3=6 (实际 ${n})`);
    const t = await evalJs(`window.__osuStore.conversionPreview.objects.map(o => o.time).sort((a,b)=>a-b)`);
    assert(t[0] === 1750 && t[5] === 3750, `间隔 1.5 拍 = 750ms (实际 ${JSON.stringify(t)})`);
  }

  console.log('== C) 旋转锚点: 游玩区中心 90°');
  {
    await setNum('count', '1');
    await setNum('intervalBeats', '1');
    await evalJs(`document.querySelector('[data-conv=origin-playfield]').click(); "ok"`);
    await sleep(250);
    await setNum('rotateDeg', '90');
    const pts = await evalJs(`window.__osuStore.conversionPreview.objects.map(o => [o.x, o.y]).sort((a,b)=>a[0]-b[0])`);
    // (100,100)/(150,100) 绕 (256,192) 顺时针 90° => (348,36)/(348,86)
    assert(JSON.stringify(pts) === '[[348,36],[348,86]]', `游玩区锚点旋转 (实际 ${JSON.stringify(pts)})`);
  }

  console.log('== D) 自定义锚点输入 + 平移向量');
  {
    await evalJs(`document.querySelector('[data-conv=origin-custom]').click(); "ok"`);
    await sleep(250);
    await setNum('originX', '100');
    await setNum('originY', '100');
    await setNum('rotateDeg', '0');
    await setNum('dx', '10');
    await setNum('dy', '20');
    const pts = await evalJs(`window.__osuStore.conversionPreview.objects.map(o => [o.x, o.y]).sort((a,b)=>a[0]-b[0])`);
    assert(JSON.stringify(pts) === '[[110,120],[160,120]]', `平移向量 (实际 ${JSON.stringify(pts)})`);
    assert(await evalJs(`window.__osuStore.originMode`) === 'custom', '锚点模式与普通旋转共用 store.originMode');
  }

  console.log('== E) 应用 (原物件保留, 一次 undo)');
  {
    await setNum('count', '2');
    await setNum('dx', '0');
    await setNum('dy', '0');
    await evalJs(`document.querySelector('[data-conv=apply]').click(); "ok"`);
    await sleep(300);
    const res = await evalJs(`(() => {
      const s = window.__osuStore;
      return [s.beatmap.hitObjects.length, s.conversionDialog, s.selected.size,
        s.beatmap.hitObjects.some(o => o.id === 90001), s.beatmap.hitObjects.find(o => o.time === 2000 && o.hitSound === 2) !== undefined];
    })()`);
    assert(res[0] === 6 && res[1] === null && res[2] === 4, `应用: 2 源 + 4 副本, 选中副本 (实际 ${JSON.stringify(res)})`);
    assert(res[3] === true, '原物件保留');
    assert(res[4] === true, '副本继承 hitSound (whistle)');
    await evalJs(`window.__osuStore.undo(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 2, '一次 undo 撤销全部副本');
  }

  console.log('== F) 取消不生成');
  {
    // E 的 undo 后选区为失效副本 id, 需重选源物件否则按钮禁用
    await evalJs(`(() => { const s = window.__osuStore; s.selected = new Set([90001, 90002]); s.emit(); })(); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-conv-open=duplicate]').click(); "ok"`);
    await sleep(300);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取消').click(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.beatmap.hitObjects.length`) === 2
      && await evalJs(`window.__osuStore.conversionPreview === null`), '取消: 无副本, 预览清空');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V65_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V65_CDP_PASSED');

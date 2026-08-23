// CDP v63 端到端: 上时间轴 +红/+绿 插入按钮 + 双击 BPM/SV 胶囊开全参数编辑弹窗
// 运行: node verifier/v63/cdp-v63.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9398;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v63-'));
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
async function clickAt(x, y, count) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
}
// 上时间轴胶囊中心 client 坐标 (rowY: BPM=69.5, SV=83)
async function pillPos(ms, rowY) {
  return evalJs(`(() => {
    const c = document.querySelector('canvas[class*="h-[92px]"]');
    const r = c.getBoundingClientRect();
    const s = window.__osuStore;
    const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
    const t0 = s.currentTime - win / 2;
    return [r.left + ((${ms} - t0) / win) * r.width, r.top + ${rowY}];
  })()`);
}
// 双击: 第一次点击会 seek 使胶囊移到画布中心, 故第二次按新位置点击
async function dblClickPill(ms, rowY) {
  let [x, y] = await pillPos(ms, rowY);
  await clickAt(x, y, 1);
  await sleep(250);
  [x, y] = await pillPos(ms, rowY);
  await clickAt(x, y, 2);
  await sleep(350);
}
async function setNum(testid, val) {
  await evalJs(`(() => {
    const inp = document.querySelector('[data-conv=${testid}]');
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '${val}');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(200);
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
        { time: 0, beatLength: 500, meter: 4, sampleSet: 2, sampleIndex: 1, volume: 55, uninherited: true, effects: 0 },
        { time: 1000, beatLength: -200, meter: 4, sampleSet: 3, sampleIndex: 2, volume: 45, uninherited: false, effects: 1 },
      ];
      s.beatmap.editor.timelineZoom = 1;
      s.seek(2500);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) +绿 按钮: 弹窗草稿克隆生效绿线, 改 SV 后插入');
  {
    await evalJs(`document.querySelector('[data-tp-add=green]').click(); "ok"`);
    await sleep(300);
    const draft = await evalJs(`(() => {
      const d = window.__osuStore.timingPointDialog;
      return d ? [d.mode, d.draft.time, d.draft.beatLength, d.draft.sampleSet, d.draft.sampleIndex, d.draft.volume, d.draft.effects] : null;
    })()`);
    assert(draft !== null && await evalJs(`!!document.querySelector('[data-tpdlg=ok]')`), '弹窗打开 (add 模式)');
    assert(draft[0] === 'add' && draft[1] === 2500 && draft[2] === -200 && draft[3] === 3 && draft[4] === 2 && draft[5] === 45 && draft[6] === 1,
      `草稿克隆绿线 SV0.5/Drum/idx2/vol45/kiai (实际 ${JSON.stringify(draft)})`);
    assert(await evalJs(`!document.querySelector('[data-tpdlg=delete]')`), 'add 模式无删除按钮');
    await setNum('bpmOrSv', '0.75');
    await evalJs(`document.querySelector('[data-tpdlg=ok]').click(); "ok"`);
    await sleep(300);
    const g = await evalJs(`(() => {
      const tp = window.__osuStore.beatmap.timingPoints.find(p => !p.uninherited && p.time === 2500);
      return tp ? [tp.beatLength, tp.sampleSet, tp.volume] : null;
    })()`);
    assert(g !== null && Math.abs(g[0] - (-100 / 0.75)) < 0.01 && g[1] === 3 && g[2] === 45,
      `插入绿线@2500 SV=0.75 (实际 ${JSON.stringify(g)})`);
  }

  console.log('== B) 双击 SV 胶囊: edit 弹窗, 改音量应用');
  {
    await dblClickPill(1000, 83);
    const d = await evalJs(`(() => {
      const d = window.__osuStore.timingPointDialog;
      return d ? [d.mode, d.index, d.draft.time, d.draft.uninherited] : null;
    })()`);
    assert(d !== null && d[0] === 'edit' && d[1] === 1 && d[2] === 1000 && d[3] === false,
      `edit 弹窗指向绿线@1000 (实际 ${JSON.stringify(d)})`);
    await setNum('volume', '60');
    await evalJs(`document.querySelector('[data-tpdlg=ok]').click(); "ok"`);
    await sleep(300);
    const v = await evalJs(`window.__osuStore.beatmap.timingPoints[1].volume`);
    assert(v === 60, `绿线@1000 音量改 60 (实际 ${v})`);
  }

  console.log('== C) 双击 BPM 胶囊: 红线弹窗有省略小节线, 取消不变');
  {
    await dblClickPill(0, 69.5);
    const info = await evalJs(`(() => {
      const d = window.__osuStore.timingPointDialog;
      return [d?.mode, d?.draft?.uninherited, !!document.querySelector('[data-tpdlg=omitBar]')];
    })()`);
    assert(info[0] === 'edit' && info[1] === true && info[2] === true,
      `红线 edit 弹窗 + omitBar 可见 (实际 ${JSON.stringify(info)})`);
    const before = await evalJs(`JSON.stringify(window.__osuStore.beatmap.timingPoints)`);
    await evalJs(`document.querySelector('[data-tpdlg=cancel]').click(); "ok"`);
    await sleep(300);
    const after = await evalJs(`JSON.stringify(window.__osuStore.beatmap.timingPoints)`);
    assert(before === after && await evalJs(`window.__osuStore.timingPointDialog === null`), '取消: 数据不变弹窗关闭');
  }

  console.log('== D) edit 弹窗删除按钮');
  {
    await dblClickPill(2500, 83);
    const n0 = await evalJs(`window.__osuStore.beatmap.timingPoints.length`);
    await evalJs(`document.querySelector('[data-tpdlg=delete]').click(); "ok"`);
    await sleep(300);
    const left = await evalJs(`(() => {
      const pts = window.__osuStore.beatmap.timingPoints;
      return [pts.length, pts.some(p => !p.uninherited && p.time === 2500)];
    })()`);
    assert(n0 === 3 && left[0] === 2 && left[1] === false, `删除绿线@2500 (实际 ${JSON.stringify(left)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V63_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V63_CDP_PASSED');

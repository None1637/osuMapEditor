// CDP v69 端到端: 批量复制"复制绿线"切换 => 上时间轴预览滑条长度变化 (黄描边跨度实测)
// 布景: 源滑条 @1000 在 0.5x SV 区 (时长 714ms), 副本落 2000 (红线 1500 后 SV 1, 时长 357ms)
// 不复制绿线 => 预览条短 (357ms); 复制绿线 => 副本自带 0.5x => 预览条长 (714ms)
// 运行: node verifier/v69/cdp-v69.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9404;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v69-'));
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
/** 上时间轴 canvas 中黄色 (#ffcc22 选中/预览描边) 像素的最大 x (device px) */
const maxYellowX = () => evalJs(`
  (() => {
    const cs = [...document.querySelectorAll('canvas')]
      .map(c => ({ c, r: c.getBoundingClientRect() }))
      .filter(x => x.r.width > 600)
      .sort((a, b) => a.r.top - b.r.top);
    if (!cs.length) return null;
    const c = cs[0].c;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let maxX = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 230 && d[i + 1] > 170 && d[i + 1] < 230 && d[i + 2] < 80 && d[i + 3] > 200) {
          if (x > maxX) maxX = x;
        }
      }
    }
    return [maxX, c.width];
  })()
`);

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
        { time: 1000, beatLength: -200, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
        { time: 1500, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 200, y: 200, time: 1000, hitSound: 0, newCombo: false, comboOffset: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 100 },
      ];
      s.beatmap.editor.timelineZoom = 1;
      s.tool = 'select';
      s.seek(1500); // win 6000: 源 (1000) 与副本 (2000) 都在窗内
      s.selected = new Set([1]);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== 复制绿线切换 => 预览滑条黄条跨度变化 (357ms vs 714ms)');
  {
    await evalJs(`window.__osuStore.openConversion('duplicate'); "ok"`);
    await sleep(400);
    // 间隔 2 拍 => 副本落 2000 (过了 1500 红线, SV 回到 1)
    const setR = await evalJs(`
      (() => {
        const el = document.querySelector('[data-conv="intervalBeats"]');
        if (!el) return 'missing';
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        return 'ok';
      })()
    `);
    assert(setR === 'ok', '间隔设 2 拍');
    await sleep(400);
    const off = await maxYellowX();
    assert(off !== null && off[0] > 0, `关: 黄条最大 x=${off?.[0]}`);
    await evalJs(`document.querySelector('[data-conv="copyGreenLines"]').click(); "ok"`);
    await sleep(400);
    const on = await maxYellowX();
    assert(on !== null && on[0] > off[0], `开: 黄条更长 (maxX ${off?.[0]} -> ${on?.[0]})`);
    // 期望差 = (714-357)ms / 6000ms * canvas 宽 (device px), 容差 ±30%
    const expected = (200 / 0.28 - 100 / 0.28) / 6000 * off[1];
    const diff = on[0] - off[0];
    assert(diff > expected * 0.7 && diff < expected * 1.3,
      `跨度差 ≈ 357ms (${expected.toFixed(0)}px) (实际 ${diff}px, 宽 ${off[1]})`);
    // 预览绿线也在 (副本自带 SV)
    const tp = await evalJs(`(window.__osuStore.conversionPreview?.timingPoints ?? []).map(t => t.time)`);
    assert(JSON.stringify(tp) === JSON.stringify([2000, 3000]), `预览绿线 @2000/3000 (默认 2 份) (实际 ${JSON.stringify(tp)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V69_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V69_CDP_PASSED');

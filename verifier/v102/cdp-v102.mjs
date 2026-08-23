// CDP v102 端到端: 上方时间轴增强
//   T1 下半部分起手框选物件   T2 框选绿线 (黄描边选区)   T3 单击绿线选中 (时间不变)
//   T4 拖动绿线改时间 (吸附节拍)   T5 绿线复制粘贴 (含同时刻覆盖)   T6 边缘自动滚动累积选中
// 运行: node verifier/v102/cdp-v102.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9422;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v102-'));
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
  await sleep(400);

  // 布景: 红线 500ms/拍; 绿线 2000(-100=1.0x) / 4000(-50=2.0x); 物件 1000..3000 + 远端 13000/14000
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        { time: 2000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
        { time: 4000, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
      ];
      s.beatmap.hitObjects = [1000, 1500, 2000, 2500, 3000, 13000, 14000].map((t, i) => ({
        id: i + 1, type: 'circle', x: 100 + i * 10, y: 200, time: t, hitSound: 0, newCombo: i === 0, comboSkip: 0,
      }));
      s.beatmap.editor.beatDivisor = 4;
      s.beatmap.editor.timelineZoom = 1;
      s.selected.clear(); s.selectedGreenLines.clear();
      s.seek(2000);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  // 页内事件助手: c = 上方时间轴 canvas, md/mm/wmm/up
  await evalJs(`
    window.__t102 = (() => {
      const c = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
      const r = () => c.getBoundingClientRect();
      return {
        W: () => r().width,
        md: (x, y, extra = {}) => c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r().left + x, clientY: r().top + y, ...extra })),
        mm: (x, y) => c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r().left + x, clientY: r().top + y })),
        wmm: (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: r().left + x, clientY: r().top + y })),
        up: () => window.dispatchEvent(new MouseEvent('mouseup', {})),
        tx: (ms) => { const s = window.__osuStore; const win = 6000 / (s.beatmap.editor.timelineZoom || 1); return ((ms - (s.currentTime - win / 2)) / win) * r().width; },
      };
    })();
    'ok'
  `);

  // T1: 下半部分 (y=80) 起手框选, 拖到覆盖物件行 -> 选中时间区间内物件
  await evalJs(`__t102.md(300, 80); __t102.mm(500, 20); 'ok'`);
  await sleep(200);
  let r1 = await evalJs(`JSON.stringify([...window.__osuStore.selected].sort((a, b) => a - b))`);
  await evalJs(`__t102.up(); 'ok'`);
  await sleep(100);
  // 期望: t(300px)..t(500px) 区间内物件 (页内按实际宽度算)
  const exp1 = await evalJs(`
    JSON.stringify((() => {
      const s = window.__osuStore; const W = __t102.W(); const win = 6000;
      const ms = (px) => s.currentTime - win / 2 + (px / W) * win;
      const a = ms(300), b = ms(500);
      return s.beatmap.hitObjects.filter(o => o.time >= Math.min(a, b) && o.time <= Math.max(a, b)).map(o => o.id);
    })())
  `);
  console.log(`  T1 选中=${r1} 期望=${exp1}`);
  assert(r1 === exp1 && JSON.parse(r1).length > 0, 'T1 下半部分起手框选生效, 选中区间物件');

  // T2: 框选绿线药丸带 (y 70..92, 不碰物件行), 覆盖绿线 2000/4000
  await evalJs(`
    __t102.md(__t102.tx(1900), 70);
    __t102.mm(__t102.tx(4100), 91);
    'ok'
  `);
  await sleep(200);
  const r2 = await evalJs(`JSON.stringify({
    greens: [...window.__osuStore.selectedGreenLines].sort((a, b) => a - b),
    objs: [...window.__osuStore.selected],
  })`);
  await evalJs(`__t102.up(); 'ok'`);
  await sleep(100);
  const p2 = JSON.parse(r2);
  console.log('  T2 绿线选区:', r2);
  assert(JSON.stringify(p2.greens) === '[2000,4000]', `T2 框选命中两条绿线 (实际 ${JSON.stringify(p2.greens)})`);
  assert(p2.objs.length === 0, 'T2 纵跨不及物件行时不选物件');

  // T3: 清空选区后单击绿线药丸 -> 只选中该绿线, 时间不变
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.selectedGreenLines.clear(); s.emitSelection();
      const x = __t102.tx(2000); __t102.md(x, 83); __t102.up();
    })();
    'ok'
  `);
  await sleep(150);
  const r3 = await evalJs(`JSON.stringify({
    greens: [...window.__osuStore.selectedGreenLines],
    time: window.__osuStore.beatmap.timingPoints.find(tp => !tp.uninherited && tp.beatLength === -100)?.time ?? null,
  })`);
  const p3 = JSON.parse(r3);
  console.log('  T3 单击后:', r3);
  assert(JSON.stringify(p3.greens) === '[2000]', `T3 单击选中绿线 2000 (实际 ${JSON.stringify(p3.greens)})`);
  assert(p3.time === 2000, `T3 单击不改变绿线时间 (实际 ${p3.time})`);

  // T4: 按住拖动绿线 ~300ms 距离 -> 吸附 1/4 (125ms) => 2250
  await evalJs(`
    (() => {
      const s = window.__osuStore; const W = __t102.W(); const win = 6000;
      const x0 = __t102.tx(2000);
      const dx = (300 / win) * W;
      __t102.md(x0, 83);
      __t102.mm(x0 + dx / 2, 83);
      __t102.mm(x0 + dx, 83);
    })();
    'ok'
  `);
  await sleep(150);
  await evalJs(`__t102.up(); 'ok'`);
  await sleep(150);
  const r4 = await evalJs(`JSON.stringify({
    times: window.__osuStore.beatmap.timingPoints.filter(tp => !tp.uninherited).map(tp => tp.time).sort((a, b) => a - b),
    greens: [...window.__osuStore.selectedGreenLines],
  })`);
  const p4 = JSON.parse(r4);
  console.log('  T4 拖动后:', r4);
  assert(JSON.stringify(p4.times) === '[2250,4000]', `T4 绿线拖动吸附 1/4 => 2250 (实际 ${JSON.stringify(p4.times)})`);
  assert(JSON.stringify(p4.greens) === '[2250]', `T4 拖动后绿线仍选中 (新键 2250, 实际 ${JSON.stringify(p4.greens)})`);

  // T5: 绿线复制粘贴 (相对时序: 唯一选中绿线 2250 为原点, paste(6000) => 6000; 同时刻再粘覆盖不叠加)
  const r5 = await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.copy();
      s.paste(6000);
      const at6000 = s.beatmap.timingPoints.filter(tp => !tp.uninherited && Math.round(tp.time) === 6000);
      const first = { n: at6000.length, bl: at6000[0]?.beatLength ?? null, sel: [...s.selectedGreenLines] };
      s.paste(6000); // 再粘一次 => 覆盖同一目标时刻, 不重复
      const again = s.beatmap.timingPoints.filter(tp => !tp.uninherited && Math.round(tp.time) === 6000).length;
      return JSON.stringify({ ...first, again });
    })()
  `);
  const p5 = JSON.parse(r5);
  console.log('  T5 粘贴:', r5);
  assert(p5.n === 1 && p5.bl === -100, `T5 绿线粘贴到 6000 且参数保留 (实际 n=${p5.n} bl=${p5.bl})`);
  assert(JSON.stringify(p5.sel) === '[6000]', `T5 粘贴后新绿线选中 (实际 ${JSON.stringify(p5.sel)})`);
  assert(p5.again === 1, `T5 同时刻重复粘贴覆盖不叠加 (实际 ${p5.again} 条)`);

  // T6: 边缘自动滚动 — seek(10000), 物件行起手 (950px), 指针推出右边界 (W+40), 等待滚动累积远端物件
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.selected.clear(); s.selectedGreenLines.clear();
      s.seek(10000); s.emit();
      __t102.md(950, 30);
      __t102.wmm(__t102.W() + 40, 30);
    })();
    'ok'
  `);
  await sleep(1500);
  const r6 = await evalJs(`JSON.stringify({
    time: Math.round(window.__osuStore.currentTime),
    sel: [...window.__osuStore.selected].sort((a, b) => a - b),
  })`);
  await evalJs(`__t102.up(); 'ok'`);
  const p6 = JSON.parse(r6);
  console.log('  T6 滚动后:', r6);
  assert(p6.time > 11000, `T6 边缘滚动推进当前时间 (10000 -> ${p6.time})`);
  assert(p6.sel.includes(6), `T6 跨滚动累积选中初始视窗外的物件 13000 (选中 ${JSON.stringify(p6.sel)})`);
  assert(p6.sel.includes(7), `T6 继续滚动累积选中 14000 (选中 ${JSON.stringify(p6.sel)})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V102_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V102_CDP_PASSED');

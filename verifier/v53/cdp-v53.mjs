// CDP v53 端到端: 上方时间轴药丸 (lazer 红 BPM / 绿 SV / 粉采样)
// 布景: 红@1000 (500ms -> 120.0 BPM, soft, vol30) + 绿@2000 (-200 -> 0.50x) + 绿@2500 (纯音量, 无药丸)
//   物件: 单点@1500 ("S 30") / 单点@3500 / 滑条@4000 (Pink2) / 单点@5000+@5100 (过密 -> 第二个收缩为点)
// 运行: node verifier/v53/cdp-v53.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9387;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v53-'));
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 1000, beatLength: 500, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 30, uninherited: true, effects: 0 },
        { time: 2000, beatLength: -200, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 30, uninherited: false, effects: 0 },
        { time: 2500, beatLength: -200, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
      ];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.timelineZoom = 1;
      s.beatmap.hitObjects = [
        { id: 98801, type: 'circle', x: 100, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98802, type: 'circle', x: 200, y: 100, time: 3500, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98803, type: 'slider', x: 100, y: 200, time: 4000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 200, y: 200 }], length: 100, slides: 1 },
        { id: 98804, type: 'circle', x: 300, y: 100, time: 5000, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 98805, type: 'circle', x: 400, y: 100, time: 5100, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.seek(3000);
      s.clearSelection();
      s.emit();
      // 时间轴横向扫描: 统计 [ms+dx0, ms+dx1] x y 行上匹配指定颜色的像素数 (抗文字字形干扰)
      const PREDS = {
        lime: (r, g, b) => g > 220 && r > 120 && b < 160,
        red: (r, g, b) => r > 180 && g < 120 && b < 120,
        pink1: (r, g, b) => r > 230 && g > 70 && g < 140 && b > 140,
        pink2: (r, g, b) => r > 180 && r < 245 && g < 100 && b > 110 && b < 170,
      };
      window.__tlCount = (ms, y, dx0, dx1, kind) => {
        const c = [...document.querySelectorAll('canvas')].find(x => x.className.includes('h-[92px]'));
        const r = c.getBoundingClientRect();
        const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
        const t0 = s.currentTime - win / 2;
        const sx = ((ms - t0) / win) * r.width;
        const kx = c.width / r.width, ky = c.height / r.height;
        const d = c.getContext('2d').getImageData(Math.round((sx + dx0) * kx), Math.round(y * ky), Math.max(1, Math.round((dx1 - dx0) * kx)), 1).data;
        const pred = PREDS[kind];
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (pred(d[i], d[i + 1], d[i + 2])) n++;
        return n;
      };
      return 'ok';
    })()
  `);
  await sleep(600);

  console.log('== A) 红线 -> BPM 红药丸 (lazer TimingPointPiece)');
  {
    const n = await evalJs('window.__tlCount(1000, 70, -28, 28, "red")');
    assert(n > 5, `红@1000 y=70 横向红色像素 ${n} > 5 (120.0 BPM 药丸)`);
  }

  console.log('== B) 变速绿线 -> SV 绿药丸; v61 起 SV 重申/纯音量绿线也出药丸 (lazer 无去重)');
  {
    const n = await evalJs('window.__tlCount(2000, 83, -15, 15, "lime")');
    assert(n > 5, `绿@2000 y=83 横向绿药丸像素 ${n} > 5 (0.50x)`);
    const n2 = await evalJs('window.__tlCount(2500, 83, -15, 15, "lime")');
    assert(n2 > 5, `绿@2500 (纯音量, SV 重申) v61 起也出药丸 (${n2} > 5)`);
  }

  console.log('== C) 物件粉药丸: 单点 Pink1 / 滑条 Pink2');
  {
    const n1 = await evalJs('window.__tlCount(1500, 57, -18, 18, "pink1")');
    assert(n1 > 5, `单点@1500 Pink1 药丸 (${n1}) — "S 30"`);
    const n2 = await evalJs('window.__tlCount(4000, 57, -18, 18, "pink2")');
    assert(n2 > 5, `滑条@4000 Pink2 药丸 (${n2})`);
  }

  console.log('== D) 过密收缩: 100ms 间距的第二个物件不出完整药丸 (lazer SamplePointContracted)');
  {
    const full = await evalJs('window.__tlCount(5000, 57, 8, 16, "pink1")');
    assert(full > 3, `单点@5000 完整药丸右半 (${full})`);
    const dot = await evalJs('window.__tlCount(5100, 57, 8, 16, "pink1")');
    assert(dot === 0, `单点@5100 收缩为点 (右半无药丸像素, ${dot})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V53_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V53_CDP_PASSED');

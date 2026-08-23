// CDP v61 端到端: 未变速绿线也出 SV 药丸 + 红绿线竖线化 (三角旗移除)
// 运行: node verifier/v61/cdp-v61.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9396;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v61-'));
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
      s.beatmap.timingPoints = [
        { time: 1000, beatLength: 500, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 30, uninherited: true, effects: 0 },
        { time: 2000, beatLength: -200, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 30, uninherited: false, effects: 0 },
        { time: 3000, beatLength: -200, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
        { time: 4000, beatLength: -200, meter: 4, sampleSet: 3, sampleIndex: 0, volume: 30, uninherited: false, effects: 0 },
      ];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.editor.timelineZoom = 1;
      s.beatmap.hitObjects = [];
      s.seek(2500);
      s.clearSelection();
      s.emit();
      // 时间轴横向扫描 (与 v53 同款): [ms+dx0, ms+dx1] x y 行匹配色像素数
      const PREDS = {
        lime: (r, g, b) => g > 220 && r > 120 && b < 160,          // 绿药丸 #b2ff66
        limeLine: (r, g, b) => g > 95 && g > r && r > 55 && b < 90, // 绿竖线 rgba(178,255,102,0.45) on #0c0c11
        redLine: (r, g, b) => r > 110 && r > g * 2 && g < 100 && b < 100, // 红竖线 rgba(235,71,71,0.55)
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

  console.log('== A) 未变速绿线也出 SV 药丸 (lazer: 无与上一条比较)');
  {
    const n1 = await evalJs('window.__tlCount(2000, 83, -15, 15, "lime")');
    assert(n1 > 5, `绿@2000 (1->0.5) 出药丸 (${n1})`);
    const n2 = await evalJs('window.__tlCount(3000, 83, -15, 15, "lime")');
    assert(n2 > 5, `绿@3000 (SV 重申+纯音量) 也出药丸 (${n2})`);
    const n3 = await evalJs('window.__tlCount(4000, 83, -15, 15, "lime")');
    assert(n3 > 5, `绿@4000 (纯采样集变化) 也出药丸 (${n3})`);
  }

  console.log('== B) 红绿线是竖线 (全高), 不再是三角旗');
  {
    // 物件行为空 (无物件), y=30 在物件行区域: 旧版此处无红绿标记 (只有 0.18 淡线), 新版 0.55/0.45 竖线可辨
    const rl = await evalJs('window.__tlCount(1000, 30, -1, 1, "redLine")');
    assert(rl > 0, `红@1000 y=30 有红色竖线 (${rl})`);
    const gl = await evalJs('window.__tlCount(2000, 30, -1, 1, "limeLine")');
    assert(gl > 0, `绿@2000 y=30 有绿色竖线 (${gl})`);
    // 旧三角旗位置 (绿旗 fy=72..80, 顶部宽 ±5): y=74 dx=3..5 旧版有绿三角像素, 新版竖线仅 ±1 -> 无
    const tri = await evalJs('window.__tlCount(2000, 74, 3, 5, "limeLine")');
    assert(tri === 0, `绿@2000 y=74 dx3..5 无三角旗残留 (${tri})`);
    // 无 timing 点处无竖线
    const none = await evalJs('window.__tlCount(2500, 30, -1, 1, "redLine")');
    const none2 = await evalJs('window.__tlCount(2500, 30, -1, 1, "limeLine")');
    assert(none === 0 && none2 === 0, `无点处 y=30 无竖线 (${none},${none2})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V61_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V61_CDP_PASSED');

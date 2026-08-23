// CDP v35 端到端: 控制点命中优先级/渲染次序 + 时间轴拖滑条尾改折返次数
//   A1) 命中最近优先: 鼠标 (309,200) 距 idx2(308,200)=1 / 距 idx1(300,200)=9 (都<=10) -> 拖动 idx2, idx1 不动
//   A2) 距离相同取序号在前: 红对 (300,300)/(300,300) 正上方按下 -> 抓 idx1, 红对成对移动
//   A3) 渲染次序: 红对 idx2(600,100 红) 与 idx3(603,100 白) 重叠 -> 序号在前的红色在更上层 (探针得红色)
//   B) 时间轴拖滑条尾: 拉长 -> slides 1->3, 拉短 -> 3->1 (clamp), undo 还原, 单击尾端不改 slides + seek 到尾
// 运行: node verifier/v35/cdp-v35.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9361;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v35-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      const bm = s.beatmap;
      bm.editor.timelineZoom = 1;
      bm.hitObjects = [
        { id: 96010, type: 'slider', x: 200, y: 200, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 200 }, { x: 308, y: 200 }], slides: 1, length: 200 },
        { id: 96011, type: 'slider', x: 200, y: 300, time: 2200, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'B', curvePoints: [{ x: 300, y: 300 }, { x: 300, y: 300 }], slides: 1, length: 200 },
        { id: 96012, type: 'slider', x: 300, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'B', curvePoints: [{ x: 400, y: 100 }, { x: 400, y: 100 }, { x: 403, y: 100 }], slides: 1, length: 200 },
        { id: 96013, type: 'slider', x: 100, y: 100, time: 3000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 200 },
      ];
      s.select([]);
      s.seek(1500);
      // 游玩区事件 (osu 坐标 -> 客户端坐标, React 合成事件)
      window.__pf = () => document.querySelector('canvas.cursor-crosshair');
      window.__pev = (type, ox, oy, buttons) => {
        const p = window.__osuToClient(ox, oy);
        window.__pf().dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: buttons ?? 0, clientX: p.x, clientY: p.y,
        }));
      };
      window.__cps = (id) => JSON.stringify(window.__osuStore.beatmap.hitObjects.find(o => o.id === id).curvePoints.map(p => [p.x, p.y]));
      window.__slides = (id) => window.__osuStore.beatmap.hitObjects.find(o => o.id === id).slides ?? 1;
      // 滑条单次折返时长 (与 objEnd/sliderVelocityAt 同公式, 含绿线 SV)
      window.__dur = (id) => {
        const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === id);
        const bm2 = window.__osuStore.beatmap;
        const red = [...bm2.timingPoints].reverse().find(t => t.uninherited && t.time <= o.time) ?? bm2.timingPoints[0];
        const green = [...bm2.timingPoints].reverse().find(t => !t.uninherited && t.time <= o.time);
        let sv = 1;
        if (green && green.beatLength < 0) sv = -100 / green.beatLength;
        const vel = (100 * bm2.difficulty.sliderMultiplier * sv) / red.beatLength;
        return o.length / vel;
      };
      // 时间轴事件 (ms -> 客户端 x)
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      window.__tev = (type, ms, buttons) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        const t0 = window.__osuStore.currentTime - 3000;
        c.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: buttons ?? 0,
          clientX: r.left + ((ms - t0) / 6000) * r.width, clientY: r.top + 30,
        }));
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A1) 命中最近优先 ----
  console.log('== A1) 多个控制点: 拖动最近者');
  await evalJs(`window.__osuStore.select([96010]); 'ok'`);
  await sleep(200);
  await evalJs(`window.__pev('mousedown', 309, 200, 1); 'ok'`);
  await evalJs(`window.__pev('mousemove', 320, 210, 1); 'ok'`); // 越过 4px 拖拽阈值
  await evalJs(`window.__pev('mousemove', 360, 260, 1); 'ok'`);
  await evalJs(`window.__pev('mouseup', 360, 260, 0); 'ok'`);
  await sleep(200);
  let cps = JSON.parse(await evalJs('window.__cps(96010)'));
  assert(cps[0][0] === 300 && cps[0][1] === 200, `idx1 (较近的另一候选) 未被动 (${cps[0]})`);
  assert(cps[1][0] === 360 && cps[1][1] === 260, `idx2 (最近者) 被拖动 -> (${cps[1]}) 期望 (360,260)`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  // ---- A2) 距离相同取序号在前 (红对成对移动) ----
  console.log('== A2) 距离相同: 抓序号在前者, 红对成对移动');
  await evalJs(`window.__osuStore.select([96011]); 'ok'`);
  await sleep(200);
  await evalJs(`window.__pev('mousedown', 300, 300, 1); 'ok'`);
  await evalJs(`window.__pev('mousemove', 310, 310, 1); 'ok'`);
  await evalJs(`window.__pev('mousemove', 340, 340, 1); 'ok'`);
  await evalJs(`window.__pev('mouseup', 340, 340, 0); 'ok'`);
  await sleep(200);
  cps = JSON.parse(await evalJs('window.__cps(96011)'));
  assert(cps.length === 2 && cps[0][0] === 340 && cps[0][1] === 340 && cps[1][0] === 340 && cps[1][1] === 340,
    `红对成对移动且未拆散 (${JSON.stringify(cps)})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  // ---- A3) 渲染次序: 序号在前的红色在更上层 ----
  console.log('== A3) 渲染次序: 红对 (idx2) 在 idx3 白点之上');
  await evalJs(`window.__osuStore.select([96012]); 'ok'`);
  await sleep(400);
  const px = await evalJs(`(() => {
    const p = window.__osuToCanvas(401, 100);
    const c = window.__pf();
    const d = c.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
    return [d[0], d[1], d[2]];
  })()`);
  assert(px && px[0] > 200 && px[1] < 140 && px[2] < 140, `(401,100) 探针为红色手柄 (${JSON.stringify(px)})`);

  // ---- B) 时间轴拖滑条尾改折返次数 ----
  console.log('== B) 时间轴拖尾: 折返次数');
  await evalJs(`window.__osuStore.select([]); window.__osuStore.seek(3000); 'ok'`);
  await sleep(300);
  const dur = await evalJs('window.__dur(96013)');
  console.log('  单次折返时长 dur =', dur.toFixed(1), 'ms');
  // 拉长: 拖到 time + 3*dur -> slides 3
  await evalJs(`window.__tev('mousedown', 3000 + ${dur}, 1); 'ok'`);
  await evalJs(`window.__tev('mousemove', 3000 + ${dur} + 40, 1); 'ok'`);
  await evalJs(`window.__tev('mousemove', 3000 + 3 * ${dur}, 1); 'ok'`);
  await evalJs(`window.__tev('mouseup', 3000 + 3 * ${dur}, 0); 'ok'`);
  await sleep(200);
  assert((await evalJs('window.__slides(96013)')) === 3, `拉长 -> slides=3 (实际 ${await evalJs('window.__slides(96013)')})`);
  // 拉短: 拖到 time + 1.2*dur -> slides 1
  await evalJs(`window.__tev('mousedown', 3000 + 3 * ${dur}, 1); 'ok'`);
  await evalJs(`window.__tev('mousemove', 3000 + 1.2 * ${dur}, 1); 'ok'`);
  await evalJs(`window.__tev('mouseup', 3000 + 1.2 * ${dur}, 0); 'ok'`);
  await sleep(200);
  assert((await evalJs('window.__slides(96013)')) === 1, `拉短 -> slides=1 (实际 ${await evalJs('window.__slides(96013)')})`);
  // undo 链: 两次拖尾各一次 undo -> 回到 3 -> 1... 上面第二次拖尾 undo 回 3
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert((await evalJs('window.__slides(96013)')) === 3, `undo 一次 -> slides=3 (实际 ${await evalJs('window.__slides(96013)')})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert((await evalJs('window.__slides(96013)')) === 1, `undo 两次 -> slides=1 (实际 ${await evalJs('window.__slides(96013)')})`);
  // 时间未动
  assert((await evalJs(`window.__osuStore.beatmap.hitObjects.find(o => o.id === 96013).time`)) === 3000, '拖尾不改物件时间');
  // 单击尾端 (不移动): slides 不变, v79 起不再 seek (时间保持)
  await evalJs(`window.__osuStore.seek(4000); 'ok'`);
  await evalJs(`window.__tev('mousedown', 3000 + ${dur}, 1); 'ok'`);
  await evalJs(`window.__tev('mouseup', 3000 + ${dur}, 0); 'ok'`);
  await sleep(200);
  assert((await evalJs('window.__slides(96013)')) === 1, '单击尾端 slides 不变');
  const ct = await evalJs('window.__osuStore.currentTime');
  assert(Math.abs(ct - 4000) < 2, `单击尾端不再 seek, 时间保持 4000 (${ct.toFixed(0)})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V35_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V35_CDP_PASSED');

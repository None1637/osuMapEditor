// CDP v51 端到端: 拖选中框下边时上边不再瞬移 (出界中间控制点不再触发整体平移)
// 布景: c1(200,100)@1500 nc + 滑条头(300,300) 中间控制点(560,300)出界 回折(400,200) length=50 (尾=(350,300)界内)
//   位置盒 (200,100,360,200); v52 显示盒 = 路径实体盒 (路径尾 350): (158.5,58.5,233,283); bc 手柄 osu (275, 341.5)
//   旧行为: 第一帧 mousemove 即把全控制点盒 (右缘 560>512) 判越界 -> 整体左移 48 -> c1 瞬移到 (152,100)
//   修复后: 越界判定只算头+尾 (右缘 350) -> 不平移, c1 始终 (200,100), 头缩放到 (300,350)
// 运行: node verifier/v51/cdp-v51.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9385;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v51-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900', // 无头默认 800x600 比应用 min-width 窄 (v50 坑)
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
const toClient = (ox, oy) => evalJs(`window.__osuToClient(${ox}, ${oy})`);

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
      s.beatmap.editor.timelineZoom = 1;
      s.beatmap.hitObjects = [
        { id: 98601, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98602, type: 'slider', x: 300, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 560, y: 300 }, { x: 400, y: 200 }], length: 50, slides: 1 },
      ];
      s.seek(1400);
      s.select([98601, 98602]);
      s.emit();
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) 拖 bc 手柄向下 4 步 (含出界中间控制点): 顶部圆圈不瞬移, 滑条头正常缩放');
  {
    const from = await toClient(275, 341.48);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(150);
    let allOk = true;
    for (let i = 1; i <= 4; i++) {
      const c = await toClient(275, 341.48 + i * 12.5);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'left', buttons: 1 });
      await sleep(140);
      const [cx, cy] = await evalJs('window.__posOf(98601)');
      if (cx !== 200 || cy !== 100) { allOk = false; console.error(`    step${i}: 圆圈瞬移到 (${cx},${cy})`); }
    }
    assert(allOk, '拖拽全程圆圈保持 (200,100) — 上边不瞬移 (旧实现第一帧即移 (152,100))');
    const [hx, hy] = await evalJs('window.__posOf(98602)');
    assert(hx === 300 && hy === 350, `滑条头缩放到 (300,350) (实际 ${hx},${hy})`);
    const end = await toClient(275, 391.48);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
  }

  console.log('== B) 一次 undo 还原');
  {
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [cx, cy] = await evalJs('window.__posOf(98601)');
    const [hx, hy] = await evalJs('window.__posOf(98602)');
    assert(cx === 200 && cy === 100 && hx === 300 && hy === 300, `还原 (200,100)/(300,300) (实际 ${cx},${cy} / ${hx},${hy})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V51_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V51_CDP_PASSED');

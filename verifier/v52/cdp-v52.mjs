// CDP v52 端到端: 选中框 = 路径实体盒 + 双滑条拖边的 lazer 语义
//  A) P 滑条 (三点圆弧) 框包住弧身鼓出 (旧实现只包控制点)
//  B) 双横滑条拖下边: 上边 (滑条 A) 不动, B 缩放到钳制值 — 框顶黄线全程在
//  C) 竖+横滑条拖下边: 路径随头刚性平移 (lazer OsuSelectionScaleHandler.Update 只缩 ho.Position,
//     源码注释明言 group selection 不缩路径) — 无越界整体平移, 一次 undo 还原
// 运行: node verifier/v52/cdp-v52.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9386;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v52-'));
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
const isYellow = (px) => { const [r, g, b] = px.split(',').map(Number); return r > 150 && g > 100 && b < 130; };

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
      window.__setObjs = (objs, sel) => { s.beatmap.hitObjects = objs; s.seek(1400); s.select(sel); s.emit(); };
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      window.__cpOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return (o.curvePoints ?? []).map(p => [p.x, p.y]); };
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)].join(',');
      };
      return 'ok';
    })()
  `);

  console.log('== A) P 滑条 (三点圆弧, 弧顶 (250,100) 鼓出控制点盒): 框顶包住整条弧身');
  {
    await evalJs(`window.__setObjs([
      { id: 98701, type: 'slider', x: 150, y: 200, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0,
        curveType: 'P', curvePoints: [{ x: 350, y: 200 }, { x: 250, y: 300 }], length: 471, slides: 1 },
    ], [98701])`);
    await sleep(500);
    // 显示盒 = 路径盒 (150,100)-(350,300) 外扩 41.48 -> 顶 58.52; 旧控制点盒顶 = 158.5
    const top = await evalJs('window.__pfPixel(250, 58.5)');
    assert(isYellow(top), `框顶 (250,58.5) 黄 — 包住弧顶 (旧实现此处无框) (${top})`);
    const above = await evalJs('window.__pfPixel(250, 54)');
    assert(!isYellow(above), `框顶之上 (250,54) 无黄 — 框紧贴弧身 (${above})`);
    const mid = await evalJs('window.__pfPixel(250, 158.5)');
    assert(!isYellow(mid), `旧控制点盒顶 (250,158.5) 不再有框线 (${mid})`);
  }

  console.log('== B) 双横滑条拖下边 +100: 上边滑条全程不动 (锚定), B 钳到 sy=1.42');
  {
    await evalJs(`window.__setObjs([
      { id: 98711, type: 'slider', x: 150, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 350, y: 100 }], length: 200, slides: 1 },
      { id: 98712, type: 'slider', x: 150, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 350, y: 300 }], length: 200, slides: 1 },
    ], [98711, 98712])`);
    await sleep(500);
    // 显示盒 (108.52,58.52,282.96,282.96), bc 手柄 osu (250, 341.48); 缩放参考盒 (150,100,200,200), 原点 tc (250,100)
    const from = await toClient(250, 341.48);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(150);
    let topStill = true, aStill = true;
    for (let i = 1; i <= 4; i++) {
      const c = await toClient(250, 341.48 + i * 25);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'left', buttons: 1 });
      await sleep(140);
      const [ax, ay] = await evalJs('window.__posOf(98711)');
      const [acx, acy] = (await evalJs('window.__cpOf(98711)'))[0];
      if (ax !== 150 || ay !== 100 || acx !== 350 || acy !== 100) {
        aStill = false; console.error(`    step${i}: 滑条 A 移动到 (${ax},${ay})/(${acx},${acy})`);
      }
      if (!isYellow(await evalJs('window.__pfPixel(250, 58.5)'))) topStill = false;
    }
    assert(aStill, '拖拽全程滑条 A (头/路径) 保持 (150,100)-(350,100) — 上边不异常移动');
    assert(topStill, '拖拽全程框顶黄线保持在 (250,58.5)');
    const [bx, by] = await evalJs('window.__posOf(98712)');
    const [bcx, bcy] = (await evalJs('window.__cpOf(98712)'))[0];
    assert(bx === 150 && by === 384, `B 头钳制缩放到 (150,384) (sy=1.42) (实际 ${bx},${by})`);
    assert(bcx === 350 && bcy === 384, `B 路径随头刚性平移到 (350,384) — 长度不变 (lazer 多选不缩路径) (实际 ${bcx},${bcy})`);
    const end = await toClient(250, 441.48);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [rx, ry] = await evalJs('window.__posOf(98712)');
    assert(rx === 150 && ry === 300, `一次 undo 还原 B (实际 ${rx},${ry})`);
  }

  console.log('== C) 竖滑条(顶边由其路径构成)+横滑条拖下边: 路径随头刚性移动, 无越界平移 (lazer 原生语义)');
  {
    await evalJs(`window.__setObjs([
      { id: 98721, type: 'slider', x: 150, y: 300, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 150, y: 100 }], length: 200, slides: 1 },
      { id: 98722, type: 'slider', x: 350, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 450, y: 300 }], length: 100, slides: 1 },
    ], [98721, 98722])`);
    await sleep(500);
    // 缩放参考盒 (150,100,300,200) — 顶边 = A 路径顶控制点 (150,100); 原点 tc (300,100);
    // 显示盒 bc 手柄 osu (300, 341.48)。lazer: 只缩 ho.Position, 控制点随头平移 -> 顶边 (非头点) 不锚定, 随框重算下移
    const from = await toClient(300, 341.48);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(150);
    const c = await toClient(300, 441.48); // raw sy = 1.5 -> 钳 1.42
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'left', buttons: 1 });
    await sleep(180);
    const [ax, ay] = await evalJs('window.__posOf(98721)');
    const [acx, acy] = (await evalJs('window.__cpOf(98721)'))[0];
    const [bx, by] = await evalJs('window.__posOf(98722)');
    const [bcx, bcy] = (await evalJs('window.__cpOf(98722)'))[0];
    assert(ax === 150 && ay === 384, `A 头 (150,300)->(150,384) (实际 ${ax},${ay})`);
    assert(acx === 150 && acy === 184, `A 路径随头刚性平移: 偏移 (0,-200) 保持 -> (150,184) (实际 ${acx},${acy})`);
    assert(bx === 350 && by === 384 && bcx === 450 && bcy === 384, `B 头/路径 -> (350,384)/(450,384) (实际 ${bx},${by}/${bcx},${bcy})`);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [ux, uy] = await evalJs('window.__posOf(98721)');
    const [ucx, ucy] = (await evalJs('window.__cpOf(98721)'))[0];
    assert(ux === 150 && uy === 300 && ucx === 150 && ucy === 100, `一次 undo 还原 (实际 ${ux},${uy}/${ucx},${ucy})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V52_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V52_CDP_PASSED');

// CDP v50 端到端: 缩放钳制修复 (不再卡住) / 单选单点无框 / 光标形状 / 旋转手柄 / 时间轴框选修复
// 布景: c1(200,100)@1500 nc, c2(300,200)@2000, CS4 (r=36.48); 显示盒 (163.5,63.5,173,173)
//   cr 手柄 (341.5,150); br 旋转手柄 (354,254) (v52: 显示盒外扩+5); 旋转原点 MEC (250,150)
// 运行: node verifier/v50/cdp-v50.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9382;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v50-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900', // 无头默认 800x600, 比应用 min-width 窄 -> 时间轴两侧坐标落在视口外 (target=HTML) 事件全丢
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
async function mouse(type, x, y, opts = {}) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: 1,
    buttons: type === 'mouseReleased' ? 0 : (opts.buttons ?? 1), modifiers: opts.modifiers ?? 0,
  });
  await sleep(140);
}
async function mouseMove(x, y, modifiers = 0) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, modifiers });
  await sleep(140);
}
const toClient = (ox, oy) => evalJs(`window.__osuToClient(${ox}, ${oy})`);
async function dragOsu(fromOsu, toOsuPos, modifiers = 0) {
  const from = await toClient(fromOsu[0], fromOsu[1]);
  const to = await toClient(toOsuPos[0], toOsuPos[1]);
  await mouse('mousePressed', from.x, from.y, { modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1, modifiers });
  await sleep(140);
  return to;
}
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
      s.beatmap.editor.timelineZoom = 1; // 谱面默认 zoom=2 (可视窗 3000ms), 测试坐标按 win=6000 计算, 必须显式置 1
      s.beatmap.hitObjects = [
        { id: 98502, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98503, type: 'circle', x: 300, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.seek(1400);
      s.select([98502, 98503]);
      s.emit();
      window.__posOf = (id) => { const o = s.beatmap.hitObjects.find(x => x.id === id); return [o.x, o.y]; };
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)].join(',');
      };
      window.__cursor = () => {
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return c.style.cursor || '(default)';
      };
      window.__tlRect = () => {
        const c = [...document.querySelectorAll('canvas')].find(x => x.className.includes('h-[92px]'));
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width };
      };
      window.__tlX = (ms) => {
        const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
        const t0 = s.currentTime - win / 2;
        const r = window.__tlRect();
        return r.left + ((ms - t0) / win) * r.width;
      };
      window.__selCount = () => s.selected.size;
      return 'ok';
    })()
  `);
  await sleep(500);

  console.log('== A) 缩放不再卡住: cr 手柄大幅右拖钳到 512, 回拖恢复响应');
  {
    let to = await dragOsu([341.5, 150], [836.5, 150]); // raw = 1+500/100 = 6 -> 钳 3.12
    let [x2] = await evalJs('window.__posOf(98503)');
    assert(x2 === 512, `拖过界钳到右缘 c2.x=512 (实际 ${x2})`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (await toClient(481.5, 150)).x, y: (await toClient(481.5, 150)).y, button: 'left', buttons: 1 });
    await sleep(140);
    [x2] = await evalJs('window.__posOf(98503)');
    assert(Math.abs(x2 - 440) <= 1, `回拖到 2.4x 恢复响应 c2.x≈440 (osu<->client 亚像素舍入 ±1) (实际 ${x2})`);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
  }

  console.log('== B) 仅选中一个单点时不显示边框');
  {
    await evalJs('window.__osuStore.select([98502]); "ok"');
    await sleep(400);
    const px = await evalJs('window.__pfPixel(200, 58.5)'); // 单圆时框顶边中点位置 (v52: 58.5)
    assert(!isYellow(px), `单选圆圈无黄框 (${px})`);
    await evalJs('window.__osuStore.select([98502, 98503]); "ok"');
    await sleep(400);
    const px2 = await evalJs('window.__pfPixel(200, 58.5)');
    assert(isYellow(px2), `多选恢复黄框 (${px2})`);
  }

  console.log('== C) 悬停光标形状: cr 手柄 ew-resize, 旋转手柄 grab');
  {
    const p1 = await toClient(341.5, 150);
    await mouseMove(p1.x, p1.y);
    const c1 = await evalJs('window.__cursor()');
    assert(c1 === 'ew-resize', `cr 手柄悬停 = ew-resize (实际 ${c1})`);
    const p2 = await toClient(354, 254); // br 旋转手柄
    await mouseMove(p2.x, p2.y);
    const c2 = await evalJs('window.__cursor()');
    assert(c2 === 'grab', `旋转手柄悬停 = grab (实际 ${c2})`);
    const p3 = await toClient(430, 300); // 空白
    await mouseMove(p3.x, p3.y);
    const c3 = await evalJs('window.__cursor()');
    assert(c3 === '(default)', `空白处恢复默认 (实际 ${c3})`);
  }

  console.log('== D) 旋转手柄: hover 显示, 拖拽 90° 旋转 (原点 MEC 250,150)');
  {
    const before = await evalJs('window.__pfPixel(354, 254)');
    assert(!isYellow(before), `未 hover 时旋转手柄隐藏 (${before})`);
    const hp = await toClient(354, 254);
    await mouseMove(hp.x, hp.y);
    const shown = await evalJs('window.__pfPixel(354, 254)');
    assert(isYellow(shown), `hover 后旋转手柄显示 (${shown})`);
    // 从 (354,254) [相对原点 45°] 拖到 (146,254) [135°] = +90°
    const to = await dragOsu([354, 254], [146, 254]);
    const [x1, y1] = await evalJs('window.__posOf(98502)');
    const [x2, y2] = await evalJs('window.__posOf(98503)');
    assert(x1 === 300 && y1 === 100, `c1 旋转 90° -> (300,100) (实际 ${x1},${y1})`);
    assert(x2 === 200 && y2 === 200, `c2 旋转 90° -> (200,200) (实际 ${x2},${y2})`);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
    const [rx2, ry2] = await evalJs('window.__posOf(98503)');
    assert(rx2 === 300 && ry2 === 200, `一次 undo 还原旋转 (实际 ${rx2},${ry2})`);
  }

  console.log('== E) Shift+旋转拖拽: 吸附 15° (raw 40° -> 45°)');
  {
    // 从 (354,254) [45°] 拖到 ~(262,290) [~85°] -> raw ~40° -> 吸附 45°
    const to = await dragOsu([354, 254], [262, 290], 8);
    const [x2, y2] = await evalJs('window.__posOf(98503)');
    // c2 (300,200) 绕 (250,150) 转 45°: rel(50,50) -> (0, 70.71) -> (250, 221)
    assert(x2 === 250 && y2 === 221, `Shift 吸附 45° -> c2 (250,221) (实际 ${x2},${y2})`);
    await mouse('mouseReleased', to.x, to.y);
    await evalJs('window.__osuStore.undo(); "ok"');
    await sleep(200);
  }

  console.log('== F) 时间轴: 空白处点击不选最近物件, 拖拽框选生效');
  {
    const r = await evalJs('window.__tlRect()');
    const y = r.top + 20; // 物件行内
    await evalJs('window.__osuStore.clearSelection(); "ok"'); // 先清空, 避免框选断言吃旧选区的假阳性
    // 框选: 从 3500ms 拖到 500ms (覆盖 1500/2000 两个物件)
    const x1 = await evalJs('window.__tlX(3500)');
    const x2 = await evalJs('window.__tlX(500)');
    await mouse('mousePressed', x1, y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y, button: 'left', buttons: 1 });
    await sleep(200);
    const n1 = await evalJs('window.__selCount()');
    assert(n1 === 2, `时间轴框选选中 2 个物件 (实际 ${n1})`);
    await mouse('mouseReleased', x2, y);
    await sleep(200);
    // 空白处单击: 距最近头圆 >=60px (按实际时间轴宽度换算), 不选中最近物件, 清空选区
    const r3 = await evalJs('window.__tlRect()');
    const farMs = 2000 + Math.ceil(70 / r3.width * 6000);
    const x3 = await evalJs(`window.__tlX(${farMs})`);
    await mouse('mousePressed', x3, y);
    await mouse('mouseReleased', x3, y);
    await sleep(200);
    const n2 = await evalJs('window.__selCount()');
    assert(n2 === 0, `空白单击不选最近物件 (实际选中 ${n2})`);
    // 点中头圆仍选中 (c2 @2000)
    const x4 = await evalJs('window.__tlX(2000)');
    await mouse('mousePressed', x4, y);
    await sleep(150);
    const n3 = await evalJs('window.__selCount()');
    await mouse('mouseReleased', x4, y);
    assert(n3 === 1, `点中头圆选中该物件 (实际 ${n3})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V50_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V50_CDP_PASSED');

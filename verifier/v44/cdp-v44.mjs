// CDP v44 端到端: 转换预览 combo 数字/颜色与转换应用后一致 (时间轴 + 游玩区同管线)
// 运行: node verifier/v44/cdp-v44.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9375;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v44-'));
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

  // 布景: 单红线 1000/500; c1@1000(nc) c2@1500 slider@2000(非nc) c4@4000(nc); 两 combo 色 红/绿
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.colors.combos = ['#ff0000', '#00ff00'];
      s.beatmap.hitObjects = [
        { id: 96750, type: 'circle', x: 100, y: 300, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 96751, type: 'circle', x: 200, y: 300, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 96752, type: 'slider', x: 300, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 500, y: 300 }], slides: 1, length: 200 },
        { id: 96753, type: 'circle', x: 100, y: 200, time: 4000, hitSound: 0, newCombo: true, comboSkip: 0 },
      ];
      s.select([96752]);
      s.seek(2500);
      localStorage.removeItem('osu-editor:conv:stream');
      s.emit();
      window.__prevIds = () => (window.__osuStore.conversionPreview?.objects ?? []).map(o => o.id);
      window.__combo = (id) => JSON.stringify(window.__osuComboAt(id));
      window.__setSpacing = (v) => {
        const sel = document.querySelector('[data-conv="spacing"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, String(v));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__setCount = (v) => {
        const inp = document.querySelector('[data-conv="count"]');
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, String(v));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.blur();
      };
      // 时间轴 (上方 92px canvas) 指定时间物件头圆内一点的颜色 (避开白环与中央数字)
      window.__tlPixel = (ms) => {
        const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
        if (!c) return 'no-canvas';
        const s = window.__osuStore;
        const r = c.getBoundingClientRect();
        const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
        const t0 = s.currentTime - win / 2;
        const cx = ((ms - t0) / win) * r.width - 12; // 圆心偏左 12px (RAD 24, 避开数字与右缘)
        const dpr = c.width / r.width;
        const d = c.getContext('2d').getImageData(Math.round(cx * dpr), Math.round(30 * dpr), 1, 1).data;
        return [d[0], d[1], d[2]].join(',');
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) 非 newCombo 滑条: 预览承接前文 combo (数字 3..7, 不显示 1)');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  await evalJs(`document.querySelector('[data-conv="mode-count"]').click(); 'ok'`);
  await sleep(300);
  await evalJs(`window.__setCount(5); 'ok'`); // 默认 count=8, 显式设 5 -> @2000..3000
  await sleep(400);
  const ids = await evalJs('window.__prevIds()');
  assert(ids.length === 5, `预览 5 个单点 (实际 ${ids.length})`);
  const first = JSON.parse(await evalJs(`window.__combo(${ids[0]})`));
  const last = JSON.parse(await evalJs(`window.__combo(${ids[4]})`));
  assert(first && first.combo === 0 && first.index === 3, `预览首点 {combo:0,index:3} — 不再显示 1 (实际 ${JSON.stringify(first)})`);
  assert(last && last.combo === 0 && last.index === 7, `预览末点 {combo:0,index:7} (实际 ${JSON.stringify(last)})`);
  const after = JSON.parse(await evalJs('window.__combo(96753)'));
  assert(after && after.combo === 1 && after.index === 1, `后续物件不变 {combo:1,index:1} (实际 ${JSON.stringify(after)})`);

  // 时间轴像素: 预览首点 @2000 应为 combo0 (红 #ff0000 -> mixDark 偏红)
  await sleep(300);
  const pxRed = await evalJs('window.__tlPixel(2000)');
  {
    const [r, g, b] = pxRed.split(',').map(Number);
    assert(r > 100 && r > g * 2 && r > b * 2, `时间轴预览首点染 combo0 红色 (${pxRed})`);
  }

  console.log('== B) newCombo 滑条: 预览开新 combo (数字 1..5, combo1 绿色), 后续重编号');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects.find(o => o.id === 96752).newCombo = true; // 原地改 (sliders memo 持旧引用也能看到)
      return 'ok';
    })()
  `);
  // 拨动参数强制 useMemo 重算预览 (select 原地改 Set, 引用不变不会触发)
  await evalJs(`window.__setSpacing(1); 'ok'`);
  await sleep(300);
  await evalJs(`window.__setSpacing(0.5); 'ok'`);
  await sleep(500);
  const idsB = await evalJs('window.__prevIds()');
  assert(idsB.length === 5, `预览仍为 5 个单点 (实际 ${idsB.length})`);
  const firstB = JSON.parse(await evalJs(`window.__combo(${idsB[0]})`));
  assert(firstB && firstB.combo === 1 && firstB.index === 1, `预览首点 {combo:1,index:1} (实际 ${JSON.stringify(firstB)})`);
  const afterB = JSON.parse(await evalJs('window.__combo(96753)'));
  assert(afterB && afterB.combo === 2 && afterB.index === 1, `后续物件重编号 {combo:2,index:1} (实际 ${JSON.stringify(afterB)})`);
  await sleep(300);
  const pxGreen = await evalJs('window.__tlPixel(2000)');
  {
    const [r, g, b] = pxGreen.split(',').map(Number);
    assert(g > 60 && g > r * 1.5, `时间轴预览首点染 combo1 绿色 (${pxGreen})`);
  }

  console.log('== C) 应用后: combo 与预览一致');
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(400);
  const applied = await evalJs(`
    JSON.stringify(window.__osuStore.beatmap.hitObjects
      .slice().sort((a, b) => a.time - b.time)
      .map(o => ({ t: o.time, c: window.__osuComboAt(o.id) })))
  `);
  {
    const arr = JSON.parse(applied);
    const at2000 = arr.find(o => o.t === 2000), at3000 = arr.find(o => o.t === 3000), at4000 = arr.find(o => o.t === 4000);
    assert(at2000 && at2000.c.combo === 1 && at2000.c.index === 1, `应用后 @2000 {combo:1,index:1} == 预览 (${JSON.stringify(at2000?.c)})`);
    assert(at3000 && at3000.c.combo === 1 && at3000.c.index === 5, `应用后 @3000 {combo:1,index:5} == 预览 (${JSON.stringify(at3000?.c)})`);
    assert(at4000 && at4000.c.combo === 2 && at4000.c.index === 1, `应用后 @4000 {combo:2,index:1} == 预览 (${JSON.stringify(at4000?.c)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V44_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V44_CDP_PASSED');

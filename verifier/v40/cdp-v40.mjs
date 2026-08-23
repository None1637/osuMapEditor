// CDP v40 端到端: 节拍间距 / 数量=1 / 数字输入草稿 / 曲线选项 / 选中边框全时段 / 预览选中效果+时间轴预览 / Ctrl 切换选中
// 运行: node verifier/v40/cdp-v40.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9367;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v40-'));
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
      s.beatmap.hitObjects = [
        { id: 96500, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 96501, type: 'circle', x: 400, y: 300, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([96500, 96501]);
      s.seek(1500);
      localStorage.removeItem('osu-editor:conv:stream'); // 隔离持久化参数
      // helpers
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify({ hide: p.hideIds, n: p.objects.length, objs: p.objects.map(o => [o.x, o.y, o.time]) }) : 'null';
      };
      window.__setNum = (testid, v) => {
        const inp = document.querySelector('[data-conv="' + testid + '"]');
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, String(v));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      };
      // 游玩区青色虚线环探针: 以 (ox,oy) 为圆心半径 rp 采样 36 点, 数青色 (#4df3ff 附近) 命中
      window.__cyanRing = (ox, oy, rp) => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const g = c.getContext('2d');
        let hit = 0;
        for (let i = 0; i < 36; i++) {
          const a = i / 36 * Math.PI * 2;
          const p = window.__osuToCanvas(ox + rp * Math.cos(a), oy + rp * Math.sin(a));
          if (!p) continue;
          const d = g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
          if (d[2] > 200 && d[1] > 180 && d[0] < 150) hit++;
        }
        return hit;
      };
      window.__radius = () => 54.4 - 4.48 * window.__osuStore.beatmap.difficulty.cs;
      window.__pev = (type, ox, oy, buttons, ctrl) => {
        const p = window.__osuToClient(ox, oy);
        document.querySelector('canvas.cursor-crosshair').dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: buttons ?? 0, ctrlKey: !!ctrl, clientX: p.x, clientY: p.y,
        }));
      };
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      // 时间轴选中黄环 (#ffcc22) 像素计数
      window.__tlYellow = () => {
        const c = window.__tl();
        const g = c.getContext('2d');
        const img = g.getImageData(0, 0, c.width, Math.round(60 * (c.width / c.getBoundingClientRect().width))).data;
        let n = 0;
        for (let i = 0; i < img.length; i += 4) if (img[i] > 200 && img[i + 1] > 170 && img[i + 2] < 80) n++;
        return n;
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  // ---- A) 间距单位 = 拍 (v41: 间距改下拉框) ----
  console.log('== A) 间距单位 = 拍');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  await evalJs(`
    window.__setSpacing = (v) => {
      const sel = document.querySelector('[data-conv="spacing"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, String(v));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }; 'ok'
  `);
  await evalJs(`window.__setSpacing(1); 'ok'`);
  await sleep(300);
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.n === 2 && prev.objs[1][2] - prev.objs[0][2] === 500, `1 拍间距 -> 2 点间隔 500ms (${JSON.stringify(prev.objs)})`);
  await evalJs(`window.__setSpacing(0.5); 'ok'`);
  await sleep(300);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.n === 3 && prev.objs[1][2] - prev.objs[0][2] === 250, `0.5 拍间距 -> 3 点间隔 250ms (${JSON.stringify(prev.objs)})`);

  // ---- B) 数字输入: 全选重打 + 数量=1 ----
  console.log('== B) 数字输入草稿 + 数量=1');
  await evalJs(`document.querySelector('[data-conv="mode-count"]').click(); 'ok'`);
  await sleep(200);
  await evalJs(`window.__setNum('count', 1); 'ok'`); // 模拟全选后先打 "1"
  await sleep(300);
  let cv = await evalJs(`document.querySelector('[data-conv="count"]').value`);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(cv === '1', `打了 "1" 输入框保持 "1" (实际 "${cv}")`);
  assert(prev.n === 1 && prev.objs[0][0] === 100 && prev.objs[0][1] === 100 && prev.objs[0][2] === 2000,
    `数量=1 -> 仅滑条头 (${JSON.stringify(prev.objs)})`);
  await evalJs(`window.__setNum('count', 16); 'ok'`); // 继续打 "6" -> 16
  await sleep(300);
  cv = await evalJs(`document.querySelector('[data-conv="count"]').value`);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(cv === '16' && prev.n === 16, `继续打 "6" -> 16 点 (值 "${cv}", ${prev.n} 点)`);
  // v43: 按数量模式时间 = head + i*div, 恒得 N 点; count=16 @1/2 -> 2000..5750
  assert(prev.objs[1][2] - prev.objs[0][2] === 250 && prev.objs[15][2] === 5750,
    `count=16 时间 head+i*250 (${prev.objs.map(o => o[2]).slice(0, 3).join(',')}...${prev.objs[15][2]})`);
  // 变化到 % 同样可全选重打
  await evalJs(`(() => {
    const el = document.querySelector('[data-conv="curve"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, 'linear');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })(); 'ok'`);
  await sleep(200);
  await evalJs(`window.__setNum('end-percent', 5); 'ok'`);
  await evalJs(`window.__setNum('end-percent', 50); 'ok'`);
  await sleep(200);
  cv = await evalJs(`document.querySelector('[data-conv="end-percent"]').value`);
  assert(cv === '50', `变化到% 全选重打 50 (实际 "${cv}")`);

  // ---- C) 曲线选项简化 ----
  console.log('== C) 曲线选项');
  const opts = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-conv="curve"] option')].map(o => o.textContent))`);
  assert(opts === '["等距","线性变化","先加后减","先减后加"]', `选项 = ${opts}`);

  // ---- D) 选中边框在物件未出现时渲染 ----
  console.log('== D) 未出现的选中物件也有选中边框');
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="stream"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [{ id: 96510, type: 'circle', x: 256, y: 192, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0 }];
      s.select([96510]);
      s.seek(20000); // 远离物件时间窗
      return 'ok';
    })()
  `);
  await sleep(400);
  const r = await evalJs('window.__radius()');
  const ringSel = await evalJs(`window.__cyanRing(256, 192, ${r} * 1.15)`);
  assert(ringSel >= 3, `选中且不可见: 虚线环可见 (${ringSel}/36 采样点)`);
  await evalJs(`window.__osuStore.select([]); 'ok'`);
  await sleep(300);
  const ringNone = await evalJs(`window.__cyanRing(256, 192, ${r} * 1.15)`);
  assert(ringNone === 0, `取消选中: 无环 (${ringNone})`);

  // ---- E) 预览选中效果 (游玩区全时段 + 时间轴黄环) ----
  console.log('== E) 预览选中效果');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96520, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
      ];
      s.select([96520]);
      s.seek(4000);
      return 'ok';
    })()
  `);
  await sleep(300);
  const yellowBefore = await evalJs('window.__tlYellow()');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  const yellowAfter = await evalJs('window.__tlYellow()');
  // 预览开启后源滑条被 hideIds 隐藏, 此时黄环只能来自预览物件 (>0 即证明预览物件带选中样式)
  assert(yellowAfter > 0, `时间轴预览物件选中样式 (黄环像素 ${yellowBefore} -> ${yellowAfter})`);
  // 游玩区: seek 远离后预览单点仍有选中虚线环
  await evalJs(`window.__osuStore.seek(20000); 'ok'`);
  await sleep(400);
  const ringPrev = await evalJs(`window.__cyanRing(100, 100, ${r} * 1.15)`);
  assert(ringPrev >= 3, `预览单点不可见时选中环仍显示 (${ringPrev}/36)`);
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="stream"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);

  // ---- F) Ctrl+点击 添加/移除选中 ----
  console.log('== F) Ctrl+点击 切换选中');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96530, type: 'circle', x: 256, y: 192, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 96531, type: 'circle', x: 350, y: 192, time: 2050, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([]);
      s.seek(1500); // AR9 preempt=600: 两件分别自 1400/1450 可见 (可见即可选)
      return 'ok';
    })()
  `);
  await sleep(300);
  const hasSel = (id) => evalJs(`window.__osuStore.selected.has(${id})`);
  await evalJs(`window.__pev('mousedown', 256, 192, 1, true); window.__pev('mouseup', 256, 192, 0, true); 'ok'`);
  await sleep(200);
  assert(await hasSel(96530), 'Ctrl+点击未选中物件 -> 选中');
  await evalJs(`window.__pev('mousedown', 350, 192, 1, true); window.__pev('mouseup', 350, 192, 0, true); 'ok'`);
  await sleep(200);
  assert((await hasSel(96530)) && (await hasSel(96531)), 'Ctrl+点击第二个 -> 两个都选中');
  await evalJs(`window.__pev('mousedown', 256, 192, 1, true); window.__pev('mouseup', 256, 192, 0, true); 'ok'`);
  await sleep(200);
  assert(!(await hasSel(96530)) && (await hasSel(96531)), 'Ctrl+点击已选中物件 -> 取消选中, 其他保留');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V40_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V40_CDP_PASSED');

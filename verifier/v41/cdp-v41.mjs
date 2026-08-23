// CDP v41 端到端: 节拍下拉框 / endPercent 真实击键 (100/0/1) / 变距时间等距 / Crystalia P+B UI 合并保形
// 运行: node verifier/v41/cdp-v41.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9371;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v41-'));
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

  // 布景: 一条直线滑条 (100,100)->(300,100) len200, loaded map 1 拍 = 500ms -> 单程 1000ms
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96600, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
      ];
      s.select([96600]);
      s.seek(1500);
      localStorage.removeItem('osu-editor:conv:stream'); // 隔离持久化参数
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify(p.objects.map(o => [o.x, o.y, o.time])) : 'null';
      };
      return 'ok';
    })()
  `);
  await sleep(300);

  // ---- A) 间距下拉框 ----
  console.log('== A) 间距 (拍) 下拉框');
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  // 默认按间距模式 (DEFAULT mode='spacing')
  const opts = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-conv="spacing"] option')].map(o => o.textContent))`);
  assert(opts === '["1/1","1/2","1/3","1/4","1/6","1/8","1/12","1/16"]', `下拉选项 = 1/1..1/16 (${opts})`);
  // 默认 1/2 -> 0.5 拍 = 250ms; 滑条单程 714.3ms (len 200, vel 0.28) -> 3 点
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.length === 3 && prev[1][2] - prev[0][2] === 250, `默认 1/2 -> 3 点等 250ms (${prev.length} 点)`);
  // 选 1/4 -> 125ms -> 6 点
  await evalJs(`
    (() => {
      const sel = document.querySelector('[data-conv="spacing"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, String(1 / 4));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()
  `);
  await sleep(400);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.length === 6 && prev[1][2] - prev[0][2] === 125, `1/4 -> 6 点等 125ms (${prev.length} 点)`);

  // ---- B) 变距: 时间等距 + 空间渐变; endPercent 真实击键 100/0/1 ----
  console.log('== B) 变距时间等距 + endPercent 击键');
  await evalJs(`
    (() => {
      // v43: 按数量模式时间 = head + i*div (吸附网格, 允许超尾), 位置按数量均布 —
      // 换成合成 timing (单红线 1000/500, SM=1) 使 duration=1000ms, count=8 @1/2 -> 8 点等 250ms
      const s = window.__osuStore;
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.sliderMultiplier = 1;
      s.emit();
      // 切到按数量 (默认 8), 网格设回 1/2 (A 段改成了 1/4), 曲线=线性变化
      document.querySelector('[data-conv="mode-count"]').click();
      const sp = document.querySelector('[data-conv="spacing"]');
      const spSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      spSetter.call(sp, '0.5');
      sp.dispatchEvent(new Event('change', { bubbles: true }));
      const sel = document.querySelector('[data-conv="curve"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'linear');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()
  `);
  await sleep(400);
  prev = JSON.parse(await evalJs('window.__prev()'));
  const times = prev.map(o => o[2]);
  const tgaps = times.slice(1).map((v, i) => v - times[i]);
  assert(times.join(',') === '2000,2250,2500,2750,3000,3250,3500,3750', `count=8 时间 head+i*250 等距 (${times.join(',')})`);
  const xgaps = prev.slice(1).map((o, i) => o[0] - prev[i][0]);
  assert(xgaps.every((g, i) => i === 0 || g < xgaps[i - 1]), `空间间距前疏后密严格递减 (${xgaps.join(',')})`);
  assert(prev[prev.length - 1][0] === 300, `变距末点在路径尾 (x=${prev[prev.length - 1][0]})`);
  // 真实击键: focus + selectAll + insertText "100"
  const typeInto = async (testid, text) => {
    await evalJs(`(() => { const el = document.querySelector('[data-conv="${testid}"]'); el.focus(); el.select(); return 'ok'; })()`);
    await sleep(150);
    await send('Input.insertText', { text });
    await sleep(300);
  };
  await typeInto('end-percent', '100');
  let val = await evalJs(`document.querySelector('[data-conv="end-percent"]').value`);
  assert(val === '100', `击键重打 100: 输入框 = "${val}"`);
  await typeInto('end-percent', '0');
  val = await evalJs(`document.querySelector('[data-conv="end-percent"]').value`);
  assert(val === '0', `击键重打 0: 输入框 = "${val}" (支持 0%)`);
  await typeInto('end-percent', '1');
  val = await evalJs(`document.querySelector('[data-conv="end-percent"]').value`);
  assert(val === '1', `击键重打 1: 输入框 = "${val}" (支持 1%)`);
  // 逐键模拟 "1" -> "10" -> "100" (DraftNum 草稿不被 clamp 打断)
  await evalJs(`(() => { const el = document.querySelector('[data-conv="end-percent"]'); el.focus(); el.select(); return 'ok'; })()`);
  await sleep(150);
  for (const ch of ['1', '0', '0']) { await send('Input.insertText', { text: ch }); await sleep(200); }
  val = await evalJs(`document.querySelector('[data-conv="end-percent"]').value`);
  assert(val === '100', `逐键 1-0-0: 输入框 = "${val}"`);
  await evalJs(`document.querySelector('[data-conv="end-percent"]').blur(); 'ok'`);
  await evalJs(`(() => { [...document.querySelectorAll('[data-dialog="stream"] button')].find(b => b.textContent === '取消').click(); })(); 'ok'`);
  await sleep(300);

  // ---- C) Crystalia 第3+4滑条 UI 合并保形 ----
  console.log('== C) Crystalia P+B 合并 (UI)');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96610, type: 'slider', x: 476, y: 64, time: 3020, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'P', curvePoints: [{ x: 405, y: 153 }, { x: 485, y: 236 }], slides: 1, length: 250 },
        { id: 96611, type: 'slider', x: 423, y: 306, time: 3687, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'B', curvePoints: [
            { x: 381, y: 310 }, { x: 355, y: 273 }, { x: 355, y: 273 }, { x: 335, y: 305 }, { x: 299, y: 316 },
            { x: 299, y: 316 }, { x: 279, y: 282 }, { x: 236, y: 276 }, { x: 209, y: 291 }], slides: 1, length: 250 },
      ];
      s.select([96610, 96611]);
      s.seek(2500);
      return 'ok';
    })()
  `);
  await sleep(400);
  await evalJs(`document.querySelector('[data-conv-apply="merge"]').click(); 'ok'`);
  await sleep(400);
  const mergedInfo = await evalJs(`
    (() => {
      const s = window.__osuStore;
      const m = s.beatmap.hitObjects.find(o => o.type === 'slider' && o.time === 3020);
      return m ? JSON.stringify({ x: m.x, y: m.y, curveType: m.curveType, len: m.length,
        pts: m.curvePoints.map(p => [p.x, p.y]), sel: s.selected.has(m.id), n: s.beatmap.hitObjects.length }) : 'null';
    })()
  `);
  const mi = JSON.parse(mergedInfo);
  assert(mi !== null && mi.x === 476 && mi.y === 64 && mi.curveType === 'B', `合并滑条头部 B (${mi?.x},${mi?.y})`);
  // P 部分贝塞尔锚点 (修复 circleToBezier 后的期望几何; 容差 ±2 取整)
  const expectHead = [[433, 72], [403, 110], [405, 154], [405, 154], [407, 197], [442, 233], [485, 236]];
  const headOk = expectHead.every(([ex, ey], i) => mi.pts[i] && Math.abs(mi.pts[i][0] - ex) <= 2 && Math.abs(mi.pts[i][1] - ey) <= 2);
  assert(headOk, `P 部分贝塞尔锚点正确 (${JSON.stringify(mi.pts.slice(0, 7))})`);
  assert(mi.pts.filter((p, i) => i > 0 && p[0] === mi.pts[i - 1][0] && p[1] === mi.pts[i - 1][1]).length >= 3, '接缝红锚点重复对存在');
  assert(mi.sel === true, '合并后选中新滑条');
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  await sleep(300);
  assert(await evalJs('window.__osuStore.beatmap.hitObjects.length') === 2, 'undo 还原 2 条源滑条');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V41_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V41_CDP_PASSED');

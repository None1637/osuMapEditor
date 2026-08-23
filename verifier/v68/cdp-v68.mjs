// CDP v68 端到端: 批量复制增强 — 复制绿线(预览/应用/undo) / 向量箭头拖拽 / 自定义锚点物件+网格吸附
// 运行: node verifier/v68/cdp-v68.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9403;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v68-'));
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
async function mouse(type, osuX, osuY, opts = {}) {
  const c = await evalJs(`window.__osuToClient(${osuX}, ${osuY})`);
  await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', buttons: type === 'mouseMoved' ? 1 : 0, clickCount: 1, ...opts });
}
async function drag(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0); await sleep(80);
  await mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2); await sleep(60);
  await mouse('mouseMoved', x1, y1); await sleep(80);
  await mouse('mouseReleased', x1, y1); await sleep(200);
}
/** React 受控 input 赋值 (触发 onChange) */
const setInput = (sel, v) => evalJs(`
  (() => {
    const el = document.querySelector('${sel}');
    if (!el) return 'missing';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${v}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // 清 DraftNum 的 draft 态 (onChange 会 setDraft; 合成事件未经过 focus, blur() 是 no-op, 手动发 focusout)
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return 'ok';
  })()
`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 布景: 红线 120BPM; 滑条 [1000,1600]; 绿线 1000/1400 (范围内) + 3000 (范围外); 远处单点供吸附测试
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        { time: 1000, beatLength: -100, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
        { time: 1400, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 70, uninherited: false, effects: 0 },
        { time: 3000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 200, y: 200, time: 1000, endTime: 1600, hitSound: 0, newCombo: false, comboOffset: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 100 },
        { id: 2, type: 'circle', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: false, comboOffset: 0 },
      ];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4;
      s.distanceLock = false;
      s.gridSnap = false;
      s.tool = 'select';
      s.seek(1200);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) 复制绿线: 勾选 => 预览 4 条副本, 应用写入, 一次 undo');
  {
    await evalJs(`(() => {
      const s = window.__osuStore;
      s.selected = new Set([1]);
      s.openConversion('duplicate');
      return 'ok';
    })()`);
    await sleep(400);
    assert(await evalJs(`!!document.querySelector('[data-conv="copyGreenLines"]')`), '勾选框存在');
    const before = await evalJs(`window.__osuStore.conversionPreview?.timingPoints?.length ?? -1`);
    assert(before === 0, `默认不复制绿线 (预览 ${before})`);
    await evalJs(`document.querySelector('[data-conv="copyGreenLines"]').click(); "ok"`);
    await sleep(300);
    const prev = await evalJs(`(() => {
      const tp = window.__osuStore.conversionPreview?.timingPoints ?? [];
      return [tp.length, tp.map(t => t.time).sort((a, b) => a - b)];
    })()`);
    assert(prev[0] === 4 && JSON.stringify(prev[1]) === JSON.stringify([1500, 1900, 2000, 2400]),
      `预览 4 条绿线副本 @1500/1900/2000/2400 (实际 ${JSON.stringify(prev)})`);
    await evalJs(`document.querySelector('[data-conv="apply"]').click(); "ok"`);
    await sleep(300);
    const applied = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => !t.uninherited).map(t => t.time).sort((a, b) => a - b)`);
    assert(JSON.stringify(applied) === JSON.stringify([1000, 1400, 1500, 1900, 2000, 2400, 3000]),
      `应用后绿线 = 原 3 + 副本 4 (实际 ${JSON.stringify(applied)})`);
    assert(await evalJs(`window.__osuStore.conversionDialog`) === null, '应用后窗口关闭');
    await evalJs(`window.__osuStore.undo(); "ok"`);
    await sleep(200);
    const undone = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => !t.uninherited).length`);
    assert(undone === 3, `一次 undo 绿线复原 (实际 ${undone})`);
  }

  console.log('== B) 向量箭头: dx=50 时锚在滑条尾 (300,200), 拖头改向量');
  {
    await evalJs(`(() => {
      const s = window.__osuStore;
      s.selected = new Set([1, 2]);
      s.openConversion('duplicate');
      return 'ok';
    })()`);
    await sleep(400);
    assert(await evalJs(`window.__osuStore.dupVectorView`) === null, '向量 0 时不画箭头');
    assert(await setInput('[data-conv="dx"]', '50') === 'ok', 'dx 输入 50');
    await sleep(300);
    const v = await evalJs(`(() => {
      const dv = window.__osuStore.dupVectorView;
      return dv ? [dv.anchor.x, dv.anchor.y, dv.dx, dv.dy] : null;
    })()`);
    // 选区 [滑条(end 1600), 单点(2000)] — 最后源物件 = 单点 (100,100)
    assert(v !== null && Math.abs(v[0] - 100) <= 1 && Math.abs(v[1] - 100) <= 1 && v[2] === 50 && v[3] === 0,
      `箭头: 锚 = 最后源物件尾端 (100,100), 向量 (50,0) (实际 ${JSON.stringify(v)})`);
    // 拖箭头头 (150,100) -> (200,120): 向量应变 (100,20)
    await drag(150, 100, 200, 120);
    const v2 = await evalJs(`(() => {
      const dv = window.__osuStore.dupVectorView;
      const inp = document.querySelector('[data-conv="dx"]');
      return dv ? [dv.dx, dv.dy, parseFloat(inp?.value ?? 'NaN')] : null;
    })()`);
    // 像素换算有亚像素误差, 容差 ±0.6
    assert(v2 !== null && Math.abs(v2[0] - 100) <= 0.6 && Math.abs(v2[1] - 20) <= 0.6, `拖头后向量 ≈ (100,20) (实际 ${JSON.stringify(v2)})`);
    assert(Math.abs(v2[2] - 100) <= 0.6, `弹窗 dx 输入同步 (${v2[2]})`);
    // 预览副本随新向量平移: 第 1 份滑条头 ≈ (200+100, 200+20)
    const cp = await evalJs(`(() => {
      const p = window.__osuStore.conversionPreview?.objects.find(o => o.type === 'slider');
      return p ? [p.x, p.y] : null;
    })()`);
    assert(cp !== null && Math.abs(cp[0] - 300) <= 1 && Math.abs(cp[1] - 220) <= 1, `预览副本随向量更新 (实际 ${JSON.stringify(cp)})`);
    await evalJs(`window.__osuStore.closeConversion(); "ok"`);
    await sleep(200);
    assert(await evalJs(`window.__osuStore.dupVectorView`) === null, '关窗清理箭头');
  }

  console.log('== C) 自定义锚点: 物件吸附 (拖到 (103,102) 吸附到单点 (100,100))');
  {
    await evalJs(`(() => {
      const s = window.__osuStore;
      s.seek(2000); // 让单点 (time 2000) 进入可见窗口 (物件吸附目标 = 可见物件)
      s.selected = new Set([2]);
      s.setOriginMode('custom');
      s.setCustomOrigin({ x: 200, y: 200 });
      s.gridSnap = false;
      s.emit();
      return 'ok';
    })()`);
    await sleep(200);
    await drag(200, 200, 103, 102);
    const o = await evalJs(`[window.__osuStore.customOrigin.x, window.__osuStore.customOrigin.y]`);
    assert(o[0] === 100 && o[1] === 100, `锚点吸附到物件 (实际 ${o})`);
  }

  console.log('== D) 自定义锚点: 网格吸附 (拖到 (150,150) 吸附到 (160,160))');
  {
    await evalJs(`(() => {
      const s = window.__osuStore;
      s.setCustomOrigin({ x: 300, y: 300 });
      s.gridSnap = true;
      s.gridType = 'square';
      s.gridSpacing = 32;
      s.gridRotation = 0;
      s.emit();
      return 'ok';
    })()`);
    await sleep(200);
    await drag(300, 300, 150, 150);
    const o = await evalJs(`[window.__osuStore.customOrigin.x, window.__osuStore.customOrigin.y]`);
    assert(o[0] === 160 && o[1] === 160, `锚点吸附到网格 (实际 ${o})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V68_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V68_CDP_PASSED');

// 验证器 v479: 物件时间轴 — 选取滑条尾后再点头选不上头
//   (soulten: 在物件時間軸上選取滑條尾部之後再點頭沒辦法選取滑條頭)
// 根因: 时间轴点尾圆/折返点走 selectEdges (物件级 selected 也含该物件); 再点头圆时命中分支
//   只在「物件未选中」时才 select, 物件已在选区 → 什么都不做, 尾节点选区残留 = 头选不上。
// 修复: 头圆/连体条命中分支加一条 — 单选且存在节点/尾选区时 select([id]) 清掉节点选区,
//   回到物件级选中 (多选保持 v32 不塌缩行为)。
// 运行: npm run build 后 node verifier/v479/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 头圆/连体条命中后清节点选区 (v479)');
{
  const tl = read('src/components/Timelines.tsx');
  const n = (tl.match(/store\.selected\.size === 1 && \(store\.selectedEdges\.size \|\| store\.selectedNodes\.size\)/g) ?? []).length;
  assert(n === 2, `头圆分支 + 连体条分支各一条清节点选区 (命中 ${n})`);
  assert(/v479: 尾圆\/折返点选中后再点头圆/.test(tl), 'v479 注释在');
}

section('CDP: 时间轴点尾圆 → 再点头圆 → 尾选区清除, 物件保持选中');
{
  const PORT = 9488;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await sleep(2100); // v518: 等布局移动后的 zoomRect 2s 缓存过期

    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red0.time + red0.beatLength * 8);
      // 滑条时长由 length/速度决定 (loader 不算 endTime); win 实测 1500 (timelineZoom=4)
      const mk = { id: 479001, type: 'slider', x: 100, y: 100, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 300 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 4;
      const vel = 100 * base.difficulty.sliderMultiplier / red0.beatLength;
      const end = t + 300 / vel; // slides=1
      // 保证头尾都在可视窗内: 需 currentTime-win/2 ≤ t 且 currentTime+win/2 ≥ end
      store.seek(Math.round((t + end) / 2)); store.clearSelection();
      await sleep(200);
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const win = 6000 / (base.editor.timelineZoom || 1);
      const t0w = store.currentTime - win / 2;
      const xOf = (ms) => r.left + ((ms - t0w) / win) * r.width;
      const y = r.top + 30; // 物件行中央 (OBJ_H=60)
      const click = (x) => {
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
      };
      const headX = xOf(t), tailX = xOf(end);
      if (headX < r.left || tailX + 15 > r.right) return { err: '几何超出可视窗', headX, tailX, left: r.left, right: r.right };
      // 1) 点尾圆偏 15px — 命中尾节点 (半径 27) 而不触发拖尾把手 (8px 阈值)
      click(tailX + 15);
      await sleep(200);
      const afterTail = { sel: [...store.selected], edges: [...store.selectedEdges.entries()].map(([k, v]) => k + ':' + [...v].join('.')) };
      // 2) 再点头圆正中
      click(headX);
      await sleep(200);
      const afterHead = { sel: [...store.selected], edges: [...store.selectedEdges.entries()].map(([k, v]) => k + ':' + [...v].join('.')) };
      // 3) 再点尾圆 (应能再次选尾 — 往返都通)
      click(tailX + 15);
      await sleep(200);
      const afterTail2 = { sel: [...store.selected], edges: [...store.selectedEdges.entries()].map(([k, v]) => k + ':' + [...v].join('.')) };
      // 4) 点连体条中段 — 同 v479 语义, 回到物件级选中
      click(xOf((t + end) / 2));
      await sleep(200);
      const afterBar = { sel: [...store.selected], edges: [...store.selectedEdges.entries()].map(([k, v]) => k + ':' + [...v].join('.')) };
      return { afterTail, afterHead, afterTail2, afterBar };
    })()`);
    assert(JSON.stringify(r1.afterTail.sel) === '[479001]' && r1.afterTail.edges.length === 1,
      `点尾圆: 选中物件 + 尾节点选区 (${JSON.stringify(r1.afterTail)})`);
    assert(JSON.stringify(r1.afterHead.sel) === '[479001]' && r1.afterHead.edges.length === 0,
      `再点头圆: 物件保持选中且尾选区清除 = 头选上了 (${JSON.stringify(r1.afterHead)})`);
    assert(r1.afterTail2.edges.length === 1, `再点尾圆: 又能选尾 (往返通畅; ${JSON.stringify(r1.afterTail2)})`);
    assert(r1.afterBar.edges.length === 0 && JSON.stringify(r1.afterBar.sel) === '[479001]',
      `点连体条中段: 同样回到物件级选中 (${JSON.stringify(r1.afterBar)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V479_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V479_ALL_TESTS_PASSED');

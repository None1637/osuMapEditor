// CDP v86 端到端: pattern 库全链路
// A) 选中两物件收藏 => patterns 入库 (节拍偏移 0/1)
// B) 缩略图非全黑 (游玩区渲染管线)
// C) 换 BPM 后拖到游玩区 => 落盘物件仍间隔一拍 (240BPM => 250ms), 位置 = 落点+相对偏移
// D) 勾"插入绿线对齐"再拖 => 插入开头对齐+结尾还原两条绿线
// E) 两个勾选框互斥
// F) 新建分类 => 拖缩略图到分类标签 => 移动; 删分类 => 回未分类
// G) 删除 pattern
// 运行: node verifier/v86/cdp-v86.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v86-'));
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
// 从 DOM 元素中心拖到目标 client 坐标
async function dragTo(sel, tx, ty) {
  const from = await evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!from) throw new Error('元素不存在: ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (from.x + tx) / 2, y: (from.y + ty) / 2, button: 'left', buttons: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
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
  await sleep(500);

  // 布景: 120BPM, 两个间隔一拍的单点
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.difficulty.sliderMultiplier = 1.4;
      s.beatmap.hitObjects = [
        { id: 1, type: 'circle', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 2, type: 'circle', x: 164, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.seek(1000);
      s.select([1, 2]);
      s.loadPatternsIfNeeded();
      s.patterns = []; s.patternGroups = [];
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 收藏选中物件');
  {
    await evalJs(`document.querySelector('[data-pattern-input="panel-toggle"]').click(); "ok"`);
    await sleep(400);
    await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
    await sleep(300);
    const p = await evalJs(`window.__osuStore.patterns[0] ?? null`);
    assert(p !== null, 'pattern 入库');
    if (p) {
      assert(p.objects.length === 2 && p.objects[0].beatOffset === 0 && p.objects[1].beatOffset === 1,
        `节拍偏移 0/1 (实际 ${p.objects.map(o => o.beatOffset)})`);
      assert(p.objects[1].dx === 64 && p.svPxPerBeat === 140, '相对位置 + 等效 SV');
    }
  }

  console.log('== B) 缩略图非全黑');
  {
    const nonBlack = await evalJs(`
      (() => {
        const c = document.querySelector('[data-pattern-card] canvas');
        if (!c) return -1;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n++;
        return n;
      })()
    `);
    assert(nonBlack > 50, `缩略图非黑像素 ${nonBlack} > 50`);
  }

  console.log('== C) 换 BPM (240) 拖到游玩区 => 仍间隔一拍');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.beatmap.timingPoints = [
          { time: 0, beatLength: 250, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
        ];
        s.beatmap.hitObjects = [];
        s.clearSelection();
        s.seek(0);
        // 找一个不被面板遮挡的游玩区落点 (面板居中, 角落安全)
        window.__freeDrop = null;
        for (const [ox, oy] of [[450, 320], [60, 320], [450, 60], [60, 60], [250, 200]]) {
          const c = window.__osuToClient(ox, oy);
          const el = document.elementFromPoint(c.x, c.y);
          if (el && el.className && String(el.className).includes('cursor-crosshair')) { window.__freeDrop = { ox, oy, x: c.x, y: c.y }; break; }
        }
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(300);
    const drop = await evalJs(`window.__freeDrop`);
    assert(drop !== null, '找到未遮挡落点');
    await dragTo('[data-pattern-card]', drop.x, drop.y);
    const objs = await evalJs(`window.__osuStore.beatmap.hitObjects.map(o => ({ t: o.time, x: o.x, y: o.y }))`);
    assert(objs.length === 2, `落盘 2 物件 (实际 ${objs.length})`);
    if (objs.length === 2) {
      assert(objs[0].t === 0 && objs[1].t === 250, `间隔一拍 = 250ms (实际 ${objs[0].t}/${objs[1].t})`);
      // v108 适配: 左侧栏使游玩区变窄, client→osu 取相有 ±1px 量化差; 绝对位置放宽 ±1, 相对偏移保持精确
      assert(Math.abs(objs[0].x - drop.ox) <= 1 && Math.abs(objs[0].y - drop.oy) <= 1 && objs[1].x - objs[0].x === 64,
        `位置 = 落点±1px + 精确偏移 (实际 ${objs[0].x},${objs[0].y}/${objs[1].x}, 期望 ≈${drop.ox},${drop.oy}/${drop.ox + 64})`);
    }
    const sel = await evalJs(`window.__osuStore.selected.size`);
    assert(sel === 2, '落盘后选中新物件');
  }

  console.log('== D) 插入绿线对齐 => 开头对齐 + 结尾还原');
  {
    await evalJs(`document.querySelector('[data-pattern-align="greenline"]').click(); "ok"`);
    await sleep(250);
    const align = await evalJs(`window.__osuStore.patternAlign`);
    assert(align === 'greenline', '勾选生效');
    await evalJs(`window.__osuStore.beatmap.hitObjects = []; window.__osuStore.clearSelection(); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    const drop = await evalJs(`window.__freeDrop`);
    await dragTo('[data-pattern-card]', drop.x, drop.y);
    const greens = await evalJs(`window.__osuStore.beatmap.timingPoints.filter(t => !t.uninherited).map(t => ({ t: t.time, bl: t.beatLength }))`);
    assert(greens.length === 2, `两条绿线 (实际 ${greens.length})`);
    if (greens.length === 2) {
      assert(greens[0].t === 0 && greens[0].bl === -100, `开头 sv=1 对齐 (实际 ${greens[0].t}, ${greens[0].bl})`);
      assert(greens[1].t === 250 && greens[1].bl === -100, `结尾 250ms 还原 sv=1 (实际 ${greens[1].t}, ${greens[1].bl})`);
    }
  }

  console.log('== E) 勾选框互斥');
  {
    await evalJs(`document.querySelector('[data-pattern-align="scale"]').click(); "ok"`);
    await sleep(200);
    let align = await evalJs(`window.__osuStore.patternAlign`);
    assert(align === 'scale', '勾缩放 => 绿线自动取消');
    await evalJs(`document.querySelector('[data-pattern-align="scale"]').click(); "ok"`);
    await sleep(200);
    align = await evalJs(`window.__osuStore.patternAlign`);
    assert(align === 'none', '再点 => 取消');
  }

  console.log('== F) 分类: 新建 => 拖缩略图移动 => 删分类回未分类');
  {
    await evalJs(`
      (() => {
        const el = document.querySelector('[data-pattern-input="new-group"]');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(el, 'G1'); el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()
    `);
    await sleep(150);
    await evalJs(`document.querySelector('[data-pattern-input="add-group"]').click(); "ok"`);
    await sleep(250);
    const groups = await evalJs(`window.__osuStore.allPatternGroups()`);
    assert(groups.includes('G1'), '分类 G1 已建');
    // 拖缩略图到 G1 标签
    const label = await evalJs(`(() => { const el = document.querySelector('[data-pattern-group="G1"]');
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await dragTo('[data-pattern-card]', label.x, label.y);
    const g1 = await evalJs(`window.__osuStore.patterns[0].group`);
    assert(g1 === 'G1', `拖到分类标签 => 移动 (实际 ${g1})`);
    // 切到 G1, 删除分类 => 回未分类
    await evalJs(`document.querySelector('[data-pattern-group="G1"]').click(); "ok"`);
    await sleep(200);
    await evalJs(`document.querySelector('[data-pattern-input="delete-group"]').click(); "ok"`);
    await sleep(250);
    const g2 = await evalJs(`window.__osuStore.patterns[0].group`);
    assert(g2 === '未分类', `删分类 => 回未分类 (实际 ${g2})`);
  }

  console.log('== G) 删除 pattern');
  {
    await evalJs(`document.querySelector('[data-pattern-delete]').click(); "ok"`);
    await sleep(250);
    const n = await evalJs(`window.__osuStore.patterns.length`);
    assert(n === 0, 'pattern 已删');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V86_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V86_CDP_PASSED');

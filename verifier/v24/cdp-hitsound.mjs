// CDP v24 端到端验证: hitsound 快捷键 (Q/W/E/R) + Inspector hitsound 编辑
// 流程: 页面选中物件 -> 派发 W 键 -> 断言 whistle 位 + undo 还原; 派发 Q -> newCombo 翻转;
//       多选派发 W -> 批量生效, 一次 undo 全部还原; Inspector 改 volume/customIndex/normalSet -> 断言 store 数据;
//       全程无页面异常; 截图 verifier/runs/v24-inspector.png
// 运行: node verifier/v24/cdp-hitsound.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9349;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v24-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

const target = await getTarget();
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
  await sleep(3500);

  // 注入测试物件 (3 circle + 1 slider), 选中第一个 circle
  await evalJs(`(() => {
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [
      { id: 92001, type: 'circle', x: 256, y: 192, time: 5000, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 92002, type: 'circle', x: 320, y: 192, time: 5500, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 92003, type: 'circle', x: 200, y: 250, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 92004, type: 'slider', x: 100, y: 100, time: 7000, hitSound: 0, newCombo: false, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100 },
    ];
    s.select([92001]);
    s.seek(4999);
    return 'ok'
  })()`);
  await sleep(400);

  // ---- 1. W 键: whistle 位 toggle + undo 还原 ----
  const r1 = await evalJs(`(() => {
    const s = window.__osuStore;
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('w');
    const after = s.beatmap.hitObjects[0].hitSound;
    s.undo();
    const undone = s.beatmap.hitObjects[0].hitSound;
    s.redo();
    const redone = s.beatmap.hitObjects[0].hitSound;
    return JSON.stringify({ after, undone, redone })
  })()`);
  const p1 = JSON.parse(r1);
  assert((p1.after & 2) !== 0, `W 键后 hitSound 含 whistle 位 (实际 ${p1.after})`);
  assert(p1.undone === 0, '一次 undo 还原 hitSound=0');
  assert((p1.redone & 2) !== 0, 'redo 恢复 whistle 位');

  // ---- 2. E/R 键: finish/clap 位 ----
  const r2 = await evalJs(`(() => {
    const s = window.__osuStore;
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('e'); key('r');
    const hs = s.beatmap.hitObjects[0].hitSound;
    key('w'); // 再按 W 关掉 whistle
    return JSON.stringify({ hs, after: s.beatmap.hitObjects[0].hitSound })
  })()`);
  const p2 = JSON.parse(r2);
  assert((p2.hs & 4) !== 0 && (p2.hs & 8) !== 0, `E/R 后含 finish+clap 位 (实际 ${p2.hs})`);
  assert((p2.after & 2) === 0 && (p2.after & 4) !== 0, 'W 再按一次关掉 whistle, finish 保留');

  // ---- 3. Q 键: newCombo 翻转 (ComboSkip 不动) ----
  const r3 = await evalJs(`(() => {
    const s = window.__osuStore;
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const before = s.beatmap.hitObjects[0].newCombo;
    key('q');
    const after = s.beatmap.hitObjects[0].newCombo;
    const skip = s.beatmap.hitObjects[0].comboSkip;
    s.undo();
    return JSON.stringify({ before, after, skip, undone: s.beatmap.hitObjects[0].newCombo })
  })()`);
  const p3 = JSON.parse(r3);
  assert(p3.before === false && p3.after === true, 'Q 键 newCombo false->true');
  assert(p3.skip === 0, 'comboSkip 不受影响');
  assert(p3.undone === false, 'Q 一次 undo 还原');

  // ---- 4. 多选批量: 选 3 个物件按 W, 全部置位, 一次 undo 全部还原 ----
  const r4 = await evalJs(`(() => {
    const s = window.__osuStore;
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    s.select([92001, 92002, 92003]);
    key('w');
    const bits = s.beatmap.hitObjects.slice(0, 3).map(o => o.hitSound & 2);
    s.undo();
    const undone = s.beatmap.hitObjects.slice(0, 3).map(o => o.hitSound & 2);
    s.select([92001]);
    return JSON.stringify({ bits, undone })
  })()`);
  const p4 = JSON.parse(r4);
  assert(p4.bits.every(b => b === 2), `多选按 W 全部置 whistle 位 (实际 ${JSON.stringify(p4.bits)})`);
  assert(p4.undone.every(b => b === 0), '一次 undo 三个物件全部还原');

  // ---- 5. 输入框聚焦时快捷键不触发 ----
  const r5 = await evalJs(`(() => {
    const s = window.__osuStore;
    const hs0 = s.beatmap.hitObjects[0].hitSound;
    const input = document.querySelector('[data-hs="volume"]');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    const hs1 = s.beatmap.hitObjects[0].hitSound;
    input.blur();
    return JSON.stringify({ hs0, hs1 })
  })()`);
  const p5 = JSON.parse(r5);
  assert(p5.hs0 === p5.hs1, '输入框聚焦时按 W 不触发快捷键');

  // ---- 6. Inspector 编辑: volume / customIndex / normalSet 下拉 ----
  // React 受控组件需用原生 setter + input 事件
  const r6 = await evalJs(`(() => {
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal(document.querySelector('[data-hs="volume"]'), '80');
    setVal(document.querySelector('[data-hs="customIndex"]'), '2');
    const selEl = document.querySelector('[data-hs="normalSet"]');
    const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    selSetter.call(selEl, '3');
    selEl.dispatchEvent(new Event('change', { bubbles: true }));
    const o = window.__osuStore.beatmap.hitObjects[0];
    return JSON.stringify({ raw: o.hitSampleRaw })
  })()`);
  const p6 = JSON.parse(r6);
  assert(p6.raw === '3:0:2:80:', `Inspector 编辑后 hitSampleRaw="3:0:2:80:" (实际 ${p6.raw})`);

  // 每次修改一次 undo: 连续 undo 3 次应逐步撤销 (volume -> customIndex -> normalSet 顺序的逆)
  const r7 = await evalJs(`(() => {
    const s = window.__osuStore;
    const steps = [];
    s.undo(); steps.push(s.beatmap.hitObjects[0].hitSampleRaw ?? '');
    s.undo(); steps.push(s.beatmap.hitObjects[0].hitSampleRaw ?? '');
    s.undo(); steps.push(s.beatmap.hitObjects[0].hitSampleRaw ?? '');
    return JSON.stringify(steps)
  })()`);
  const p7 = JSON.parse(r7);
  assert(p7[0] === '0:0:2:80:', `undo1 撤销 normalSet (实际 ${p7[0]})`);
  assert(p7[1] === '0:0:0:80:', `undo2 撤销 customIndex (实际 ${p7[1]})`);
  assert(p7[2] === '', 'undo3 撤销 volume, 全默认 -> hitSample 字段省略');

  // ---- 7. Inspector checkbox: Clap 批量置位/清位 (此时 92001 的 clap 位已在前面 R 键步骤置位) ----
  // 注意: 每次修改触发重渲染, checkbox 节点被替换, 每次点击前需重新 querySelector
  const r8 = await evalJs(`(() => {
    const s = window.__osuStore;
    const before = s.beatmap.hitObjects[0].hitSound & 8;
    document.querySelector('[data-hs="Clap"]').click();
    const after = s.beatmap.hitObjects[0].hitSound & 8;
    document.querySelector('[data-hs="Clap"]').click();
    const restored = s.beatmap.hitObjects[0].hitSound & 8;
    return JSON.stringify({ before, after, restored })
  })()`);
  const p8 = JSON.parse(r8);
  assert(p8.before === 8 && p8.after === 0, `checkbox 取消勾选清位 (before=${p8.before} after=${p8.after})`);
  assert(p8.restored === 8, '再次勾选置位');

  // ---- 8. 序列化结果核对 (导出字符串含正确 hitSample 段) ----
  const r9 = await evalJs(`(() => {
    const s = window.__osuStore;
    // 重新设置一个已知状态再核序列化
    s.select([92002]);
    s.applyHitSampleToSelected({ volume: 60, customIndex: 3 });
    const o = s.beatmap.hitObjects[1];
    return JSON.stringify({ raw: o.hitSampleRaw, hs: o.hitSound })
  })()`);
  const p9 = JSON.parse(r9);
  assert(p9.raw === '0:0:3:60:', `批量应用 hitSample 正确 (实际 ${p9.raw})`);

  // ---- 截图: 选中带 hitsound 的物件, 展示 Inspector 区块 ----
  await evalJs(`(() => {
    const s = window.__osuStore;
    s.select([92001]);
    s.seek(5000);
    return 'ok'
  })()`);
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v24-inspector.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v24-inspector.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V24_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V24_CDP_PASSED');

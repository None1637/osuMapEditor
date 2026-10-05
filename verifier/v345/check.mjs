// CDP check v345 (Electron / production): 撤销到上次保存 + 撤销链卫生
//   根因回顾:
//     A 类 — editor 字段 (beatDivisor/timelineZoom/distanceSpacing/gridSize) 直写只 emit 不 pushUndo,
//       改动前的值永远不进快照 → Ctrl+Z 到底 ≠ 保存态 (脏标记永不消)
//     B 类 — 变换预览会话中选区不变的入栈路径 (预览中编辑快捷键/Ctrl+S) 快照带预览态
//     C 类 — 空拖拽 store.undo() 弹栈会污染 redoStack / 误弹拖拽期间入栈的他人快照
//   修复: setEditorField 统一入 undo (同字段 800ms 连写合并); pushUndo 无条件回滚预览;
//     save 先回滚预览; 预览会话屏蔽编辑快捷键; cancelDragNoop 深度配对弹栈
// 运行: npm run build 后 node verifier/v345/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9447;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(1); }
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
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
  buttons: type === 'mouseReleased' ? 0 : 1,
});
const key = (type, k, code, vk, mod = 0) => send('Input.dispatchKeyEvent', {
  type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod,
});

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 干净基线: load 会设 savedFingerprint + 清栈 (等价于「上次保存」)
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    store.load({ ...base, hitObjects: [
      { ...tc, id: 888001, time: 5000, x: 200, y: 192 },
      { ...ts, id: 888002, time: 6000, x: 312, y: 192, curvePoints: [{ x: 380, y: 150 }], curveType: 'L', slides: 1, length: 100 },
    ] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(5000);
  })()`);
  await sleep(300);

  // 基线值 (载入的谱面 editor 字段未必是默认 4/1)
  const baseDivisor = await evalJs('window.__osuStore.beatmap.editor.beatDivisor');
  const baseZoom = await evalJs('window.__osuStore.beatmap.editor.timelineZoom ?? 1');
  console.log('  基线 beatDivisor:', baseDivisor, 'timelineZoom:', baseZoom);

  // ---- 场景 1 (A 类): 改节拍细分 → 放物件 → 撤销到底应回到干净基线 ----
  await evalJs(`window.__osuStore.beatSnap = ${baseDivisor === 8 ? 4 : 8}`); // setter → setEditorField (修复前直写不入栈)
  await evalJs(`(() => {
    const store = window.__osuStore;
    const tc = store.beatmap.hitObjects[0];
    store.addObject({ ...tc, id: 888003, time: 7000, x: 256, y: 100 });
  })()`);
  assert(await evalJs('window.__osuStore.dirty'), '改动后脏标记置位');
  await evalJs('window.__osuStore.undo()'); // 撤销放物件
  await evalJs('window.__osuStore.undo()'); // 撤销改细分
  await sleep(200);
  assert(await evalJs('window.__osuStore.dirty') === false, '撤销到底后回到干净基线 (修复前永远脏)');
  assert(await evalJs('window.__osuStore.beatmap.editor.beatDivisor') === baseDivisor, `beatDivisor 撤销回基线 ${baseDivisor}`);
  assert(await evalJs('window.__osuStore.canUndo') === false, '撤销栈已空 (无冗余条目)');

  // ---- 场景 2: 同字段连写合并 (timelineZoom 连改 3 次 = 一条撤销) ----
  await evalJs(`(() => { const s = window.__osuStore;
    s.setEditorField('timelineZoom', ${baseZoom} * 1.25); s.setEditorField('timelineZoom', ${baseZoom} * 1.56); s.setEditorField('timelineZoom', ${baseZoom} * 2);
  })()`);
  await evalJs('window.__osuStore.undo()');
  await sleep(150);
  const z = await evalJs('window.__osuStore.beatmap.editor.timelineZoom ?? 1');
  assert(Math.abs(z - baseZoom) < 1e-6, `滚轮连写合并为一条撤销 (undo 一次回基线 ${baseZoom}, 实际 ${z})`);
  assert(await evalJs('window.__osuStore.dirty') === false, '撤销后回到干净基线');

  // ---- 场景 3 (B 类): 预览中发生入栈 → 预览态不进快照 ----
  await evalJs('window.__osuStore.select([888002])');
  await evalJs('window.__osuStore.openTransformDialog("rotate")');
  await sleep(400);
  await evalJs(`(() => {
    const el = document.querySelector('[data-dialog="rotate-dlg"] [data-conv="angle"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '45'); el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const previewPos = await evalJs('window.__osuStore.beatmap.hitObjects.find(o => o.id === 888002).x');
  assert(previewPos !== 312, `预览生效 (滑条头 x=${previewPos} ≠ 312)`);
  await evalJs('window.__osuStore.pushUndo()'); // 模拟预览中入栈 (如预览中改细分)
  const afterPush = await evalJs('window.__osuStore.beatmap.hitObjects.find(o => o.id === 888002).x');
  assert(afterPush === 312, `入栈前预览已回滚 (x=${afterPush} = 312, 快照不带预览态)`);
  await evalJs('window.__osuStore.closeTransformDialog()');
  await evalJs('window.__osuStore.undo()'); // 弹掉上面 pushUndo 的冗余条目 (内容同基线)
  await sleep(150);
  assert(await evalJs('window.__osuStore.dirty') === false, '关窗回滚+撤销后回到干净基线');

  // ---- 场景 4 (C 类): 单击物件 (空拖拽) 不污染 redo 栈 ----
  // 先做一步真实改动再撤销, 制造 redo 内容, 然后 redo 掉, 再单击物件 — canRedo 应保持 false
  await evalJs(`(() => { const s = window.__osuStore;
    const tc = s.beatmap.hitObjects[0];
    s.addObject({ ...tc, id: 888004, time: 8000, x: 400, y: 300 });
  })()`);
  const hit = await evalJs(`(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__osuToCanvas(200, 192);
    return { x: r.left + p.x, y: r.top + p.y };
  })()`);
  await mouse('mousePressed', hit.x, hit.y);
  await sleep(120);
  await mouse('mouseReleased', hit.x, hit.y);
  await sleep(200);
  assert(await evalJs('window.__osuStore.canRedo') === false, '单击物件 (空拖拽) 不产生 redo 冗余项');

  // ---- 场景 5 (B 类): 预览会话中编辑快捷键被屏蔽 ----
  await evalJs('window.__osuStore.select([888001])');
  await evalJs('window.__osuStore.openTransformDialog("rotate")');
  await sleep(400);
  const before = await evalJs('window.__osuStore.beatmap.hitObjects.length');
  await key('rawKeyDown', 'Delete', 'Delete', 46);
  await key('keyUp', 'Delete', 'Delete', 46);
  await sleep(250);
  const after = await evalJs('window.__osuStore.beatmap.hitObjects.length');
  assert(before === after, `预览中 Delete 被屏蔽 (物件数 ${before} → ${after})`);
  await evalJs('window.__osuStore.closeTransformDialog()');

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
  else console.log('  ok: 全程无页面异常');
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v345 全部通过');
process.exit(failures ? 1 : 0);

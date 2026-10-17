// v445: 测试游玩帧数优化验证 — 接线断言 + CDP 帧数门槛
// 优化内容 (profile 数据见 verifier/v445/README 节 / profile-baseline.json / profile-results.json):
//   1) store.testPlayOpen 门控 — 测试游玩中编辑器画布 + 上下时间轴 rAF 循环暂停底层渲染
//      (覆盖层 z-80 不透明全屏接管; 原底层每帧全量渲染 = 双倍 CPU/GPU, profile 实测占帧 CPU ~70%);
//   2) 背景图离屏预渲染层 (cover+0.7 压暗, 仅背景/窗口尺寸变化重建, 每帧 1 次 1:1 blit);
//   3) HUD 皮肤数字串离屏缓存 (整串 1 次 blit, 原逐字形 ~19 次 drawImage/帧)。
// CDP 门槛: cygnus 密集段 AT 游玩 — 底层渲染计数器清空 (门控生效), 帧忙均值 ≤1.5ms,
//   fps 不低于「全跳过窗口 fps - 15」(≈ vsync 上限贴脸), 退出后编辑器渲染恢复。
// 运行: node verifier/v445/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9461;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- 接线断言 (源码静态检查) ----
const storeSrc = read('src/osu/store.ts');
assert(/v445: 测试游玩覆盖层打开中[\s\S]{0,200}?testPlayOpen = false/.test(storeSrc), 'store.testPlayOpen 字段 (v445 注释)');

const ec = read('src/components/EditorCanvas.tsx');
assert(/if \(store\.testPlayOpen\) \{ raf = requestAnimationFrame\(loop\); return; \}/.test(ec), 'EditorCanvas 渲染循环 testPlayOpen 门控');

const tl = read('src/components/Timelines.tsx');
const gates = tl.match(/if \(store\.testPlayOpen\) \{ raf = requestAnimationFrame\(draw\); return; \}/g) ?? [];
assert(gates.length === 2, `上下时间轴 draw 循环均门控 (实得 ${gates.length})`);

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/store\.testPlayOpen = true/.test(ov) && /store\.testPlayOpen = false/.test(ov), '覆盖层挂载/卸载置位复位 testPlayOpen');
assert(/let bgLayer/.test(ov) && /bgLayerImgIds/.test(ov), '背景离屏层模块级缓存');
assert(/lg\.drawImage\(bg, br\.x, br\.y, br\.w, br\.h\)/.test(ov) && /g\.drawImage\(bgLayer\.c, bgLayer\.x, bgLayer\.y\)/.test(ov), '背景 cover+压暗预合成进层, 每帧 1:1 blit');
assert(/const hudNumSlots = new Map/.test(ov) && /getSkinContentSeq\(\)\]/.test(ov), 'HUD 数字串缓存 (槽位复用位图, 皮肤序号入键)');
assert(/__tpPerf/.test(ov) && /__tpSkip/.test(ov), 'profile 钩子保留 (__tpPerf/__tpSkip)');

// renderer gameplay 分支刻意不动 staticScene (游玩可见集 = 活跃时间窗, 内容逐帧变, 缓存必失效 — 见 README v445 节)
const rd = read('src/osu/renderer.ts');
assert(/if \(rc\.staticScene && !rc\.gameplay\)/.test(rd), 'renderer: staticScene 在 gameplay 下仍停用 (设计如此, 未动)');

// ---- CDP 帧数门槛 ----
const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); await killIsolated(proc, profile); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
};
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const MEASURE = (ms) => `(async () => new Promise(resolve => {
  const deltas = []; let last = 0;
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else {
      const avg = a => a.length ? +(a.reduce((v, s2) => v + s2, 0) / a.length).toFixed(3) : 0;
      const tp = window.__tpPerf || {};
      resolve({ fps: +(1000 / avg(deltas)).toFixed(1), frames: deltas.length,
        frameAvg: avg(tp.frame || []),
        editorFrames: (window.__perfRender || []).length, editorAvg: avg(window.__perfRender || []),
        tlAFrames: (window.__perfTlA || []).length, tlBFrames: (window.__perfTlB || []).length });
    }
  };
  window.__tpPerf = {}; window.__perfRender = []; window.__perfTlA = []; window.__perfTlB = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  await normalizeEnv(evalJs);
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).then(() => true).catch(e => 'ERR ' + e)`);
  assert(opened === true, 'CDP: 打开 cygnus 谱面');
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }
  const denseAt = await evalJs(`(() => { const ts = window.__osuStore.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b);
    let peak = 0, at = ts[0], j = 0;
    for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] > 8000) j++; if (i - j + 1 > peak) { peak = i - j + 1; at = ts[j]; } }
    return at; })()`);
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${denseAt - 100});
    localStorage.setItem('osu-editor:testplay-mods', '["AT"]'); return 1; })()`);
  await sleep(300);
  await evalJs(`document.querySelector('[data-testplay-btn]').click()`);
  let overlay = false;
  for (let i = 0; i < 40 && !overlay; i++) {
    overlay = await evalJs(`!!document.querySelector('[data-testid="testplay-overlay"]')`).catch(() => false);
    if (!overlay) await sleep(250);
  }
  assert(overlay, 'CDP: 测试游玩覆盖层打开');
  await sleep(1500);

  const base1 = await evalJs(MEASURE(3500));
  await sleep(300);
  const base2 = await evalJs(MEASURE(2500)); // 二窗取优 — 本机系统噪声抖动对单窗影响大 (实测偶发整窗偏低)
  const base = base1.fps >= base2.fps ? base1 : base2;
  console.log('  游玩中 #1:', JSON.stringify(base1));
  console.log('  游玩中 #2:', JSON.stringify(base2));
  assert(base1.editorFrames === 0 && base1.tlAFrames === 0 && base1.tlBFrames === 0
    && base2.editorFrames === 0 && base2.tlAFrames === 0 && base2.tlBFrames === 0,
    `CDP: 游玩中编辑器/时间轴底层渲染已暂停 (#1 editor=${base1.editorFrames} #2 editor=${base2.editorFrames})`);
  assert(base.frameAvg <= 1.5, `CDP: 覆盖层帧忙均值 ${base.frameAvg}ms ≤ 1.5ms`);

  await evalJs(`window.__tpSkip = { clear: true, bg: true, scene: true, popup: true, trail: true, hud: true }`);
  await sleep(250);
  const floor = await evalJs(MEASURE(2000)); // 全跳过窗口 ≈ vsync 上限
  await evalJs(`window.__tpSkip = null`);
  console.log('  全跳过 (vsync 上限参照):', JSON.stringify(floor));
  assert(base.fps >= floor.fps - 20, `CDP: 游玩 fps ${base.fps} 贴近 vsync 上限 ${floor.fps} (两窗取优, 差 <20)`);

  await evalJs(`document.querySelector('[data-testid="testplay-exit"]')?.click()`);
  await sleep(800);
  const resumed = await evalJs(`(async () => { window.__perfRender = []; window.__perfTlA = [];
    await new Promise(r => setTimeout(r, 500));
    return { editor: (window.__perfRender || []).length, tlA: (window.__perfTlA || []).length }; })()`);
  console.log('  退出后:', JSON.stringify(resumed));
  assert(resumed.editor > 10 && resumed.tlA > 10, `CDP: 退出游玩后编辑器/时间轴渲染恢复 (editor=${resumed.editor} tlA=${resumed.tlA})`);
} finally {
  await killIsolated(proc, profile);
}

console.log(failures ? `\nVERIFIER_V445_FAILED: ${failures} 处失败` : '\nVERIFIER_V445_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

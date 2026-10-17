// v445: 测试游玩帧数 profile — CDP 驱动隔离 Electron, 分阶段采样/跳过定位瓶颈
// 场景:
//   R = 真实难图 cygnus (786 物件, 峰值 13 obj/s, AR10, 真实背景 jpg) — 用户实测过的图;
//   S = 合成 12 obj/s × 60s 连打 (720 圈 + 每 8 个 1 滑条, 注入 1920x1080 背景) — 持续密度压力。
// 两场景均 AT mod (autoplay) — 命中爆炸/泛光/判定弹出全部触发, 是最重视觉路径。
// 每阶段输出: fps (rAF 间隔) + 覆盖层各分段耗时 (window.__tpPerf: clear/bg/scene/popup/trail/hud/frame)
//   + 下层编辑器/时间轴每帧耗时 (__perfRender/__perfTlA/__perfTlB — 游玩中仍在跑的浪费渲染)。
// 跳过阶段 (window.__tpSkip) 用于测该阶段对端到端 fps 的影响 (含 GPU/合成器侧, __tpPerf 只反映 CPU)。
// 运行: node verifier/v445/profile.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9460;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
}

// 采样窗口: rAF 间隔 fps + 各分段耗时均值/p95 (采样开始时清零各计数器)
const MEASURE = (ms) => `(async () => new Promise(resolve => {
  const deltas = []; let last = 0;
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else {
      const s = a => [...a].sort((x, y) => x - y);
      const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3) : 0;
      const avg = a => a.length ? +(a.reduce((v, s2) => v + s2, 0) / a.length).toFixed(3) : 0;
      const tp = window.__tpPerf || {};
      const stages = {};
      for (const k of ['clear', 'bg', 'scene', 'popup', 'trail', 'hud', 'frame'])
        stages[k] = { avg: avg(tp[k] || []), p95: q(s(tp[k] || []), 0.95) };
      resolve({
        frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1), deltaP95: q(s(deltas), 0.95),
        stages,
        editorRender: { avg: avg(window.__perfRender || []), p95: q(s(window.__perfRender || []), 0.95) },
        tlA: avg(window.__perfTlA || []), tlB: avg(window.__perfTlB || []),
      });
    }
  };
  window.__tpPerf = {}; window.__perfRender = []; window.__perfTlA = []; window.__perfTlB = [];
  requestAnimationFrame(tick);
}))()`;

const results = { env: {}, scenarios: {} };

async function enterTestPlay(editorTimeMs) {
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${editorTimeMs});
    localStorage.setItem('osu-editor:testplay-mods', '["AT"]'); return 1; })()`);
  await sleep(300);
  await evalJs(`document.querySelector('[data-testplay-btn]').click()`);
  for (let i = 0; i < 40; i++) {
    if (await evalJs(`!!document.querySelector('[data-testid="testplay-overlay"]')`).catch(() => false)) break;
    await sleep(250);
  }
  const ok = await evalJs(`!!document.querySelector('[data-testid="testplay-overlay"]')`);
  if (!ok) throw new Error('测试游玩覆盖层未出现');
  await sleep(1200); // seek/音频起播稳定
}
async function exitTestPlay() {
  await evalJs(`window.__tpSkip = null; document.querySelector('[data-testid="testplay-exit"]')?.click()`);
  await sleep(600);
}
async function runStages(name, windowsMs) {
  const out = {};
  out.baseline = await evalJs(MEASURE(windowsMs.baseline ?? 3500));
  console.log(`  [${name}] baseline:`, JSON.stringify(out.baseline));
  for (const [stage, skip] of windowsMs.stages) {
    await evalJs(`window.__tpSkip = ${JSON.stringify(skip)}`);
    await sleep(250);
    out[stage] = await evalJs(MEASURE(windowsMs.ms ?? 2500));
    console.log(`  [${name}] skip ${stage}:`, JSON.stringify({ fps: out[stage].fps, deltaP95: out[stage].deltaP95, frameAvg: out[stage].stages.frame.avg }));
  }
  await evalJs(`window.__tpSkip = null`);
  return out;
}

try {
  await send('Runtime.enable');
  await normalizeEnv(evalJs);
  results.env = await evalJs(`({ dpr: window.devicePixelRatio, win: window.innerWidth + 'x' + window.innerHeight,
    ua: navigator.userAgent.slice(0, 60) })`);
  console.log('env:', JSON.stringify(results.env));

  // ---- 场景 R: 真实难图 cygnus ----
  console.log('== 场景 R: cygnus - Book of Dark Magic [Magic] (默认皮肤) ==');
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).then(() => true).catch(e => 'ERR ' + e)`);
  if (opened !== true) throw new Error('打开谱面失败: ' + opened);
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }
  const bmInfo = await evalJs(`(() => { const bm = window.__osuStore.beatmap; return {
    objects: bm.hitObjects.length, ar: bm.difficulty.ar, cs: bm.difficulty.cs,
    hasBg: !!window.__osuStore.backgroundImg, bgSize: window.__osuStore.backgroundImg
      ? window.__osuStore.backgroundImg.width + 'x' + window.__osuStore.backgroundImg.height : null }; })()`);
  console.log('  beatmap:', JSON.stringify(bmInfo));
  // 最密 8s 窗口起点 (Node 侧已算过 ~35s, 页内重算保证与解析一致)
  const denseAt = await evalJs(`(() => { const ts = window.__osuStore.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b);
    let peak = 0, at = ts[0], j = 0;
    for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] > 8000) j++; if (i - j + 1 > peak) { peak = i - j + 1; at = ts[j]; } }
    return { at, peak }; })()`);
  console.log('  最密 8s 窗口:', JSON.stringify(denseAt));
  await enterTestPlay(denseAt.at - 100); // editorTime 略前于密集段 (预填不吃掉密集段), 起播点 = editorTime-3s
  results.scenarios.R = await runStages('R', {
    baseline: 4000,
    stages: [['baseline2', {}], ['bg', { bg: true }], ['scene', { scene: true }], ['hud', { hud: true }],
      ['trail+popup', { trail: true, popup: true }], ['all', { clear: true, bg: true, scene: true, popup: true, trail: true, hud: true }]],
  });
  await exitTestPlay();

  // ---- 场景 R2: 同图 + 用户真实皮肤 (光标/拖尾/泛光/皮肤数字全贴图路径) ----
  console.log('== 场景 R2: cygnus + 用户皮肤 (serverDir 通道重应用) ==');
  const skinInfo = await evalJs(`(async () => {
    const dir = { kind: 'directory', name: 'skin',
      getFileHandle: (n) => Promise.resolve({ kind: 'file', name: n, getFile: async () => {
        const res = await fetch('api/local-fs/file?root=skin&rel=' + encodeURIComponent(n));
        if (!res.ok) throw new Error('nf ' + n);
        return new File([await res.blob()], n);
      } }) };
    const r = await window.__osuSkin.applySkinFromDir(dir, 'user-skin');
    const sk = window.__osuSkin.getSkin();
    return { ...r, cursor: !!sk.cursor, cursortrail: !!sk.cursortrail, hitlighting: !!sk.hitlighting,
      scorebar: !!(sk.scorebarBg && sk.scorebarColour), digits: sk.scoreDigits.filter(Boolean).length,
      hit300: !!sk.hit300, hitcircle: !!sk.hitcircle, sliderb: !!sk.sliderb };
  })()`);
  console.log('  skin:', JSON.stringify(skinInfo));
  await enterTestPlay(denseAt.at - 100);
  results.scenarios.R2 = await runStages('R2', {
    baseline: 4000,
    stages: [['baseline2', {}], ['bg', { bg: true }], ['scene', { scene: true }], ['hud', { hud: true }],
      ['trail+popup', { trail: true, popup: true }], ['all', { clear: true, bg: true, scene: true, popup: true, trail: true, hud: true }]],
  });
  await exitTestPlay();

  // ---- 场景 S: 合成 12 obj/s × 60s 连打 ----
  console.log('== 场景 S: 合成 720 物件连打 (12 obj/s × 60s) ==');
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const circle = base.hitObjects.find(o => o.type === 'circle');
    const slider = base.hitObjects.find(o => o.type === 'slider') ?? circle;
    const ho = [];
    for (let i = 0; i < 720; i++) {
      const t = Math.round(3000 + i * (60000 / 720));
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 8 === 7 && slider.type === 'slider')
        ho.push({ ...slider, id: 2000000 + i, time: t, x, y, endTime: t + (slider.endTime - slider.time) });
      else ho.push({ ...circle, id: 2000000 + i, time: t, x, y, endTime: t });
    }
    store.load({ ...base, hitObjects: ho }, store.audioUrl);
    // 注入 1920x1080 合成背景 (cover 重采样路径可复现)
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const cg = cv.getContext('2d');
    const grad = cg.createLinearGradient(0, 0, 1920, 1080);
    grad.addColorStop(0, '#303050'); grad.addColorStop(1, '#501030');
    cg.fillStyle = grad; cg.fillRect(0, 0, 1920, 1080);
    for (let i = 0; i < 400; i++) { cg.fillStyle = 'rgba(255,255,255,' + (i % 7) / 40 + ')';
      cg.fillRect((i * 173) % 1920, (i * 97) % 1080, 60, 40); }
    store.backgroundImg = cv;
    return ho.length;
  })()`);
  await sleep(500);
  await enterTestPlay(3000); // 从开头起播 (起播 0s, 3s 起进入连打)
  results.scenarios.S = await runStages('S', {
    baseline: 4000,
    stages: [['scene', { scene: true }], ['bg', { bg: true }], ['all', { clear: true, bg: true, scene: true, popup: true, trail: true, hud: true }]],
  });
  await exitTestPlay();

  fs.writeFileSync(path.join(root, 'verifier/v445/profile-results.json'), JSON.stringify(results, null, 2));
  console.log('\n结果已写 verifier/v445/profile-results.json');
} finally {
  await killIsolated(proc, profile);
}
process.exit(0);

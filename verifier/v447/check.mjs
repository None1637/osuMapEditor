// v447: 内存占用优化验证 — 接线断言 + CDP 功能断言
// 优化内容 (前后数据见 verifier/v447/README 节 / mem-baseline.json / mem-after.json, mem-profile.mjs 同条件复测):
//   1) 变速引擎懒建 + 互斥销毁 — 解码/缓存命中不再预热引擎 (引擎节点各持整份 PCM 副本, 实测 ~48MB/130s@48k);
//      play() 一支路起用即销毁另一支路, setRateAdjustPitch 切换同步销毁; 在途加载用 gen 令牌防复活。
//      首次变速播放走兜底并自动重进; v509 起不变调慢放兜底改 <audio preservesPitch>, 不再原生降调。
//   2) 撤销栈上限 200→50 — 快照 = 六段全表 JSON 深拷贝 (实测 ~0.1MB/条@786物件), 满栈 20MB→5MB。
//   3) 离开频谱模式释放 mono 混合+LRU 列缓存 (waveformData.dropSpectroCols, ~35MB/130s@48k), 重进现算。
// 运行: node verifier/v447/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9464;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- 接线断言 ----
const st = read('src/osu/store.ts');
assert(/v447: 不再预热变速引擎/.test(st), '解码/缓存路径不再预热变速引擎 (v447 注释)');
assert(!/预热当前模式的变速引擎/.test(st), 'v382 预热调用已移除');
assert(/private destroyTempoNode\(\)/.test(st) && /private destroyRateNode\(\)/.test(st), '引擎销毁助手');
assert(/this\.tempoGen\+\+/.test(st) && /this\.rateGen\+\+/.test(st), '销毁令牌自增 (防在途加载复活)');
assert(/gen !== this\.tempoGen/.test(st) && /gen !== this\.rateGen/.test(st), '在途加载 gen 守卫');
assert(/this\.tempoActive = true;\s*\n\s*this\.destroyRateNode\(\)/.test(st), 'play() tempo 支路起用即销毁 rate 引擎');
assert(/this\.rateActive = true;\s*\n\s*this\.destroyTempoNode\(\)/.test(st), 'play() rate 支路起用即销毁 tempo 引擎');
assert(/if \(v\) \{ this\.destroyTempoNode\(\); this\.ensureRateNode\(\); \}/.test(st), 'setRateAdjustPitch 模式互斥销毁');
assert((st.match(/undoStack\.length > 50/g) ?? []).length === 2, '撤销栈上限 200→50 (pushSnapshot + 拖拽预览收口两处)');
assert(!/undoStack\.length > 200/.test(st), '旧 200 上限无残留');
assert(/dropSpectroCols\(this\.audioBuffer\)/.test(st), 'setWaveMode 离开频谱释放列缓存');

const wd = read('src/osu/waveformData.ts');
assert(/export function dropSpectroCols/.test(wd) && /colCache\.delete\(buf\)/.test(wd), 'waveformData.dropSpectroCols 出口');

// ---- CDP 功能断言 ----
const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };
const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
try {
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('CONNECT_FAILED');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const waitFor = async (expr, n = 40) => {
    for (let i = 0; i < n; i++) { if (await evalJs(expr).catch(() => false)) return true; await sleep(500); }
    return false;
  };

  await normalizeEnv(evalJs);
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  assert(await waitFor(`!!window.__osuStore.audioBuffer`), 'cygnus 谱面+音频解码完成');

  // 1) 懒建: 解码后无任何引擎
  const d1 = await evalJs(`window.__osuStore.debugState()`);
  assert(d1.tempoReady === false && d1.rateReady === false, `解码后引擎零常驻 (tempoReady=${d1.tempoReady} rateReady=${d1.rateReady})`);

  // 2) 首次 0.5x 播放: 兜底懒建 tempo 引擎并接管 (音质路径不变)
  await evalJs(`(() => { const s = window.__osuStore; s.setRate(0.5); s.seek(2000); s.play(); })()`);
  assert(await waitFor(`(() => { const d = window.__osuStore.debugState(); return d.tempoReady && d.tempoActive; })()`), '首次变速播放后 tempo 引擎接管 (tempoActive=true)');
  assert(await evalJs(`window.__osuStore.debugState().rateReady`) === false, 'tempo 支路起用时 rate 引擎不存在');

  // 3) DT 语义 (直接置位 rateAdjustPitch, 同 TestPlayOverlay): rate 引擎接管, tempo 引擎被互斥销毁
  await evalJs(`(() => { const s = window.__osuStore; s.rateAdjustPitch = true; s.setRate(1.5); s.play(); })()`);
  assert(await waitFor(`(() => { const d = window.__osuStore.debugState(); return d.rateReady && d.rateActive; })()`), 'DT 变速播放 rate 引擎接管 (rateActive=true)');
  assert(await waitFor(`window.__osuStore.debugState().tempoReady === false`, 4), 'rate 支路起用后 tempo 引擎已销毁 (PCM 副本释放)');

  // 4) setRateAdjustPitch 切回: rate 销毁, tempo 重建
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.setRateAdjustPitch(false); })()`);
  assert(await waitFor(`(() => { const d = window.__osuStore.debugState(); return d.tempoReady && !d.rateReady; })()`), '切回不变调: tempo 重建 / rate 销毁 (互斥)');
  await evalJs(`(() => { const s = window.__osuStore; s.setRate(1); s.pause(); })()`);

  // 5) 撤销栈上限 50, undo/redo 机械路径可用
  const undo = await evalJs(`(() => {
    const s = window.__osuStore;
    for (let i = 0; i < 60; i++) s.pushUndo();
    const capped = s.undoStack.length;
    s.undo();
    const afterUndo = { undoLen: s.undoStack.length, redoLen: s.redoStack.length };
    s.redo();
    const afterRedo = { undoLen: s.undoStack.length, redoLen: s.redoStack.length };
    s.undoStack.length = 0; s.redoStack.length = 0; // 清合成数据
    return { capped, afterUndo, afterRedo };
  })()`);
  assert(undo.capped === 50, `60 次入栈截到 50 (实得 ${undo.capped})`);
  assert(undo.afterUndo.undoLen === 49 && undo.afterUndo.redoLen === 1, `undo 可用 (undo=${undo.afterUndo.undoLen} redo=${undo.afterUndo.redoLen})`);
  assert(undo.afterRedo.undoLen === 50 && undo.afterRedo.redoLen === 0, `redo 可用 (undo=${undo.afterRedo.undoLen} redo=${undo.afterRedo.redoLen})`);

  // 6) 频谱模式往返: 离开释放缓存, 重进现算可用 (渲染不断; 像素级渲染由 v105/v106 覆盖)
  const spec = await evalJs(`(async () => {
    const s = window.__osuStore; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    s.setWaveMode('spectro'); s.seek(30000); await sleep(700);
    s.setWaveMode('wave'); await sleep(150);
    s.setWaveMode('spectro'); s.seek(60000); await sleep(700);
    s.setWaveMode('wave');
    return s.waveMode === 'wave';
  })()`);
  assert(spec === true, '频谱模式往返后渲染循环正常 (无异常)');

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
} finally {
  await killIsolated(proc, profile);
}
process.exit(failures ? 1 : 0);

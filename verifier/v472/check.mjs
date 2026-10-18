// 验证器 v472: 皮肤无 hitcircleselect 时 stable 选中回退 lazer 橙黄圆环
//   需求: 皮肤中没有 hitcircleselect 时回退为 lazer 的选中时橙色环 (原行为: v232 程序化
//   浅蓝圆角方框兜底)。修复: skin.ts makeProceduralBase 不再生成 hitcircleselect
//   (drawHitcircleSelect 移除); renderer.ts drawHitcircleSelectMark 无图时 drawSelectionRing。
// 运行: cd app && node verifier/v472/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9474;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('源码断言');
{
  const skin = readSrc('src/osu/skin.ts');
  assert(/v472: v232 的程序化 hitcircleselect/.test(skin), 'v472 注释在 (skin.ts)');
  assert(!/function drawHitcircleSelect/.test(skin), '程序化选框 drawHitcircleSelect 已移除');
  assert(/hitcircleselect: undefined,/.test(skin), 'makeProceduralBase 不再兜底 (无图 → undefined)');
  const src = readSrc('src/osu/renderer.ts');
  assert(/v472: 皮肤无 hitcircleselect 时回退 lazer 橙黄圆环/.test(src), 'v472 注释在 (renderer.ts)');
  assert(/if \(!img\) \{ drawSelectionRing\(rc\.g, x, y, r\); return; \}/.test(src),
    'drawHitcircleSelectMark 无图回退 drawSelectionRing (默认 #f5a623 橙黄)');
}

section('CDP: 无 hitcircleselect 皮肤 → 选中圆圈画橙黄环');
const { proc: electron, profile } = launchIsolatedElectron(root, DEBUG_PORT);
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); await killIsolated(electron, profile); process.exit(1); }
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
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas && window.__osuSkin)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');
  await normalizeEnv(evalJs);

  // mock 皮肤: 空目录 (无 hitcircleselect.png) — applySkinFromDir 先 resetToProcedural,
  // v472 起程序化兜底已移除 → hitcircleselect 应为 undefined
  const applied = await evalJs(`(async () => {
    const dir = { kind: 'directory', name: 'mock', async *entries() {},
      async getFileHandle(n) { throw new Error('nf'); } };
    const res = await window.__osuSkin.applySkinFromDir(dir, 'mock-empty');
    return JSON.stringify({ ...res, hasSelect: window.__osuSkin.getSkin().hitcircleselect !== undefined });
  })()`);
  console.log('  皮肤应用:', applied);
  assert(JSON.parse(applied).hasSelect === false, '空皮肤应用后 hitcircleselect 为 undefined (无程序化兜底)');

  // 单圆圈 (256,192) t=5000, stable 选中样式, 停在 preempt 选中它
  await evalJs(`(() => {
    const store = window.__osuStore;
    if (window.__osuDisplaySettings) window.__osuDisplaySettings.selectionStyle = 'stable';
    const base = store.beatmap;
    const red = base.timingPoints.find(p => p.uninherited);
    const circle = { ...(base.hitObjects.find(o => o.type === 'circle') || base.hitObjects[0]),
      id: 472001, type: 'circle', time: 5000, x: 256, y: 192 };
    store.load({ ...base, hitObjects: [circle], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(4500);
    store.select([472001]);
  })()`);
  await sleep(600);

  const sample = async (ox, oy) => evalJs(`(() => {
    const cv = document.querySelector('canvas');
    const g = cv.getContext('2d');
    const rect = cv.getBoundingClientRect();
    const sx = cv.width / rect.width;
    const p = window.__osuToCanvas(${ox}, ${oy});
    const d = g.getImageData(Math.floor(p.x * sx) - 2, Math.floor(p.y * sx) - 2, 5, 5).data;
    let n = 0; const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++; }
    return sum.map(v => Math.round(v / n));
  })()`);

  const cs = await evalJs('window.__osuStore.beatmap.difficulty.cs');
  const r = 54.4 - 4.48 * cs;

  // 选中环弧半径 0.8675r (v314), 橙黄 #f5a623 → r 远高于 b; 修复前 = 程序化浅蓝方框 (b>=r) 或无环
  const a = await sample(256, 192 - 0.8675 * r);
  console.log('  正上 0.8675r 采样 [r,g,b]:', a);
  assert(a[0] > a[2] + 60 && a[0] > a[1], `无图回退橙黄环 (r-b=${a[0] - a[2]}, #f5a623 预期 r-b≈210)`);

  // 右侧同半径 — 环是整圆, 另一侧也应橙黄 (排除仅局部残影)
  const b = await sample(256 + 0.8675 * r, 192);
  console.log('  正右 0.8675r 采样 [r,g,b]:', b);
  assert(b[0] > b[2] + 60 && b[0] > b[1], `整圈橙黄环 (右侧 r-b=${b[0] - b[2]})`);
} finally {
  await killIsolated(electron, profile);
}

if (failures) { console.error(`\nV472_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV472_ALL_PASSED');

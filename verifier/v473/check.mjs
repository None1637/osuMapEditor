// 验证器 v473: 修复 v471 挖孔半径过大导致圈附近滑条边框变暗 (暗环)
//   用户反馈: "现在的滑条选取样式不知道为什么旁边有一圈暗暗的 (stable选取样式才有)"。
//   根因: v471 挖孔半径 r+12/q > 圆圈视觉半径, 圈外一圈蓝带 (含外缘辉光) 被误删 → 暗环。
//   修复: 挖孔半径 = 头/尾圈视觉半径 (同物件层公式 r*hitcircleSpriteWidth/128), 孔恰等于
//   圈 footprint — 圈外蓝带完整保留, 圈内由物件层已绘制的圆圈 (白边) 自然接管。
// 运行: cd app && node verifier/v473/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9475;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('源码断言');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/v473: 挖孔半径修正/.test(src) || /v473: 挖孔半径 = 头\/尾圈视觉半径/.test(src), 'v473 注释在');
  assert(/capHoleR: readonly \[number, number\] \| null = stableSel/.test(src)
    && /radius \* hitcircleSpriteWidth\(rc\.skin\.sliderstartcircle\) \/ 128/.test(src)
    && /radius \* hitcircleSpriteWidth\(rc\.skin\.sliderendcircle\) \/ 128/.test(src),
    '调用处挖孔半径 = 头/尾圈视觉半径 (同物件层公式), lazer 传 null');
  assert(/og\.arc\(cap\.x, cap\.y, hr, 0, Math\.PI \* 2\)/.test(src) && !/r \+ 12 \/ q/.test(src),
    '挖孔不再外扩 r+12/q (v471 暗环根因移除)');
}

section('CDP: 暗环消除 (圈外蓝带保留) + 头尾辉光完整');
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

  // mock 皮肤: 256px 半透明粉环 hitcircleselect (同 v471); 其余走程序化回退
  // (hitcircle/sliderstartcircle 未登记固有宽度 → 128-box → 圈视觉半径 = r)
  const applied = await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,140,210,0.7)'; g.lineWidth = 24;
    g.beginPath(); g.arc(128, 128, 68, 0, Math.PI * 2); g.stroke();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'hitcircleselect.png', { type: 'image/png' });
    const dir = { kind: 'directory', name: 'mock', async *entries() {},
      async getFileHandle(n) { if (n === 'hitcircleselect.png') return { kind: 'file', name: n, getFile: async () => file }; throw new Error('nf'); } };
    return JSON.stringify(await window.__osuSkin.applySkinFromDir(dir, 'mock-pink-ring'));
  })()`);
  console.log('  皮肤应用:', applied);

  // 直线滑条 (头 200,192 → 尾 400,192), 选中, 停在 preempt
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const red = base.timingPoints.find(p => p.uninherited);
    const slider = { ...(base.hitObjects.find(o => o.type === 'slider')), id: 473001, time: 5000, x: 200, y: 192,
      curvePoints: [{ x: 400, y: 192 }], curveType: 'L', slides: 1, length: 200 };
    store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(4500);
    store.select([473001]);
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

  // A: 头部正上 0.9r (圈内) — 挖孔保留: 白边+粉辉光 (r>b), 非蓝带
  const a = await sample(200, 192 - 0.9 * r);
  console.log('  头部 0.9r 采样 [r,g,b]:', a);
  assert(a[0] > a[2] + 10, `头部蓝带仍挖除 (辉光完整, r-b=${a[0] - a[2]})`);

  // B: 身体中段上方 0.8675r — 蓝带保留
  const b = await sample(300, 192 - 0.8675 * r);
  console.log('  身体 0.8675r 采样 [r,g,b]:', b);
  assert(b[2] > b[0] + 40, `身体蓝色边框高亮保留 (b-r=${b[2] - b[0]})`);

  // C: 暗环检查 — 头旁圈外蓝带点 (距头 1.055r > 圈半径 r; v471 的 r+12/q 孔会误删此处蓝带)。
  //   该点在辉光带 (≤1.25r) 内, 粉色辉光压在蓝带上会混淆单点色断言, 故与同距离无蓝带处
  //   (头部正上 1.055r, 只有辉光) 对比: 蓝带在则 b 通道显著更高
  const c1 = await sample(200 + 0.6 * r, 192 - 0.8675 * r);
  const cRef = await sample(200, 192 - 1.055 * r);
  console.log('  头旁圈外 (蓝带+辉光) [r,g,b]:', c1, ' 正上同距 (仅辉光) [r,g,b]:', cRef);
  assert(cRef[0] > cRef[2], `参照点确为辉光粉 (r-b=${cRef[0] - cRef[2]})`);
  assert(c1[2] - cRef[2] > 30, `暗环消除: 圈外蓝带保留 (b 通道差=${c1[2] - cRef[2]}; v471 挖除时≈0)`);

  // D: 尾部正上 0.9r — 同头部挖除
  const d = await sample(400, 192 - 0.9 * r);
  console.log('  尾部 0.9r 采样 [r,g,b]:', d);
  assert(d[0] > d[2] + 10, `尾部蓝带仍挖除 (r-b=${d[0] - d[2]})`);
} finally {
  await killIsolated(electron, profile);
}

if (failures) { console.error(`\nV473_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV473_ALL_PASSED');

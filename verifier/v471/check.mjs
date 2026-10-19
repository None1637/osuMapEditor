// 验证器 v471: stable 选中滑条的蓝色边框高亮不包头/尾圆区 — hitcircleselect 辉光不被切断
//   用户反馈 (真实皮肤 a(No hitsound)): hitcircleselect 会被蓝色的滑条边框覆盖部分。
//   CDP 探针实证: v305 的 cover 蓝带 (0.81..0.925r 不透明) 包住头/尾圈, 半透明辉光带
//   (0.88..1.24r) 被切成内外两截; stable 实机头/尾保持原白边, 辉光完整压在上层。
//   修复: sliderOutlineSprite 加 excludeCaps (stable 选中时传入) — cover 蓝带建成后
//   destination-out 挖掉头/尾 r+12/q 圆盘 (连辉光), 蓝带只沿身体; 缓存键加标志位。
// 运行: cd app && node verifier/v471/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9473;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('源码断言');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/v471: excludeCaps/.test(src), 'v471 注释在');
  // v473: excludeCaps 布尔参数改为 capHoleR 半径对 (挖孔半径 = 圆圈视觉半径, 不再 r+12/q 外扩)
  assert(/function sliderOutlineSprite\(points: \{ x: number; y: number \}\[\], r: number, color: string, cover: boolean, cacheId: number, ss: number, capHoleR: readonly \[number, number\] \| null = null\)/.test(src),
    'sliderOutlineSprite 挖孔参数 (v471 excludeCaps → v473 capHoleR 半径对)');
  assert(/capHoleR \? capHoleR\[0\]\.toFixed\(1\)/.test(src), 'sprite 缓存键含挖孔半径 (v473)');
  assert(/if \(capHoleR && points\.length >= 2\) \{/.test(src) && /destination-out';\s*og\.lineWidth = r \* 2 \* 0\.81;\s*trace\(\);\s*if \(capHoleR/.test(src),
    'cover 分支内挖孔在镂空之后');
  assert(/og\.arc\(cap\.x, cap\.y, hr, 0, Math\.PI \* 2\)/.test(src), '挖孔半径 = 圆圈视觉半径 hr (v473; v471 的 r+12/q 已修正)');
  assert(/sliderOutlineSprite\(p\.points, radius, stableSel \? '#4a90e2' : '#4df3ff', stableSel, o\.id, g\.getTransform\(\)\.a, capHoleR\)/.test(src),
    '调用处 stable 模式传挖孔半径 (lazer 传 null 不变)');
}

section('CDP: 头部蓝带消失 (辉光完整) + 身体蓝带保留');
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

  // mock 皮肤: 256px 半透明粉环 (带 0.44~0.62 半宽, 仿用户皮肤) — 走 applySkinFromDir 登记固有宽度 256 → 4r 绘制
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
    const slider = { ...(base.hitObjects.find(o => o.type === 'slider')), id: 471001, time: 5000, x: 200, y: 192,
      curvePoints: [{ x: 400, y: 192 }], curveType: 'L', slides: 1, length: 200 };
    store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(4500);
    store.select([471001]);
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

  // A: 头部正上 0.9r (蓝带 0.81..0.925r 区域) — 修复后挖孔: 白边+粉辉光 (r>b); 修复前蓝带 (b>>r)
  const a = await sample(200, 192 - 0.9 * r);
  console.log('  头部 0.9r 采样 [r,g,b]:', a);
  assert(a[0] > a[2] + 10, `头部蓝带已挖除 (辉光完整, r-b=${a[0] - a[2]}; 修复前蓝带 r-b≈-152)`);

  // B: 身体中段上方 0.8675r — 蓝色高亮保留 (b>>r)
  const b = await sample(300, 192 - 0.8675 * r);
  console.log('  身体 0.8675r 采样 [r,g,b]:', b);
  assert(b[2] > b[0] + 40, `身体蓝色边框高亮保留 (b-r=${b[2] - b[0]})`);

  // C: 尾部正上 0.9r — 同头部挖除
  const c2 = await sample(400, 192 - 0.9 * r);
  console.log('  尾部 0.9r 采样 [r,g,b]:', c2);
  assert(c2[0] > c2[2] + 10, `尾部蓝带已挖除 (r-b=${c2[0] - c2[2]})`);
} finally {
  await killIsolated(electron, profile);
}

if (failures) { console.error(`\nV471_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV471_ALL_PASSED');

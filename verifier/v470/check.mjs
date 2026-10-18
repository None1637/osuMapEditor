// 验证器 v470: stable 选中标记 (hitcircleselect) 尺寸 = 128 文件盒 → 2r 圆圈盒, 且压在物件上层
//   用户反馈: 选中效果和 stable 不一致 — 滑条边框盖住了选中效果 (图一本编辑器 图二 stable)。
//   根因: v469 误用 hitcircle 族固有尺寸放大公式 (大贴图 4r 绘制), 用户皮肤的外圈辉光带
//     整体落在滑条边框之外 → 边框上看不到选中效果; stable 把 128 文件盒映射到圆圈盒 (2r),
//     辉光带落在边框带上 (CDP 探针实证: 默认皮肤 2r 方框本就压在上层, 问题只在尺寸)。
//   修复: drawHitcircleSelectMark 改 w = 2r; hitcircleselect 移出 INTRINSIC_SIZE_KEYS。
// 运行: cd app && node verifier/v470/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9471;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('源码断言');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/v470: 尺寸改 128 文件盒 = 2r 圆圈盒/.test(src), 'v470 注释在');
  assert(/function drawHitcircleSelectMark\(rc: RenderCtx, x: number, y: number, r: number\)[\s\S]{0,260}const w = r \* 2;/.test(src),
    '选中标记宽度 = 2r (不随贴图固有尺寸放大)');
  assert(!/hitcircleSpriteWidth\(img\)/.test(src.slice(src.indexOf('function drawHitcircleSelectMark'), src.indexOf('function drawSelectionDecor'))),
    'mark 函数内不再用 hitcircleSpriteWidth');
  const sk = readSrc('src/osu/skin.ts');
  assert(!/'hitcircleselect',/.test(sk.slice(sk.indexOf('INTRINSIC_SIZE_KEYS'), sk.indexOf('])', sk.indexOf('INTRINSIC_SIZE_KEYS')))),
    'hitcircleselect 移出 INTRINSIC_SIZE_KEYS');
}

section('CDP: 大贴图选标压在上层且尺寸 = 2r');
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas && window.__osuSkin && window.__osuDisplaySettings)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');
  await normalizeEnv(evalJs);

  // 单滑条场景, 选中, 停在 preempt 期 (圆圈完整显示)
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const red = base.timingPoints.find(p => p.uninherited);
    const slider = { ...(base.hitObjects.find(o => o.type === 'slider')), id: 470001, time: 5000, x: 256, y: 192,
      curvePoints: [{ x: 330, y: 130 }, { x: 420, y: 192 }], curveType: 'B', slides: 1, length: 200 };
    store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(4500);
    store.select([470001]);
  })()`);
  await sleep(500);

  // 注入 512px 大贴图: 红色环带在 0.80~0.90 半宽处 (旧 4r 公式 → 带落在 1.6~1.8r; 新 2r → 0.8~0.9r)
  // 经 __osuDisplaySettings 切换 selectionStyle  bust 装饰层缓存键 (v467 暴露的可变单例, 不持久化)
  await evalJs(`(() => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,0,0,0.6)';
    g.lineWidth = 52; // 带 0.80~0.90 半宽 (512/2=256; 205~230)
    g.beginPath(); g.arc(256, 256, 217.5, 0, Math.PI * 2); g.stroke();
    window.__osuSkin.getSkin().hitcircleselect = c;
    window.__osuDisplaySettings.selectionStyle = 'lazer';
  })()`);
  await sleep(300);
  await evalJs(`window.__osuDisplaySettings.selectionStyle = 'stable'`);
  await sleep(500);

  // 采样头部正上方 0.85r 处 (滑条边框带 0.81~0.925r 上): 新行为 = 红带压在上层 (r-g 大);
  // 旧行为 = 红带在 1.6r 外, 此处是蓝/白边框 (r-g 小/负)
  const probe = await evalJs(`(() => {
    const store = window.__osuStore;
    const r = 54.4 - 4.48 * store.beatmap.difficulty.cs;
    const cv = document.querySelector('canvas');
    const g = cv.getContext('2d');
    const rect = cv.getBoundingClientRect();
    const sx = cv.width / rect.width;
    const head = window.__osuToCanvas(256, 192);
    const up = window.__osuToCanvas(256, 192 - 0.85 * r);
    const px = Math.floor(head.x * sx), py = Math.floor(up.y * sx);
    const d = g.getImageData(px - 2, py - 2, 5, 5).data;
    let rn = 0, sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; rn++; }
    return { r, avg: sum.map(v => Math.round(v / rn)) };
  })()`);
  console.log('  0.85r 采样均值 [r,g,b]:', probe.avg, '(圈半径 osu px:', probe.r.toFixed(1), ')');
  assert(probe.avg[0] - probe.avg[1] > 40 && probe.avg[0] - probe.avg[2] > 40,
    `0.85r 处红色选标压在上层且尺寸=2r (r-g=${probe.avg[0] - probe.avg[1]}, r-b=${probe.avg[0] - probe.avg[2]}; 旧 4r 公式此处无红带)`);

  // 对照: 2.5r 外 (旧 4r 公式的带 1.6~1.8r 与新 2r 的带 0.8~0.9r 之外) 不应有红
  const far = await evalJs(`(() => {
    const store = window.__osuStore;
    const r = 54.4 - 4.48 * store.beatmap.difficulty.cs;
    const cv = document.querySelector('canvas');
    const g = cv.getContext('2d');
    const rect = cv.getBoundingClientRect();
    const sx = cv.width / rect.width;
    const head = window.__osuToCanvas(256, 192);
    const pt = window.__osuToCanvas(256, 192 - 2.5 * r);
    const d = g.getImageData(Math.floor(head.x * sx) - 2, Math.floor(pt.y * sx) - 2, 5, 5).data;
    let rn = 0, sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; rn++; }
    return sum.map(v => Math.round(v / rn));
  })()`);
  console.log('  2.5r 采样均值 [r,g,b]:', far);
  assert(far[0] - far[1] < 40, `2.5r 处无红带 (排除旧 4r 行为; r-g=${far[0] - far[1]})`);
} finally {
  await killIsolated(electron, profile);
}

if (failures) { console.error(`\nV470_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV470_ALL_PASSED');

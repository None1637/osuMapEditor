// v446: 谱面背景图铺满整个画布 (编辑模式 + 测试游玩)
//  - 编辑器: 新全屏背景离屏层 (bgFullLayer, cover 整画布, 固定不随游玩区平移/缩放/旋转),
//    亮度沿用 displaySettings.bgBrightness; 游玩区内额外 0.45 压暗保留在静态层 (物件可读性不变);
//    无背景图维持 #111116 底。
//  - 测试游玩: v445 离屏背景层改为整画布尺寸 (cover 全屏 + 0.7 压暗照旧), 键只含图引用+画布尺寸。
// CDP 像素抽查: 编辑器游玩区外左缘出现背景像素 (偏离 #111116) 且游玩区内更暗 (0.45 压暗);
//   游玩覆盖层角落不再是纯黑 (原只铺游玩区时角落 = #000)。
// 运行: node verifier/v446/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9463;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- 源码断言 ----
const ec = read('src/components/EditorCanvas.tsx');
assert(/let bgFullLayer/.test(ec) && /bgFullImgIds/.test(ec), '编辑器全屏背景离屏层 (bgFullLayer)');
assert(/coverRect\(bgFull\.width, bgFull\.height, lc\.width, lc\.height\)/.test(ec), '编辑器背景 cover 整画布');
assert(/g\.drawImage\(bgFullLayer\.c, 0, 0\)/.test(ec), '全屏背景 identity blit');
assert(/lg\.globalAlpha = displaySettings\.bgBrightness \/ 100/.test(ec), '亮度沿用 bgBrightness (v168 语义)');
// 背景层画在游玩区变换 (含 v391 旋转) 之前 → 固定不随平移/缩放/旋转
const iBg = ec.indexOf('const bgFull = store.backgroundImg');
const iRot = ec.indexOf('if (rot) { g.translate(PW / 2');
assert(iBg > 0 && iRot > 0 && iBg < iRot, '背景层在游玩区变换之前绘制 (不随 v223/v391 变换)');
assert(!/lg\.drawImage\(bg0/.test(ec), '游玩区静态层不再铺背景图 (挪全屏层)');
assert(/rgba\(10,10,16,0\.45\)/.test(ec), '游玩区额外 0.45 压暗保留 (物件可读性)');
assert(/bg0\?\.width \?\? 0/.test(ec), '静态层键仍含背景图有无 (压暗联动失效)');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/coverRect\(bg\.width, bg\.height, lc\.width, lc\.height\)/.test(ov), '游玩背景 cover 整个覆盖层画布');
assert(/const key = \[bid, c\.width, c\.height\]\.join/.test(ov), '游玩背景层键只含图引用+画布尺寸 (不随适配变换)');
assert(/lg\.fillRect\(0, 0, lc\.width, lc\.height\)/.test(ov), '0.7 压暗铺满全屏');
assert(ov.indexOf('store.backgroundImg') < ov.indexOf('renderPlayfield({'), '背景仍在物件之下');
assert(/g\.fillStyle = '#000';/.test(ov), '无背景图维持纯黑 (每帧清屏保留)');

// ---- CDP 像素抽查 ----
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

try {
  await send('Runtime.enable');
  await normalizeEnv(evalJs);
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' }).then(() => true).catch(e => 'ERR ' + e)`);
  assert(opened === true, 'CDP: 打开 cygnus 谱面');
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__osuStore.backgroundImg').catch(() => false)) break;
    await sleep(300);
  }
  assert(await evalJs('!!window.__osuStore.backgroundImg'), 'CDP: 背景图已加载');
  // 暂停在 t=0 (首物件 10.7s, 游玩区无物件, 像素干净)
  await evalJs('window.__osuStore.pause(); window.__osuStore.seek(0); 1');
  await sleep(800);

  // 编辑器画布: 同一点位与「bg cover 合成 → 亮度 alpha → (区内) 0.45 压暗」的理论值逐通道对比
  // (图内容非均匀, 区内/区外直接比亮度无意义 — 改为对合成模型逐点验证)
  const ed = await evalJs(`(() => {
    const cv = [...document.querySelectorAll('canvas')].filter(c => c.width > 500)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const bg = window.__osuStore.backgroundImg;
    if (!cv || !bg) return null;
    const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height;
    const sg = sc.getContext('2d');
    const s = Math.max(cv.width / bg.width, cv.height / bg.height); // coverRect 同公式
    const bw = bg.width * s, bh = bg.height * s;
    sg.drawImage(bg, (cv.width - bw) / 2, (cv.height - bh) / 2, bw, bh);
    const g = cv.getContext('2d');
    const pt = (x, y) => ({ a: [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data],
      b: [...sg.getImageData(Math.round(x), Math.round(y), 1, 1).data] });
    const out = [pt(cv.width * 0.03, cv.height * 0.5), pt(cv.width * 0.03, cv.height * 0.3)];
    const inn = [];
    for (const [ox, oy] of [[200, 150], [300, 250]]) {
      const p = window.__osuToCanvas(ox, oy);
      if (p) inn.push(pt(p.x, p.y));
    }
    return { out, inn, brightness: 0.35, w: cv.width, h: cv.height };
  })()`);
  assert(!!ed && ed.inn.length === 2, 'CDP: 编辑器画布像素采样成功');
  const BASE = [17, 17, 22]; // #111116 编辑器底色
  // 期望: 区外 = 0.35*bg + 0.65*#111116; 区内 = 0.45*rgba(10,10,16) + 0.55*区外合成
  const expOut = (b) => b.map((v, i) => Math.round(0.35 * v + 0.65 * BASE[i]));
  const expIn = (b) => expOut(b).map((v, i) => Math.round(0.45 * [10, 10, 16][i] + 0.55 * v));
  const close = (a, e, tol) => a.every((v, i) => i === 3 || Math.abs(v - e[i]) <= tol);
  console.log('  区外[0] 实测', JSON.stringify(ed.out[0].a), '期望', JSON.stringify(expOut(ed.out[0].b)));
  console.log('  区内[0] 实测', JSON.stringify(ed.inn[0].a), '期望', JSON.stringify(expIn(ed.inn[0].b)));
  assert(ed.out.every(p => close(p.a, expOut(p.b), 8)),
    'CDP: 游玩区外 = 背景 cover 全屏合成 (亮度 0.35 语义不变)');
  assert(ed.inn.every(p => close(p.a, expIn(p.b), 8)),
    'CDP: 游玩区内 = 背景 + 额外 0.45 压暗 (物件可读性保留)');

  // 编辑器截图留证 (读后清理)
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'verifier/v446/shot-editor.png'), Buffer.from(shot1.result.data, 'base64'));

  // 测试游玩: 覆盖层角落不再是纯黑
  await evalJs(`document.querySelector('[data-testplay-btn]').click()`);
  for (let i = 0; i < 40; i++) {
    if (await evalJs(`!!document.querySelector('[data-testid="testplay-overlay"]')`).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(1500);
  const tp = await evalJs(`(() => {
    const cv = document.querySelector('[data-testid="testplay-overlay"] canvas');
    if (!cv) return null;
    const g = cv.getContext('2d');
    const px = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    return { corners: [px(cv.width * 0.02, cv.height * 0.02), px(cv.width * 0.98, cv.height * 0.02),
      px(cv.width * 0.02, cv.height * 0.98), px(cv.width * 0.98, cv.height * 0.98)], w: cv.width, h: cv.height };
  })()`);
  assert(!!tp, 'CDP: 游玩覆盖层像素采样成功');
  console.log('  游玩 四角:', JSON.stringify(tp.corners));
  assert(tp.corners.every(p => Math.max(p[0], p[1], p[2]) > 12),
    'CDP: 游玩四角不再是纯黑 (背景铺满整个覆盖层; v445 前 = #000)');

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'verifier/v446/shot-testplay.png'), Buffer.from(shot2.result.data, 'base64'));
} finally {
  await killIsolated(proc, profile);
}

console.log(failures ? `\nVERIFIER_V446_FAILED: ${failures} 处失败` : '\nVERIFIER_V446_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

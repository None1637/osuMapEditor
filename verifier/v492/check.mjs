// 验证器 v492: 测试游玩 HUD 锚窗口四缘 (lazer 默认布局)
//   - 左上血条 / 右上分数+acc / 左下 combo / 底边全宽进度条 (原锚游玩区四角, 游玩区居中时悬在半空)
//   - CDP: 进入测试游玩, 读取覆盖层画布像素 — 底边进度条横贯 >70% 宽; 右上/左下/左上有 HUD 亮点
// 运行: npm run build 后 node verifier/v492/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码');
{
  const c = read('src/components/TestPlayOverlay.tsx');
  assert(/mX = 8, mTop = 8 \* scale, comboBot = r\.height - 12 \* scale/.test(c), '窗口边缘留白常量 (mX/mTop/comboBot)');
  assert(!/by = oy - 20 \* scale/.test(c), '血条不再锚游玩区顶上方');
  assert(/drawSkinNumber\('score', String\(sc\.score\)\.padStart\(8, '0'\), r\.width - 8, mTop/.test(c), '分数锚窗口右上');
  assert(/drawSkinNumber\('acc', .*, r\.width - 8, mTop \+ 28 \* scale/.test(c), 'acc 锚窗口右上 (分数下)');
  assert(/drawSkinNumber\('combo', `\$\{sc\.combo\}x`, mX, comboBot - 20 \* scale/.test(c), 'combo 锚窗口左下');
  assert(/const bw = r\.width, bh = 3 \* scale/.test(c) && /bx = 0, by = r\.height - bh - 1/.test(c), '进度条铺满窗口底边');
  assert(!/PW \* scale \* 0\.6/.test(c), '旧居中 60% 宽进度条已移除');
}

section('CDP: HUD 像素位置');
{
  const PORT = 9505;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-testplay-btn]').click();
      await sleep(1200); // 进入游玩 + 若干帧
      const out = { open: store.testPlayOpen === true };
      // 覆盖层画布 = 铺满窗口的最后一张 canvas
      const c = [...document.querySelectorAll('canvas')].filter(x => {
        const b = x.getBoundingClientRect();
        return b.width > innerWidth * 0.9 && b.height > innerHeight * 0.9;
      }).pop();
      if (!c) return { ...out, fail: 'no overlay canvas' };
      const ctx = c.getContext('2d');
      const w = c.width, h = c.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      const bright = (x, y) => { const i = (y * w + x) * 4; return img[i] + img[i + 1] + img[i + 2]; };
      // 1) 底边进度条: 底部 8 设备行内, 亮点(轨道 α0.25 压黑≈64/通道, 已播放段更亮) 横贯比例
      let cols = 0;
      for (let x = 0; x < w; x += 4) {
        for (let y = h - 8; y < h; y++) if (bright(x, y) > 110) { cols++; break; }
      }
      out.progressSpan = cols / (w / 4);
      // 2) 右上分数/acc: 右上角区域有白字
      let tr = 0;
      for (let y = 0; y < h * 0.09; y += 2) for (let x = Math.floor(w * 0.8); x < w; x += 2) if (bright(x, y) > 500) tr++;
      out.topRight = tr;
      // 3) 左下 combo: 左下角区域有白字 (0x)
      let bl = 0;
      for (let y = Math.floor(h * 0.88); y < h - 10; y += 2) for (let x = 0; x < w * 0.09; x += 2) if (bright(x, y) > 400) bl++;
      out.bottomLeft = bl;
      // 4) 左上血条: 左上角区域有非黑内容 (皮肤条或回退绿条)
      let tl = 0;
      for (let y = 0; y < h * 0.06; y += 2) for (let x = 0; x < w * 0.3; x += 2) if (bright(x, y) > 130) tl++;
      out.topLeft = tl;
      // 退出
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await sleep(300);
      out.closed = store.testPlayOpen === false;
      return out;
    })()`);

    assert(out.open === true, `进入测试游玩 (${out.fail || 'ok'})`);
    assert(out.progressSpan > 0.7, `进度条铺满底边 (横贯 ${(out.progressSpan * 100).toFixed(0)}% > 70%)`);
    assert(out.topRight > 20, `右上角有分数/acc 白字 (亮点 ${out.topRight})`);
    assert(out.bottomLeft > 5, `左下角有 combo 白字 (亮点 ${out.bottomLeft})`);
    assert(out.topLeft > 20, `左上角有血条 (亮点 ${out.topLeft})`);
    assert(out.closed === true, 'Esc 退出游玩');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V492_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V492_ALL_TESTS_PASSED');

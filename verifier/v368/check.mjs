// 验证器 v368: 游玩区外的滑条 hover 不预览控制点 — 用户反馈游标放在游玩区外 (x>512/y>384)
//  的滑条上时不显示控制点连线/手柄预览 (区内 hover 正常, v259 功能)。
// 根因: refreshHover (EditorCanvas.tsx) 早退门控含 `!cp.inside` — cp.inside = 光标在游玩区矩形
//  (0..512 × 0..384) 内 (onMouseMove 计算); 光标悬停区外滑条时 inside=false → hoverSliderRef/
//  hoverNodeRef 直接清空。hitTest/nearestNode 本身都没有游玩区边界裁剪 (命中纯按 osu 坐标距离),
//  该门控是唯一拦截点; v163 已允许区外渲染/放置预览, hover 预览应同样不受游玩区边界限制
//  (只要光标在画布内且命中滑条; 出画布由 onMouseLeave 清空, v259 原有逻辑不变)。
// 修复: refreshHover 门控去掉 `!cp.inside` — 普通层 (hoverSliderRef 控制点预览) 与 Alt 层
//  (hoverNodeRef 锚点高亮环, 同一门控) 一并恢复; v342 时间门控 (end+HIT_FADE 后消失) 不动。
// 运行: npm run build 后 node verifier/v368/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: refreshHover 门控不再含游玩区边界 (cp.inside)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  const m = ec.match(/const refreshHover = \(\) => \{[\s\S]{0,1400}?\n  \};/);
  assert(!!m, 'refreshHover 定义存在');
  if (m) {
    assert(!/cp\.inside/.test(m[0]), 'refreshHover 不再按 cp.inside (游玩区矩形) 门控 hover');
    assert(/store\.tool !== 'select' \|\| !bm \|\| store\.canvasDragging \|\| store\.conversionDialog/.test(m[0]), '其余门控不变 (工具/拖拽/转换窗)');
  }
  assert(/onMouseLeave=\{\(\) => \{[\s\S]{0,120}?hoverSliderRef\.current = null/.test(ec), '出画布清 hover 不变 (v259)');
  assert(/store\.currentTime <= hitObjectEndTime\(bm, ho\) \+ HIT_FADE/.test(ec), 'v342 时间门控不变 (end+HIT_FADE 后消失)');
  assert(/hoverNodeRef\.current = hn \? \{ objId: hn\.objId, idx: hn\.idx \} : null/.test(ec), 'Alt 层 hoverNodeRef 逻辑不变 (v316, 同一门控修复后区外同样生效)');
}

section('CDP: 区外滑条 hover 出控制点预览 / 区内不变 / Alt 锚点环区外生效');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9451;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
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
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    const mouse = (type, x, y, mods = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, buttons: 0, modifiers: mods });
    const key = (type, mods) => send('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltLeft', modifiers: mods });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await sleep(800); // 布局稳定

    // 双滑条场景: 一条完全在游玩区内 (id 434343), 一条完全在游玩区外右下 (id 434344, x>512 且 y>384)
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = (id, x, y, c1, c2) => ({ id, type: 'slider', x, y, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curvePoints: [c1, c2], curveType: 'B', slides: 1, length: 300 });
      const inside = mk(434343, 200, 192, { x: 260, y: 130 }, { x: 340, y: 192 });
      const outside = mk(434344, 560, 250, { x: 620, y: 190 }, { x: 700, y: 250 }); // x>512 完全在游玩区外右侧
      store.load({ ...base, hitObjects: [inside, outside], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([]); store.setSelectedNodes([]);
      store.seek(5000);
      return true;
    })()`);
    await sleep(400);

    const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas.cursor-crosshair').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
    // hover 预览出现与否 = 控制点 cp1 周边 28x28 区域 hover 前后像素差 (>30 通道差计数; 与 v342 同法)
    const diffAt = async (hoverOx, hoverOy, cpOx, cpOy, mods = 0) => {
      const pH = await toPage(hoverOx, hoverOy);
      const pC = await toPage(cpOx, cpOy);
      const shot = () => evalJs(`(() => {
        const c = document.querySelector('canvas.cursor-crosshair'); const g = c.getContext('2d');
        const r = c.getBoundingClientRect(); const sx = c.width / r.width;
        const cx = ${pC.x} - r.left, cy = ${pC.y} - r.top;
        return Array.from(g.getImageData(Math.floor(cx * sx) - 14, Math.floor(cy * sx) - 14, 28, 28).data);
      })()`);
      await mouse('mouseMoved', 4, 4); await sleep(200); // 先移出 (清 hover 基线)
      const baseShot = await shot();
      await mouse('mouseMoved', pH.x, pH.y, mods); await sleep(250);
      const hoverShot = await shot();
      let n = 0;
      for (let i = 0; i < baseShot.length; i += 4)
        if (Math.abs(hoverShot[i] - baseShot[i]) > 30 || Math.abs(hoverShot[i + 1] - baseShot[i + 1]) > 30 || Math.abs(hoverShot[i + 2] - baseShot[i + 2]) > 30) n++;
      return n;
    };

    // A: 区内滑条 hover — 基线 (区内行为不变)
    const dA = await diffAt(206, 192, 260, 130);
    assert(dA > 20, `A: 区内滑条 hover 控制点预览正常 (差异像素 ${dA} > 20)`);

    // B: 区外滑条 hover (x>512) — 修复前 hoverSliderRef 被 !cp.inside 门控清空, 无预览
    const dB = await diffAt(566, 250, 620, 190);
    assert(dB > 20, `B: 区外滑条 hover 出现控制点预览 (差异像素 ${dB} > 20; 修复前 = 0)`);

    // C: Alt 层在区外同样生效 (v316 同一门控) — Alt 按下后 hover 区外滑条头,
    //    头部区域出现叠加渲染 (锚点高亮环 + 控制点预览; 修复前 hoverNodeRef/hoverSliderRef 同被清空)
    await key('keyDown', 2); // Alt
    await sleep(150);
    const dC = await diffAt(560, 250, 560, 250, 2);
    await key('keyUp', 0);
    assert(dC > 4, `C: Alt 层区外 hover 叠加渲染出现 (头部区域差异像素 ${dC} > 4; 修复前 = 0)`);

    // D: 时间门控不变 — seek 到区外滑条 end+500ms (> HIT_FADE 240), hover 无预览 (v342 语义)
    const dur = await evalJs(`(() => { const s = window.__osuStore; const o = s.beatmap.hitObjects.find(x => x.id === 434344);
      const red = s.beatmap.timingPoints.find(p => p.uninherited);
      return 5000 + 300 / (s.beatmap.difficulty.sliderMultiplier * 100) * red.beatLength; })()`);
    await evalJs(`window.__osuStore.seek(${dur} + 500)`);
    await sleep(300);
    const dD = await diffAt(566, 250, 620, 190);
    assert(dD <= 20, `D: 区外滑条 end+500ms hover 预览已消失 (差异像素 ${dD} ≤ 20, v342 时间门控不变)`);
    await evalJs(`window.__osuStore.seek(5000)`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V368_FAILED: ${failures} 处失败` : '\nVERIFIER_V368_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

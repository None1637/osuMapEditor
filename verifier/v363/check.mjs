// 验证器 v363: 放置预览头部渲染两个修复
//  A) 按住左键手绘拖拽滑条 (freehand: drawCandRef/freehandRef 置 canvasDragging=true) 全程
//     幽灵块被 !store.canvasDragging 跳过 → 预览走 drawPendingSlider 光秃头分支:
//     无 combo 数字, 颜色误取全谱最大 combo 索引+1 而非插入点 (用户实测"黄褐色实心圆圈没数字")。
//     修复: 幽灵块门控放行为 placingDrag (候选/手绘拖拽中仍渲染幽灵), 幽灵在渲染序上覆盖
//     光秃头 (先画不透明底), 头部按"即将到来的物件"渲染 (正确 combo 色+数字), 与落盘一致;
//     拖出游玩区同样保持 (cur.inside || placingDrag)。手绘拟合点带 bspline 标记时幽灵直接按
//     'B4' 渲染控制点列 (与落盘 finishFreehandSlider 同源), 不再经 preserveArcsForBezier 转圆。
//  B) 普通点击放置: 幽灵 time 就近吸附可落到过去节拍 → dt>=0 → sliderHeadHitState/alphaAt
//     把幽灵头当"刚命中"在 240ms 内淡出 (慢 BPM + 1/1 吸附时头整个消失)。
//     修复: 幽灵 time 钳制不早于当前时间 (ghostTime = max(snap, now)); 仅影响预览,
//     落盘 time 公式不动 (稳定吸附语义)。
// 运行: npm run build 后 node verifier/v363/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 手绘拖拽中幽灵不抑制 (Bug A)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const placingDrag = !!\(drawCandRef\.current \|\| freehandRef\.current\);/.test(ec), 'placingDrag = 候选/手绘拖拽中');
  assert(/!store\.playing && \(!store\.canvasDragging \|\| placingDrag\) && !store\.patternDrag/.test(ec), '幽灵门控放行放置中拖拽');
  assert(/cur\.inside \|\| !store\.limitToPlayfield \|\| placingDrag/.test(ec), '手绘拖出游玩区幽灵同样保持');
  assert(/const bspline = store\.pendingSlider\.some\(pt => pt\.bspline\);/.test(ec), '手绘拟合点 bspline 标记检测');
  assert(/const finalCtrl = bspline \? computed\.controlPoints : preserveArcsForBezier\(/.test(ec), '手绘预览跳过 preserveArcsForBezier (不转圆预设贝塞尔)');
  assert(/curveType: bspline \? 'B4' : computed\.curveType/.test(ec), "手绘幽灵按 'B4' 渲染 (与落盘 finishFreehandSlider 同源)");
  const st = read('src/osu/store.ts');
  assert(/pendingSlider: \{ x: number; y: number; redAnchor: boolean; bspline\?: boolean \}\[\]/.test(st), 'pendingSlider 类型含 bspline 可选标记');
}

section('源码: 幽灵 time 钳制不早于当前时间 (Bug B)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const ghostTime = \(snapFn: \(\) => number\) => Math\.max\(Math\.round\(snapFn\(\)\), Math\.round\(store\.currentTime\)\);/.test(ec), 'ghostTime = max(吸附结果, 当前时间)');
  assert(/time: ghostTime\(\(\) => snapTime\(store\.currentTime\)\)/.test(ec), '圆圈幽灵走钳制');
  assert(/time: ghostTime\(\(\) => snapPlacementTime\(bm\.timingPoints, store\.currentTime, store\.beatSnap\)\)/.test(ec), '滑条幽灵走钳制 (落盘公式不动)');
}

section('CDP: 手绘拖拽预览头部 (数字+颜色) / 过去节拍吸附不淡出');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9487;
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
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await sleep(800); // 布局稳定

    // 采样助手注入: 头圈 patch (均值/白色数字笔画计数) — 数字 = 26x26 内 min(r,g,b)>180 像素数
    await evalJs(`(() => {
      window.__v363Sample = (ox, oy) => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const r = c.getBoundingClientRect();
        const g = c.getContext('2d');
        const dpr = c.width / r.width;
        const pt = window.__osuToClient(ox, oy);
        const cx = Math.round((pt.x - r.left) * dpr), cy = Math.round((pt.y - r.top) * dpr);
        const half = Math.round(24 * dpr);
        const d = g.getImageData(cx - half, cy - half, half * 2, half * 2).data;
        let white = 0, sum = 0, mx = 0; const px = [];
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.max(d[i], d[i + 1], d[i + 2]);
          sum += v; if (v > mx) mx = v;
          if (Math.min(d[i], d[i + 1], d[i + 2]) > 180) white++;
          px.push(d[i], d[i + 1], d[i + 2]);
        }
        return { white, mean: sum / (d.length / 4), mx, px };
      };
      window.__v363SampleClient = (clientX, clientY) => {
        const c = document.querySelector('canvas.cursor-crosshair');
        const r = c.getBoundingClientRect();
        const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
        return window.__v363Sample((clientX - p0.x) / (px.x - p0.x), (clientY - p0.y) / (py.y - p0.y));
      };
      window.__v363Diff = (a, b) => {
        let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return s / a.length;
      };
      return true;
    })()`);

    // A1: 手绘拖拽 — 空谱面, 滑条工具, 中心按住连续画弧 (>4px 阈值进 freehand), 按住不放采样头部
    const rA1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider';
      store.pause && store.pause();
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      store.seek(red.time + red.beatLength * 8);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fireW = (type, x, y) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      const fireC = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      fireC('mousemove', cx, cy);
      fireC('mousedown', cx, cy);
      for (let i = 1; i <= 12; i++) { // 弧线: 每步 ~30px, 总 ~360px (画布内移动派发到 canvas — window 级 move 只在已进 freehand/其他拖拽后才转发)
        const a = i / 12 * Math.PI * 0.9;
        fireC('mousemove', cx + Math.sin(a) * 260, cy + (1 - Math.cos(a)) * 160);
        await sleep(30);
      }
      await sleep(300); // rAF 帧渲染
      const head = store.pendingSlider[0];
      const s = head ? window.__v363Sample(head.x, head.y) : null;
      const out = { dragging: store.canvasDragging, nPend: store.pendingSlider.length,
        bsplineMarked: store.pendingSlider.some(p => p.bspline), white: s?.white ?? -1, mean: s?.mean ?? -1, px: s?.px ?? null };
      fireW('mouseup', cx + 260, cy + 160); // 收尾落盘
      await sleep(50);
      return out;
    })()`);
    assert(rA1.dragging && rA1.nPend > 2, `A1: 手绘拖拽进行中 (canvasDragging=true, 拟合点 ${rA1.nPend} > 2)`);
    assert(rA1.bsplineMarked, 'A1: 手绘拟合点带 bspline 标记 (走 B4 预览分支)');
    assert(rA1.white > 8, `A1: 拖拽中预览头圈有白色 combo 数字笔画 (${rA1.white} > 8; 修复前光秃头 ≈0)`);
    assert(rA1.mean > 40, `A1: 拖拽中头圈整体亮度正常 (mean ${rA1.mean.toFixed(1)} > 40, 非暗淡骨架)`);

    // A2: 对照 — 同谱同时间普通点击放头点, 幽灵头部 patch 应与手绘拖拽渲染一致 (同色同数字)
    const rA2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider';
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      store.seek(red.time + red.beatLength * 8);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fireC = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      fireC('mousemove', cx, cy);
      fireC('mousedown', cx, cy); fireC('mouseup', cx, cy); // 放头点
      fireC('mousemove', cx + 400, cy + 150); // 幻影点移远, 不遮挡头部
      await sleep(300);
      const head = store.pendingSlider[0];
      const s = head ? window.__v363Sample(head.x, head.y) : null;
      return { nPend: store.pendingSlider.length, white: s?.white ?? -1, px: s?.px ?? null };
    })()`);
    assert(rA2.nPend === 1, 'A2: 对照组已放头点 (pendingSlider=1)');
    assert(rA2.white > 8, `A2: 对照组头圈有数字 (${rA2.white} > 8)`);
    const patchDiff = await evalJs(`window.__v363Diff(${JSON.stringify(rA1.px)}, ${JSON.stringify(rA2.px)})`);
    assert(patchDiff < 25, `A1/A2: 手绘拖拽预览头部与点击放置逐像素一致 (均值差 ${patchDiff.toFixed(1)} < 25; 修复前黄褐色实心 vs 正确渲染差异巨大)`);

    // B1: 过去节拍吸附 — 圆圈幽灵。beatSnap=1 (1/1), seek 到拍后 0.45 拍 → 就近吸附落到过去拍,
    //     dt≈0.45*beatLength; 修复前头圈按已命中 240ms 内淡出 (几乎不可见), 修复后钳制到 now → 不透明
    const rB1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'circle'; store.beatSnap = 1;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const div = red.beatLength;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fireC = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      const p0 = window.__osuToClient(0, 0), px1 = window.__osuToClient(1, 0);
      const snap = async (t) => { store.seek(t); fireC('mousemove', cx + 3, cy); fireC('mousemove', cx, cy); await sleep(250); return window.__v363SampleClient(cx, cy); };
      const past = await snap(red.time + 8 * div + 0.45 * div);
      const onBeat = await snap(red.time + 8 * div);
      return { div, dtMs: 0.45 * div, pastMx: past.mx, pastMean: past.mean, beatMx: onBeat.mx, beatMean: onBeat.mean };
    })()`);
    assert(rB1.beatMx > 165, `B1: 整拍上圆圈幽灵亮度正常 (max ${rB1.beatMx} > 165, 参照组)`);
    assert(rB1.pastMx > 165, `B1: 吸附落到过去拍 (dt≈${rB1.dtMs.toFixed(0)}ms) 幽灵头圈不淡出 (max ${rB1.pastMx} > 165; 修复前按已命中淡出几乎不可见)`);
    assert(rB1.pastMean > rB1.beatMean * 0.7, `B1: 过去拍吸附预览亮度与整拍一致 (mean ${rB1.pastMean.toFixed(1)} vs ${rB1.beatMean.toFixed(1)})`);

    // B2: 同场景滑条幽灵 — 过去拍吸附下点击放头点, 头圈不淡出
    const rB2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider'; store.beatSnap = 1;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      store.seek(red.time + 8 * red.beatLength + 0.45 * red.beatLength);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fireC = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      fireC('mousemove', cx, cy);
      fireC('mousedown', cx, cy); fireC('mouseup', cx, cy);
      fireC('mousemove', cx + 400, cy + 150);
      await sleep(300);
      const head = store.pendingSlider[0];
      const s = head ? window.__v363Sample(head.x, head.y) : null;
      return { nPend: store.pendingSlider.length, mx: s?.mx ?? -1, white: s?.white ?? -1 };
    })()`);
    assert(rB2.nPend === 1 && rB2.mx > 165, `B2: 过去拍吸附下滑条幽灵头圈不淡出 (max ${rB2.mx} > 165)`);
    assert(rB2.white > 8, `B2: 滑条幽灵头圈数字可见 (${rB2.white} > 8)`);

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

console.log(failures ? `\nVERIFIER_V363_FAILED: ${failures} 处失败` : '\nVERIFIER_V363_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

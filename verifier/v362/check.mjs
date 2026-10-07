// 验证器 v362: 两个回归修复
//  A) 放置滑条幽灵身恢复渲染 — 根因: v318 (afcfed3) 幽灵滑条注入渲染管线时, 控制点列取自
//     computePendingPath().controlPoints (只含已落锚点 pend, 不含 cursor 幻影点) — 只放头点时
//     幽灵退化为 1 控制点零长路径, 滑条身完全不渲染 (用户实测: 骨架在, 滑条身无)。
//     修复: computePendingPath 控制点列/类型推断并入 cursor 幻影点 (pts = pend + 幻影),
//     finishSlider 传 cursor=null 行为不变; v353/v354 渲染改动经像素对照证实无关 (v352 与 v361 渲染逐像素一致)。
//  B) 四侧 UI 覆盖区穿透补全 — v361 只穿透 Alt 切换/框选与整组拖拽; 画布最常见的
//     "选中单个滑条直接拖锚点" (含红锚点成对) 与 Ctrl 加锚点未走穿透, 覆盖区点锚点无响应。
//     修复: onMouseDown 的单滑条节点按下抽为 singleSliderNodePress (与画布共用同一函数),
//     playfieldNodePress 按 onMouseDown 同序补上 (Alt → 整组拖拽 → 单滑条节点按下)。
// 运行: npm run build 后 node verifier/v362/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 幽灵控制点并入幻影点 (Bug A)');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/for \(let i = 0; i < pts\.length; i\+\+\) \{\n\s+controlPoints\.push\(\{ x: pts\[i\]\.x, y: pts\[i\]\.y \}\);/.test(sp), '控制点列遍历 pts (pend + 幻影), 不再只遍历 pend');
  assert(/inferSegmentType\(Math\.max\(2, pts\.length\)\)/.test(sp), '类型推断点数含幻影点 (1 锚点 + 光标 = L 直线身)');
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/computePendingPath\(store\.pendingSlider, cur\.inside \? store\.pendingCursor : null\)/.test(ec), '幽灵构建仍与落盘同源 (finishSlider 传 null 不受影响)');
}

section('源码: 单滑条锚点穿透 (Bug B)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const singleSliderNodePress = \(p: Pt, mods: \{ ctrlKey: boolean; metaKey: boolean \}\): boolean/.test(ec), 'singleSliderNodePress 抽函数存在');
  assert(/if \(singleSliderNodePress\(p, e\)\) return;/.test(ec), '画布 onMouseDown 调用同一函数 (无逻辑分叉)');
  assert(/nodeDragRef\.current = \{ objId: so\.id, pointIndex: hitIdx, pairWith: redPairPartner\(ctrl, hitIdx\)/.test(ec), '锚点拖拽含红锚点成对语义');
  const press = ec.match(/store\.playfieldNodePress = \(cx, cy, mods\) => \{[\s\S]{0,900}?\n    \};/)?.[0] ?? '';
  assert(/nodeAltPress\(p, mods\)/.test(press), '穿透: Alt 切换/框选 (已有)');
  assert(/nodeGroupDragPress\(p\)\) return true;/.test(press), '穿透: 已选节点整组拖拽 (已有)');
  assert(/return singleSliderNodePress\(p, mods\);/.test(press), '穿透: 单滑条锚点拖拽/Ctrl 加锚点 (v362 新增)');
}

section('CDP: 覆盖区单锚点拖拽/Alt/Ctrl/seek/幽灵预览');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9486;
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
    await sleep(800); // 布局稳定 (窗口初始化期间 uiZoom/面板尺寸可能漂移)

    // 造两条滑条: 尾锚点分别落在下时间轴覆盖带 / 左侧栏覆盖区
    const setup = await evalJs(`(() => {
      const store = window.__osuStore;
      const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
      const szx = px.x - p0.x, szy = py.y - p0.y;
      const toOsu = (cx, cy) => ({ x: (cx - p0.x) / szx, y: (cy - p0.y) / szy });
      const bottomC = document.querySelector('canvas.flex-1');
      const br = bottomC.getBoundingClientRect();
      const a1 = toOsu(br.left + br.width / 2, br.top + br.height / 2);
      const side = document.querySelector('div.w-56');
      const sr = side.getBoundingClientRect();
      const a2 = toOsu(sr.left + sr.width / 2, sr.top + Math.min(300, sr.height / 2));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = (id, a, beats) => ({ id, type: 'slider', x: Math.round(a.x), y: Math.round(a.y + 200), time: Math.round(red.time + red.beatLength * beats),
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: Math.round(a.x), y: Math.round(a.y) }], slides: 1, length: 220 });
      store.load({ ...base, hitObjects: [mk(962001, a1, 8), mk(962002, a2, 10)] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      return { a1x: Math.round(a1.x), a1y: Math.round(a1.y), a2x: Math.round(a2.x), a2y: Math.round(a2.y), szx };
    })()`);

    // A: 下时间轴覆盖带 — 选中单滑条 (物件选区, 无节点选区) 直接拖尾锚点, 位移精确 + 不 seek
    const rA = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seek(store.beatmap.hitObjects[0].time);
      store.select([962001]); // 只选物件 — v361 穿透不覆盖此路径 (本 bug)
      const o = store.beatmap.hitObjects.find(x => x.id === 962001);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const t0 = store.currentTime;
      const bottomC = document.querySelector('canvas.flex-1');
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const started = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      await sleep(200); // rAF 帧循环应用 pending
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      await sleep(50);
      return { consumed, started, newX: o.curvePoints[0].x, seeked: store.currentTime !== t0 };
    })()`);
    assert(rA.consumed && rA.started, 'A: 下时间轴按下单滑条锚点 = 穿透拖拽 (事件被吞)');
    assert(Math.abs(rA.newX - (setup.a1x + 60 / setup.szx)) <= 8, `A: 锚点随拖动精确位移 (x ${setup.a1x} → ${rA.newX}, 期望 ≈ +${(60 / setup.szx).toFixed(0)})`);
    assert(!rA.seeked, 'A: 穿透命中后下时间轴不 seek');

    // B: 左侧栏覆盖区 — 单滑条锚点拖拽
    const rB = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seek(store.beatmap.hitObjects[1].time);
      store.select([962002]);
      const o = store.beatmap.hitObjects.find(x => x.id === 962002);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const side = document.querySelector('div.w-56');
      const consumed = !side.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const started = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x, clientY: pt.y + 60, bubbles: true }));
      await sleep(200);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y + 60, bubbles: true }));
      await sleep(50);
      return { consumed, started, newY: o.curvePoints[0].y };
    })()`);
    assert(rB.consumed && rB.started, 'B: 左侧栏按下单滑条锚点 = 穿透拖拽 (事件被吞)');
    assert(Math.abs(rB.newY - (setup.a2y + 60 / setup.szx)) <= 8, `B: 锚点随拖动精确位移 (y ${setup.a2y} → ${rB.newY}, 期望 ≈ +${(60 / setup.szx).toFixed(0)})`);

    // C: 下时间轴 Alt+点击锚点 — 切换节点选中 (物件选区被清), 事件被吞
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      store.seek(store.beatmap.hitObjects[0].time);
      store.select([962001]);
      const o = store.beatmap.hitObjects.find(x => x.id === 962001);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const bottomC = document.querySelector('canvas.flex-1');
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, bubbles: true }));
      return { consumed, nodeSel: !!store.selectedNodes.get(962001)?.has(1), objSelCleared: store.selected.size === 0 };
    })()`);
    assert(rC.consumed && rC.nodeSel && rC.objSelCleared, 'C: 下时间轴 Alt+点击锚点 = 切换节点选中 (穿透, 不 seek)');

    // D: 无锚点处下时间轴点击 — 正常 seek (穿透不影响原行为); 先清节点选区避免整组拖拽黄框语义
    const rD = await evalJs(`(() => {
      const store = window.__osuStore;
      store.setSelectedNodes([]);
      store.clearSelection();
      const bottomC = document.querySelector('canvas.flex-1');
      const br = bottomC.getBoundingClientRect();
      const t0 = store.currentTime;
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: br.left + br.width * 0.13, clientY: br.top + br.height / 2, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: br.left + br.width * 0.13, clientY: br.top + br.height / 2, bubbles: true }));
      return { consumed, seeked: store.currentTime !== t0 };
    })()`);
    assert(!rD.consumed && rD.seeked, 'D: 无锚点处下时间轴点击仍正常 seek (不吞事件)');

    // E: 下时间轴 Ctrl+点击 (选中单滑条, 非锚点) — 穿透加锚点, 不 seek
    const rE = await evalJs(`(() => {
      const store = window.__osuStore;
      store.seek(store.beatmap.hitObjects[0].time);
      store.select([962001]);
      const o = store.beatmap.hitObjects.find(x => x.id === 962001);
      const n0 = o.curvePoints.length;
      // 尾锚点右侧 40 osu px (仍在下时间轴覆盖带, 距任何锚点 >10 命中阈值)
      const pt = window.__osuToClient(o.curvePoints[0].x + 40, o.curvePoints[0].y);
      const t0 = store.currentTime;
      const bottomC = document.querySelector('canvas.flex-1');
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, bubbles: true }));
      return { consumed, n0, n1: o.curvePoints.length, seeked: store.currentTime !== t0 };
    })()`);
    assert(rE.consumed && rE.n1 === rE.n0 + 1 && !rE.seeked, `E: 下时间轴 Ctrl+点击 = 穿透加锚点 (${rE.n0} → ${rE.n1}, 不 seek)`);

    // F: 控件优先 — 侧栏按钮上的 mousedown 不被穿透吞掉
    const rF = await evalJs(`(() => {
      const store = window.__osuStore;
      const btn = document.querySelector('div.w-56 button');
      const r = btn.getBoundingClientRect();
      const consumed = !btn.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, bubbles: true, cancelable: true }));
      return { consumed, dragging: store.canvasDragging };
    })()`);
    assert(!rF.consumed && !rF.dragging, 'F: 控件优先 — 按钮 mousedown 不被穿透吞掉');

    // G: 放置滑条幽灵预览恢复 — 放头点后幽灵滑条身 (白边轨道) 渲染; 沿头→幻影 25% 处
    //    横截管身采样, 白边亮度应 ≫ 骨架线 (≈136) 与光晕 (≈45), 阈值 165
    const rG = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = c.getBoundingClientRect();
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider';
      store.seek((store.timingPoints?.find?.(p => p.uninherited)?.time ?? store.beatmap.timingPoints.find(p => p.uninherited).time) + 4000);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      fire('mousemove', cx, cy);
      fire('mousedown', cx, cy); fire('mouseup', cx, cy);
      const nPend = store.pendingSlider.length;
      fire('mousemove', cx + 400, cy + 150);
      await sleep(300);
      const head = store.pendingSlider[0], ph = store.pendingCursor;
      if (!head || !ph) return { fail: '无头点/幻影点', nPend, ph: !!ph };
      const hc = window.__osuToClient(head.x, head.y), pc = window.__osuToClient(ph.x, ph.y);
      const g = c.getContext('2d');
      const dpr = c.width / r.width;
      // 25% 处 + 垂直方向 ±100px 横截条, 取最大亮度
      const qx = hc.x + (pc.x - hc.x) * 0.25, qy = hc.y + (pc.y - hc.y) * 0.25;
      const dx = pc.x - hc.x, dy = pc.y - hc.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      let mxTube = 0;
      for (let off = -100; off <= 100; off += 4) {
        const x = Math.round((qx + nx * off - r.left) * dpr), y = Math.round((qy + ny * off - r.top) * dpr);
        const d = g.getImageData(x - 2, y - 2, 5, 5).data;
        for (let i = 0; i < d.length; i += 4) { const v = Math.max(d[i], d[i + 1], d[i + 2]); if (v > mxTube) mxTube = v; }
      }
      // 管身外参照点 (垂直方向 250px) 应为暗背景
      const bx = Math.round((qx + nx * 250 - r.left) * dpr), by = Math.round((qy + ny * 250 - r.top) * dpr);
      const bd = g.getImageData(bx - 2, by - 2, 5, 5).data;
      let mxBg = 0;
      for (let i = 0; i < bd.length; i += 4) { const v = Math.max(bd[i], bd[i + 1], bd[i + 2]); if (v > mxBg) mxBg = v; }
      return { nPend, mxTube, mxBg };
    })()`);
    assert(rG.nPend === 1, 'G: 已放头点 (pendingSlider=1)');
    assert(rG.mxTube > 165, `G: 幽灵滑条身渲染 (管身横截最大亮度 ${rG.mxTube} > 165; 修复前仅骨架线 ≈136)`);
    assert(rG.mxBg < 80, `G: 管身外背景保持暗 (${rG.mxBg} < 80, 采样未受头圈光晕干扰)`);

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

console.log(failures ? `\nVERIFIER_V362_FAILED: ${failures} 处失败` : '\nVERIFIER_V362_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

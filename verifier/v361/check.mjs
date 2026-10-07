// 验证器 v361: 四侧 UI 覆盖区锚点优先 (v360 扩展)
// 用户反馈: 「第二个需求是四侧UI下都要优先与滑条锚点交互, 现在实测仍然交互不了」—
//   v360 只挂了 TopTimeline canvas; 实际上四侧面板全是盖在全幅画布上的 pointer-events-auto
//   浮层 (App v129), 逐个挂钩不可行。改为 EditorCanvas 注册 window 捕获阶段 mousedown 拦截:
//   目标非游玩区画布且非交互控件 (button/input/select/textarea/a/label/[role=button]/[data-dialog]
//   保持控件优先) 时先试 store.playfieldNodePress, 命中则 preventDefault+stopPropagation
//   (捕获阶段先于 React 根监听, 面板/时间轴收不到事件); 未命中照常放行。
// 运行: npm run build 后 node verifier/v361/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: window 捕获拦截');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/window\.addEventListener\('mousedown', onDown, true\)/.test(ec), 'window 捕获阶段 mousedown');
  assert(/if \(!c \|\| e\.target === c\) return;/.test(ec), '游玩区画布自身放行 (React onMouseDown)');
  assert(/el\.closest\('button, input, select, textarea, a, label, \[role="button"\], \[data-dialog\]'\)/.test(ec), '交互控件/对话框优先');
  assert(/e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/.test(ec), '命中后吞事件 (面板/时间轴收不到)');
}

section('CDP: 下时间轴 + 左侧栏锚点穿透, 控件优先');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9468;
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

    // 造两条滑条: 锚点分别落在下时间轴覆盖带 / 左侧栏覆盖区 (反解 client -> osu)
    const setup = await evalJs(`(() => {
      const store = window.__osuStore;
      const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
      const szx = px.x - p0.x, szy = py.y - p0.y;
      const toOsu = (cx, cy) => ({ x: (cx - p0.x) / szx, y: (cy - p0.y) / szy });
      const bottomC = document.querySelector('canvas.flex-1');
      const br = bottomC.getBoundingClientRect();
      const a1 = toOsu(br.left + br.width / 2, br.top + br.height / 2); // 下时间轴条正中
      const side = document.querySelector('div.w-56');
      const sr = side.getBoundingClientRect();
      const a2 = toOsu(sr.left + sr.width / 2, sr.top + Math.min(300, sr.height / 2)); // 左侧栏中部
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = (id, a, beats) => ({ id, type: 'slider', x: Math.round(a.x), y: Math.round(a.y + 200), time: Math.round(red.time + red.beatLength * beats),
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: Math.round(a.x), y: Math.round(a.y) }], slides: 1, length: 220 });
      store.load({ ...base, hitObjects: [mk(961001, a1, 8), mk(961002, a2, 10)] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      return { a1x: Math.round(a1.x), a1y: Math.round(a1.y), a2x: Math.round(a2.x), a2y: Math.round(a2.y), szx,
        bottomInCanvas: br.height > 0 };
    })()`);
    assert(setup.bottomInCanvas, '下时间轴画布存在');

    // A: 下时间轴覆盖带锚点 — 穿透拖拽 + 不 seek
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      store.seek(store.beatmap.hitObjects[0].time);
      store.toggleSelectedNode(961001, 1);
      const o = store.beatmap.hitObjects.find(x => x.id === 961001);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const t0 = store.currentTime;
      const bottomC = document.querySelector('canvas.flex-1');
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const started = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      return { consumed, started, newX: o.curvePoints[0].x, seeked: store.currentTime !== t0 };
    })()`);
    assert(rA.consumed && rA.started, '下时间轴上按下锚点 = 穿透拖拽 (事件被吞)');
    assert(Math.abs(rA.newX - (setup.a1x + 60 / setup.szx)) <= 8, `锚点随拖动移动 (x ${setup.a1x} → ${rA.newX}, 期望 ≈ +${(60 / setup.szx).toFixed(0)})`);
    assert(!rA.seeked, '穿透命中后下时间轴不 seek');

    // A2: 无锚点处下时间轴点击 — 正常 seek (穿透不影响原行为)
    const rA2 = await evalJs(`(() => {
      const store = window.__osuStore;
      const bottomC = document.querySelector('canvas.flex-1');
      const br = bottomC.getBoundingClientRect();
      const t0 = store.currentTime;
      bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: br.left + br.width * 0.13, clientY: br.top + br.height / 2, button: 0, bubbles: true, cancelable: true }));
      return { seeked: store.currentTime !== t0 };
    })()`);
    assert(rA2.seeked, '无锚点处下时间轴点击仍正常 seek');

    // B: 左侧栏覆盖区锚点 — 容器 div (非控件) 上穿透拖拽
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      store.seek(store.beatmap.hitObjects[1].time);
      store.toggleSelectedNode(961002, 1);
      const o = store.beatmap.hitObjects.find(x => x.id === 961002);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const side = document.querySelector('div.w-56');
      const consumed = !side.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const started = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x, clientY: pt.y + 60, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y + 60, bubbles: true }));
      return { consumed, started, newY: o.curvePoints[0].y, pt };
    })()`);
    assert(rB.consumed && rB.started, '左侧栏覆盖区按下锚点 = 穿透拖拽 (事件被吞)');
    assert(rB.newY !== setup.a2y, `锚点随拖动移动 (y ${setup.a2y} → ${rB.newY})`);

    // C: 控件优先 — 侧栏按钮上的 mousedown 不被穿透吞掉
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      const btn = document.querySelector('div.w-56 button');
      const r = btn.getBoundingClientRect();
      const consumed = !btn.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, bubbles: true, cancelable: true }));
      return { consumed, dragging: store.canvasDragging };
    })()`);
    assert(!rC.consumed && !rC.dragging, '控件优先: 按钮 mousedown 不被穿透吞掉');
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

console.log(failures ? `\nVERIFIER_V361_FAILED: ${failures} 处失败` : '\nVERIFIER_V361_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

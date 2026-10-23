// 验证器 v496: 上方物件时间轴 Ctrl+左键多选不误插锚点
// 背景: v495 修了游玩区内的重叠插点, 但 soulten 实测未修复 — 他的场景是在**时间轴**上
//   Ctrl+点物件多选。根因: Timelines onMouseDown 第一行就是锚点穿透
//   (store.playfieldAnchorPress, v360/v404), 穿透链 singleSliderNodePress 带 Ctrl 时走
//   v326「空白即插点」— 时间轴带映射到游玩区坐标通常是空白, 于是选中滑条被插了锚点,
//   且穿透返回 true 吞掉事件, 时间轴自己的 toggleSelect 根本没跑。
// 修复: singleSliderNodePress 加 opts.allowBlankInsert; playfieldAnchorPress (可交互 UI
//   穿透) 传 false — UI 上 Ctrl+点击不生锚点, 还给 UI 多选; 锚点手柄上的 Ctrl 拖拽/切红
//   (v118) 仍穿透。画布与四侧不可交互 UI (playfieldNodePress) 的空白插点语义不变。
// 运行: npm run build 后 node verifier/v496/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码断言');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/opts\?: \{ allowBlankInsert\?: boolean \}/.test(ec), 'singleSliderNodePress 增加 allowBlankInsert 参数');
  assert(/v496: 可交互 UI \(时间轴\) 穿透时不许空白插点[\s\S]*?allowBlankInsert === false\) return false/.test(ec), 'Ctrl 空白插点在穿透路径禁用');
  assert(/singleSliderNodePress\(p, mods, \{ allowBlankInsert: false \}\)/.test(ec), 'playfieldAnchorPress 传 allowBlankInsert:false');
  // 画布/四侧不可交互 UI 路径不受影响 (playfieldNodePress 仍默认插点)
  const nodePress = ec.match(/store\.playfieldNodePress = \(cx, cy, mods\)[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(/if \(singleSliderNodePress\(p, mods\)\) return true;/.test(nodePress), 'playfieldNodePress 保持默认 (空白插点不变)');
}

section('CDP: 时间轴 Ctrl+点物件 = 多选且不插锚点');
{
  const PORT = 9513;
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
    await normalizeEnv(evalJs);
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await sleep(800);

    // 选中滑条 S + 另一圆圈 C; 在时间轴上 Ctrl+点 C 的头圆 → 应多选 (S+C), S 不生锚点
    const rA = await evalJs(`(async () => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const tc = Math.round(t + red.beatLength * 2);
      store.load({ ...base, hitObjects: [
        { id: 976001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 976002, type: 'circle', x: 400, y: 300, time: tc, newCombo: false, comboSkip: 0, hitSound: 0 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 10);
      store.select([976001]);
      store.setSelectedNodes([]);
      // 顶部物件时间轴 canvas (TopTimeline: h-[92px] cursor-pointer)
      const tl = [...document.querySelectorAll('canvas')].find(c => c.className.includes('h-[92px]') && c.className.includes('cursor-pointer'));
      if (!tl) return { err: 'timeline canvas not found' };
      const r = tl.getBoundingClientRect();
      const win = 6000 / (store.beatmap.editor.timelineZoom || 1);
      const t0 = store.currentTime - win / 2;
      // v217: 命中在布局空间 (zoomRect/zoomClientX): 布局 x = ((tc-t0)/win)×(rect.width/z);
      //   换回客户端坐标需乘 z 并加 rect.left/top
      const z = Math.max(0.6, Math.min(1, Math.min(window.innerWidth / 2560, window.innerHeight / 1440)));
      const cx = r.left + ((tc - t0) / win) * r.width; // 布局宽 = rect.width/z, 乘回 z 即 rect.width
      const cy = r.top + 30 * z; // 物件行中部 (OBJ_H=60 → 布局 y=30)
      tl.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: cx, clientY: cy, ctrlKey: true, bubbles: true }));
      await new Promise(res => setTimeout(res, 100));
      const s = store.beatmap.hitObjects.find(x => x.id === 976001);
      return { pts: s.curvePoints.length, selS: store.selected.has(976001), selC: store.selected.has(976002) };
    })()`);
    assert(!rA.err, `A: 时间轴 canvas 就位 ${rA.err ?? ''}`);
    assert(rA.pts === 1, `A: 时间轴 Ctrl+点物件不生锚点 (curvePoints 仍 ${rA.pts})`);
    assert(rA.selS && rA.selC, 'A: 时间轴 Ctrl+点物件 = 多选 (滑条+圆圈都选中)');

    // B: 回归 — 游玩区画布上 Ctrl+点空白仍插锚点 (v326 语义只限画布/不可交互 UI)
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      store.select([976001]);
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(420, 320);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const s = store.beatmap.hitObjects.find(x => x.id === 976001);
      return { pts: s.curvePoints.length };
    })()`);
    assert(rB.pts === 2, `B: 游玩区 Ctrl+点空白 = 插锚点 (curvePoints → ${rB.pts})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V496_FAILED: ${failures} 处失败` : '\nVERIFIER_V496_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v411: 修「上方时间轴 Alt+拖滑条尾改 SV 无效, 只能拉出橙色节点框选」
// 根因: TopTimeline mousedown 开头把事件委托给 store.playfieldAnchorPress (v360/v404 穿透),
//   其 Alt 分支无条件进 nodeAltPress — Alt+空白 = 节点框选 (橙色框), 事件被吞,
//   Timelines 的拖尾分支 (v407, e.altKey 定 SV 模式) 永远执行不到。
// 修复: playfieldAnchorPress 的 Alt 分支只在命中锚点 (切换选中) 或滑条本体 (Alt 点选) 时穿透;
//   Alt+空白 return false 放行给可交互 UI。画布/不可交互 UI 的 Alt 框选不受影响。
// 运行: npm run build 后 node verifier/v411/check.mjs
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

section('源码: playfieldAnchorPress Alt 分支命中才穿透');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v411: Alt 穿透只在命中锚点/.test(ec), 'v411 版本注释');
  const ap = ec.match(/store\.playfieldAnchorPress = \(cx, cy, mods\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(ap.length > 0, '注册 playfieldAnchorPress');
  assert(/const hitNode = nearestNode\(sliders, offs, p, devicePxPerOsu\(\)\);/.test(ap), 'Alt 分支先探锚点命中 (v452 适配: 调用带 k 实参)');
  assert(/if \(!hitNode && !\(hitObj && hitObj\.type === 'slider'\)\) return false;/.test(ap), 'Alt+空白放行可交互 UI');
  assert(/nodeAltPress\(p, mods\)/.test(ap), '命中仍走 nodeAltPress (Alt 点选/切换保留)');
  // 画布内 Alt 框选 (onMouseDown) 与不可交互 UI (playfieldNodePress) 不变
  const np = ec.match(/store\.playfieldNodePress = \(cx, cy, mods\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(/if \(mods\.altKey\) \{\s*if \(store\.lockNotes\) return false;\s*nodeAltPress\(p, mods\);\s*return true;/.test(np), '不可交互 UI 的 Alt 框选穿透不变');
}

section('源码: Timelines v407 SV 拖尾分支保留');
{
  const tl = read('src/components/Timelines.tsx');
  assert(/mode: e\.altKey \? 'sv' : 'slides'/.test(tl), 'Alt 起手 = SV 模式');
  assert(/if \(tr\.mode === 'sv'\) \{[\s\S]{0,200}?applySvTailDrag\(bm, o, tr, targetEnd\)/.test(tl), 'mousemove SV 分支');
}

section('CDP: 上时间轴 Alt+拖尾 = SV 模式 (不再拉框)');
{
  const PORT = 9492;
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

    // 造一条滑条, 自制 timing (只留一条红线, 无绿线 — sv=1, 尾时间可精确算); seek 使其在上时间轴窗口内; 预选该滑条
    const setup = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = { id: 964001, type: 'slider', x: 100, y: 100, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 };
      store.load({ ...base, timingPoints: [{ ...red }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 200);
      store.select([964001]); // v411 观测点: Alt 穿透旧路径会清物件选区 (v265), 拖尾路径保留
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const win = 6000 / (base.editor.timelineZoom || 1);
      const vel = 100 * base.difficulty.sliderMultiplier / red.beatLength; // px/ms (sv=1)
      const endMs = t + 200 / vel;
      const t0 = store.currentTime - win / 2;
      return { x: r.left + ((endMs - t0) / win) * r.width, y: r.top + 10, beatLength: red.beatLength };
    })()`);

    // A: Alt+拖尾向右 ~200px — 应走 SV 模式: 折返数不变, 尾时间变长 (新建/改绿线), 选区保留, 不出节点框选
    const rA = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const o = store.beatmap.hitObjects.find(x => x.id === 964001);
      const greens0 = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      const t0time = store.currentTime;
      const x = ${setup.x}, y = ${setup.y};
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      const selKept = store.selected.has(964001); // v411: Alt 穿透旧路径会清物件选区 (v265); 拖尾路径保留
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 200, clientY: y, altKey: true, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 200, clientY: y, altKey: true, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 200, clientY: y, bubbles: true }));
      await sleep(50);
      const o2 = store.beatmap.hitObjects.find(x => x.id === 964001);
      // SV 模式下 o.length/slides 不变, 时长变化体现在绿线 SV — 用绿线数与 slides 判定
      const greens1 = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      return { selKept, slides0: o.slides, slides1: o2.slides, greens0, greens1,
        marqueeNodes: store.nodeSelectionCount, seeked: store.currentTime !== t0time };
    })()`);
    assert(rA.selKept, 'A: Alt+拖尾不再被穿透吞掉 (物件选区保留; 修复前 Alt 穿透清选区)');
    assert(rA.slides1 === rA.slides0, `A: 折返数不变 (${rA.slides0} → ${rA.slides1})`);
    assert(rA.greens1 > rA.greens0, `A: 新增绿线 (SV 模式生效; ${rA.greens0} → ${rA.greens1})`);
    assert(rA.marqueeNodes === 0, 'A: 没有拉起节点框选');
    assert(!rA.seeked, 'A: 不 seek');

    // B: 无修饰拖尾 — 原折返模式不受影响 (slides 增加); 尾位置按当前状态 (含 A 建的绿线 SV) 重算
    const rB = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const bm = store.beatmap;
      const o = bm.hitObjects.find(x => x.id === 964001);
      const red = bm.timingPoints.find(p => p.uninherited);
      const g = bm.timingPoints.filter(p => !p.uninherited && p.time <= o.time).pop(); // 头处绿线 (A 建的)
      const sv = g ? -100 / g.beatLength : 1;
      const vel = 100 * bm.difficulty.sliderMultiplier * sv / red.beatLength;
      const endMs = o.time + o.length / vel * o.slides;
      const win = 6000 / (bm.editor.timelineZoom || 1);
      const t0 = store.currentTime - win / 2;
      const x = r.left + ((endMs - t0) / win) * r.width, y = r.top + 10;
      const s0 = o.slides;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 400, clientY: y, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 400, clientY: y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 400, clientY: y, bubbles: true }));
      await sleep(50);
      return { s0, s1: store.beatmap.hitObjects.find(x => x.id === 964001).slides };
    })()`);
    assert(rB.s1 > rB.s0, `B: 无修饰拖尾仍改折返 (${rB.s0} → ${rB.s1})`);

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

console.log(failures ? `\nVERIFIER_V411_FAILED: ${failures} 处失败` : '\nVERIFIER_V411_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

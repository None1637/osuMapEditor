// 验证器 v463: 三件事
//   1) Alt+拖时间轴滑条尾改 SV 的目标尾时间吸附走滑条长度口径 (sliderLengthSnapDivisor) —
//      开「滑条长度 1/2 细分」(v443) 后拖尾同样 ×2 精度 (soulten: 開了1/2細分 alt拉滑條尾不是雙倍精度);
//      关 = 当前细分整格 (原行为)。其余 snapMs 调用方 (绿线拖拽/转盘右缘/marker 拖拽) 不变。
//      (放置态点击式/手绘拉滑条实测已走同一口径 — 探针 probe.mjs: 关=1/4 网格 len40, 开=1/8 网格 len60, 无需改)
//   2) 上方时间轴滑条头/尾圆重叠时点击优先选头 (soulten: 滑條頭跟尾疊再一起 優先選擇滑條頭, 現在是優先選尾) —
//      timelineHeadHit 头圆专用命中; 命中头圆时跳过拖尾 (hitTestTail) 与尾端节点 (hitTestNode) 分支。
//   3) 旋转浮窗「应用旋转」点击后自动关窗 (soulten: 第一個點擊後自動關閉選轉浮窗);
//      逆/顺时针旋转一次保持不关窗可连续应用。
// 运行: npm run build 后 node verifier/v463/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: Alt 拖滑条尾 SV 吸附走 sliderLengthSnapDivisor');
{
  const tl = read('src/components/Timelines.tsx');
  assert(/sliderLengthSnapDivisor/.test(tl) && /from '@\/osu\/sliderPath'/.test(tl), '引入 sliderLengthSnapDivisor');
  assert(/const snapMs = \(t: number, divisor\?: number\) => \{[\s\S]{0,200}?red\.beatLength \/ \(divisor \?\? store\.beatSnap\)/.test(tl), 'snapMs 可选细分覆盖参数');
  assert(/const targetEnd = Math\.round\(snapMs\(ms, sliderLengthSnapDivisor\(store\.beatSnap\)\)\);/.test(tl), 'SV 拖尾分支传 sliderLengthSnapDivisor');
  // 其它调用方不传第二参 (行为不变)
  assert(/snapMs\(gd\.origTime \+ \(\(cx - gd\.startX\) \/ r\.width\) \* win\)\)/.test(tl), '绿线拖拽 snapMs 不传第二参');
  assert(/Math\.max\(o\.time \+ red\.beatLength \/ store\.beatSnap, snapMs\(ms\)\)/.test(tl), '转盘右缘 snapMs 不传第二参');
  assert(/const delta = snapMs\(anchorOrig\.time \+ dMs\)/.test(tl), 'marker 拖拽 snapMs 不传第二参');
}

section('源码: 时间轴头尾重叠头优先 (timelineHeadHit)');
{
  const th = read('src/osu/timelineHit.ts');
  assert(/export function timelineHeadHit/.test(th), 'timelineHeadHit 导出');
  const fn = th.match(/export function timelineHeadHit[\s\S]*?\n\}/)?.[0] ?? '';
  assert(fn.length > 0 && !/endOf\(o\).*\) \* width.*dTail/.test(fn) && !/dTail/.test(fn), '头圆命中不含尾圆判定');
  assert(/d < or && d < bestD/.test(fn), '实际半径 rad + 最近者胜出 (v518)');
  const tl = read('src/components/Timelines.tsx');
  assert(/timelineHeadHit/.test(tl), 'Timelines 引入 timelineHeadHit');
  assert(/const headId = hitTestHead\(e\);[\s\S]{0,300}?tailHit\.d < headDist\(headId, e\)/.test(tl), '命中头圆时按距离裁决拖尾 (v463 头优先 → v482 谁近谁赢)');
  assert(/const nh = headId !== null \? null : hitTestNode\(e\);/.test(tl), '命中头圆跳过尾端节点分支');
  assert(/const id = headId !== null \? headId : hitTestMarker\(e\);/.test(tl), '头圆命中直通物件选中/拖动分支');
}

section('源码: 旋转浮窗「应用旋转」应用后自动关窗');
{
  const td = read('src/components/TransformDialog.tsx');
  assert(td.includes('rotateObjects(objs, c, angle)); store.closeTransformDialog();'), '应用旋转 onClick = commit + closeTransformDialog');
  const ccwAt = td.indexOf('rotateObjects(objs, c, -Math.abs(angle))');
  assert(ccwAt > 0 && !td.slice(ccwAt - 300, ccwAt + 300).includes('closeTransformDialog'), '逆时针旋转一次不关窗');
  const cwAt = td.indexOf('rotateObjects(objs, c, Math.abs(angle))');
  assert(cwAt > 0 && !td.slice(cwAt - 300, cwAt + 300).includes('closeTransformDialog'), '顺时针旋转一次不关窗');
  assert(/transform\.footer_hint_rotate/.test(td), '旋转模式底部提示区分 (应用旋转会关窗)');
  const dict = read('src/i18n/dicts/zh-CN/transform.ts');
  assert(/'transform\.footer_hint_rotate':/.test(dict), 'zh-CN footer_hint_rotate 文案');
}

section('CDP: 行为 (Alt 拖尾 SV 两态 / 头尾重叠头优先 / 旋转应用关窗)');
{
  const PORT = 9494;
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
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await sleep(800);

    // C1: Alt+拖滑条尾改 SV — 关 = 1/4 网格, 开 = 1/8 网格 (目标时间取 1/8 奇数格, 不在 1/4 网格上)
    const rC = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red0.time + red0.beatLength * 8);
      const mk = { id: 964001, type: 'slider', x: 100, y: 100, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 4;
      store.seek(t + 200); store.select([964001]);
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const win = 6000 / (base.editor.timelineZoom || 1);
      const vel = 100 * base.difficulty.sliderMultiplier / red0.beatLength;
      const endMs0 = t + 200 / vel;
      const out = {};
      for (const half of [false, true]) {
        store.setEditorPref('sliderHalfSnap', half);
        const tick8 = red0.beatLength / 8;
        const target = t + 3 * tick8; // 1/8 奇数格 — 不在 1/4 网格
        const t0w = store.currentTime - win / 2;
        const x0 = r.left + ((endMs0 - t0w) / win) * r.width, y = r.top + 30; // v518: 拖尾也需点在尾圆中心
        const x1 = r.left + ((target - t0w) / win) * r.width;
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: x0, clientY: y, button: 0, altKey: true, bubbles: true, cancelable: true }));
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: x1, clientY: y, altKey: true, bubbles: true }));
        await sleep(150);
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: x1, clientY: y, altKey: true, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x1, clientY: y, bubbles: true }));
        await sleep(80);
        const o = store.beatmap.hitObjects.find(x => x.id === 964001);
        const g = store.beatmap.timingPoints.filter(p => !p.uninherited && p.time <= o.time).pop();
        const sv = g ? -100 / g.beatLength : 1;
        const endMs = o.time + o.length / (vel * sv) * o.slides;
        const rel = endMs - red0.time;
        const k4 = rel / (red0.beatLength / 4), k8 = rel / tick8;
        out[half ? 'on' : 'off'] = { endMs: Math.round(endMs * 10) / 10,
          on4: Math.abs(k4 - Math.round(k4)) < 0.05, on8: Math.abs(k8 - Math.round(k8)) < 0.05 };
        store.load({ ...store.beatmap, timingPoints: [{ ...red0 }] }, store.audioUrl); // 还原绿线
        const o2 = store.beatmap.hitObjects.find(x => x.id === 964001);
        o2.slides = 1; o2.length = 200;
        store.select([964001]); store.seek(t + 200);
        await sleep(60);
      }
      store.setEditorPref('sliderHalfSnap', false);
      return out;
    })()`);
    assert(rC.off && rC.off.on4, `Alt拖尾 关: 尾时间在 1/4 网格 (${JSON.stringify(rC.off)})`);
    assert(rC.on && rC.on.on8 && !rC.on.on4, `Alt拖尾 开: 尾时间在 1/8 网格且不在 1/4 网格 (${JSON.stringify(rC.on)})`);

    // C2: 头尾重叠 — 点击重叠圆后拖动 = 移动物件 (头优先), 不是拖尾改折返/SV
    const rH = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red0.time + red0.beatLength * 8);
      const vel = 100 * base.difficulty.sliderMultiplier / red0.beatLength;
      // 超短滑条: 时长 ~24ms → 尾圆与头圆在屏上重叠 (RAD=24 css px 尺度)
      const mk = { id: 964002, type: 'slider', x: 100, y: 100, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 105, y: 100 }], slides: 1, length: Math.max(1, Math.round(vel * 24)) };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 4;
      store.seek(t + 150); store.clearSelection();
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const win = 6000 / (base.editor.timelineZoom || 1);
      const t0w = store.currentTime - win / 2;
      const hx = r.left + ((t - t0w) / win) * r.width, y = r.top + 20; // 头圆位置 (OBJ_H 行内)
      const greens0 = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      const time0 = store.beatmap.hitObjects.find(x => x.id === 964002).time;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: hx, clientY: y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: hx + 120, clientY: y, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: hx + 120, clientY: y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: hx + 120, clientY: y, bubbles: true }));
      await sleep(80);
      const o = store.beatmap.hitObjects.find(x => x.id === 964002);
      const greens1 = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      return { sel: store.selected.has(964002), slides: o.slides, time0, time1: o.time,
        greensDiff: greens1 - greens0, selectedNodes: store.nodeSelectionCount };
    })()`);
    assert(rH.sel, `头尾重叠点击: 选中物件 (${JSON.stringify(rH)})`);
    assert(rH.slides === 1 && rH.greensDiff === 0, `头优先: 拖动不改折返/不建绿线 (slides=${rH.slides}, greens+${rH.greensDiff})`);
    assert(rH.time1 !== rH.time0, `头优先: 拖动 = 移动物件时间 (${rH.time0} → ${rH.time1})`);
    assert(rH.selectedNodes === 0, `头优先: 未选中尾端节点 (nodeSelectionCount=${rH.selectedNodes})`);

    // C3: 旋转浮窗 — 「应用旋转」关窗; 「逆时针旋转一次」不关窗
    const rR = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.select([964002]);
      store.openTransformDialog('rotate');
      await sleep(300);
      const dlg0 = !!document.querySelector('[data-dialog="rotate-dlg"]');
      document.querySelector('[data-dialog="rotate-dlg"] [data-tf="apply-rotate"]').click();
      await sleep(300);
      const closedAfterApply = !document.querySelector('[data-dialog="rotate-dlg"]') && !store.transformDialog;
      // 重开, 点「逆时针旋转一次」— 不关窗
      store.openTransformDialog('rotate');
      await sleep(300);
      const btns = [...document.querySelectorAll('[data-dialog="rotate-dlg"] button')];
      const ccwBtn = btns.find(b => b.title && /counter-clockwise once/i.test(b.title));
      ccwBtn.click();
      await sleep(300);
      const stayedOpen = !!document.querySelector('[data-dialog="rotate-dlg"]') && !!store.transformDialog;
      store.closeTransformDialog();
      return { dlg0, closedAfterApply, stayedOpen, ccwFound: !!ccwBtn };
    })()`);
    assert(rR.dlg0, '旋转浮窗打开');
    assert(rR.closedAfterApply, `「应用旋转」点击后自动关窗 (${JSON.stringify(rR)})`);
    assert(rR.ccwFound && rR.stayedOpen, `「逆时针旋转一次」不关窗 (stayedOpen=${rR.stayedOpen})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V463_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V463_ALL_TESTS_PASSED');

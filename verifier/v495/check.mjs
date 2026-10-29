// 验证器 v495: soulten 三连 — ①粘贴到同时间取代原有物件 (stable 语义) ②③Ctrl 多选/插点
// v497 适配: ②③ 的「Ctrl 重叠穿透」(hitTestAll 拆分 + 守卫升级 + objectPress 优先加选)
//   系理解错误已还原 — 恢复 v413/v439 顶层命中语义; 本验证器只保留 ①粘贴取代 的断言与
//   CDP, 另加还原后语义回归 (B': 重叠区 Ctrl+点本滑条身 = 插锚点, 不多选)。
// 运行: npm run build 后 node verifier/v495/check.mjs
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
  const st = read('src/osu/store.ts');
  assert(/v495: stable 语义 — 粘贴落点时刻已有物件则取代/.test(st), 'paste: v495 取代注释');
  assert(/const pasteTimes = new Set\(this\.clipboard\.map/.test(st), 'paste: pasteTimes 收集落点时刻');
  assert(/!this\.lockNotes && pasteTimes\.size/.test(st), 'paste: 锁定物件时不删 (v115 契约)');
  const ec = read('src/components/EditorCanvas.tsx');
  assert(!/hitTestAll\(/.test(ec), 'v497: hitTestAll 穿透重叠改动已还原 (无调用; 仅注释留档)');
  assert(/const hitObj = hitTest\(p\.x, p\.y\);\s*if \(hitObj && hitObj\.id !== so\.id && !onOwnTrack\) return false;/.test(ec), 'v497/v513: 顶层命中守卫 + 自身轨道豁免');
  assert(/if \(mods\.ctrlKey \|\| mods\.metaKey \|\| mods\.shiftKey\) store\.toggleSelect\(hit\.id\);/.test(ec), 'v497: objectPress 恢复顶层命中直接切换');
}

section('CDP: 粘贴取代 + 重叠区 Ctrl 多选/不插点');
{
  const PORT = 9511;
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

    // A: 粘贴取代 — 圆圈 X 在 T; 复制滑条 Y, 吸附粘贴使其落点 == T → X 被清除, 只剩新物件
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const T = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 975001, type: 'circle', x: 256, y: 192, time: T, newCombo: true, comboSkip: 0, hitSound: 0 },
        { id: 975002, type: 'slider', x: 100, y: 300, time: Math.round(red.time + red.beatLength * 4),
          newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 300 }], slides: 1, length: 200 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([975002]);
      store.copy();
      store.seek(T); // 粘贴锚点 = 当前时刻吸附 = T → 落点与 X 同时间
      store.paste(store.currentTime);
      const at = store.beatmap.hitObjects.filter(o => Math.round(o.time) === T);
      return {
        nAtT: at.length,
        xGone: !store.beatmap.hitObjects.some(o => o.id === 975001),
        yKept: store.beatmap.hitObjects.some(o => o.id === 975002),
        pastedIsSlider: at[0]?.type === 'slider' && at[0]?.id !== 975002,
        pastedSelected: at.length === 1 && store.selected.has(at[0].id),
      };
    })()`);
    assert(rA.nAtT === 1 && rA.xGone, `A: 同时间原物件被取代 (T 时刻剩 ${rA.nAtT} 个, X 已清除)`);
    assert(rA.yKept && rA.pastedIsSlider, 'A: 原滑条 Y 保留, 落点是新滑条副本');
    assert(rA.pastedSelected, 'A: 粘贴副本被选中');

    // B': 还原后语义 — Ctrl+点被选中滑条身盖住的圆圈 = 给本滑条插锚点 (v439: 顶层命中
    //   是本滑条 → 继续插点), 不多选; v495 的「穿透重叠不插点」为误改已还原
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 975011, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 975012, type: 'circle', x: 200, y: 100, time: t + 20, newCombo: false, comboSkip: 0, hitSound: 0 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 10);
      store.select([975011]);
      store.setSelectedNodes([]);
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 100); // 滑条身中点 = 圆圈圆心 (完全重叠)
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 975011);
      return { pts: a.curvePoints.length, selS: store.selected.has(975011), selC: store.selected.has(975012) };
    })()`);
    assert(rB.pts === 2, `B': 重叠区 Ctrl+点 = 插锚点 (还原 v439; curvePoints → ${rB.pts})`);
    assert(rB.selS && !rB.selC, "B': 选区不变 (不多选)");

    // C: 回归 — Ctrl+点纯空白仍给选中滑条插锚点 (v326 语义不失效)
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      store.select([975011]); // 回到只选滑条
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(420, 320);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 975011);
      return { pts: a.curvePoints.length, selOnlyS: store.selected.size === 1 && store.selected.has(975011) };
    })()`);
    assert(rC.pts === 3, `C: Ctrl+点空白 = 插锚点 (curvePoints → ${rC.pts})`);
    assert(rC.selOnlyS, 'C: 选区未被改动');

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

console.log(failures ? `\nVERIFIER_V495_FAILED: ${failures} 处失败` : '\nVERIFIER_V495_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

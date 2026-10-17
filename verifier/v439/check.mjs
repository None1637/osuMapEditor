// 验证器 v439: 修复「选中滑条后 Ctrl+点击滑条本体加不了锚点」(v413 回归)
// 根因: v413 在 singleSliderNodePress 的 Ctrl 插点分支前置 `if (hitTest(p.x, p.y)) return false;`,
//   把「选中滑条自己的本体」也当作互动物件放行给 objectPress — Ctrl+点本滑条身变成多选切换, 不插点。
// 修复: 命中对象是本滑条 (hit.id === so.id) 时继续插点 (v326 stable 语义);
//   命中其他物件才 return false 走多选 (v413 语义保留)。v413 验证器已适配 (新增 CDP 用例 B2)。
// 运行: npm run build 后 node verifier/v439/check.mjs
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

section('源码: 本滑条身继续插点 / 其他物件放行多选');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v439: 命中对象是本滑条自己/.test(ec), 'v439 版本注释');
  const fn = ec.match(/const singleSliderNodePress = \(p: Pt[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(fn.length > 0, 'singleSliderNodePress 存在');
  assert(/const hitObj = hitTest\(p\.x, p\.y\);\s*if \(hitObj && hitObj\.id !== so\.id\) return false;/.test(fn), '命中守卫按 id 排除本滑条');
  assert(!/if \(hitTest\(p\.x, p\.y\)\) return false; \/\/ v413/.test(fn), 'v413 旧一刀切守卫已移除');
}

section('CDP: Ctrl+点本滑条身 = 插点 / Ctrl+点其他物件 = 多选不插点');
{
  const PORT = 9497;
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

    // 滑条 A (100,100)→(300,100) 选中; 圆圈 B (200,300) 未选
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 439001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 439002, type: 'circle', x: 200, y: 300, time: t + 10, newCombo: false, comboSkip: 0, hitSound: 0 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.select([439001]);
      store.setSelectedNodes([]);
    })()`);

    // A: Ctrl+点击本滑条身中点 (200,100) — 插点 (修复核心)
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 100);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 439001);
      return { pts: a.curvePoints.length, selOnlyA: store.selected.size === 1 && store.selected.has(439001) };
    })()`);
    assert(rA.pts === 2, `A: Ctrl+点本滑条身 = 插锚点 (curvePoints → ${rA.pts}; v413 回归修复)`);
    assert(rA.selOnlyA, 'A: 选区未被改动');

    // B: Ctrl+点击其他物件 (圆圈 B) — v413 语义保留: 多选, 不插点
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 300);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 439001);
      return { pts: a.curvePoints.length, selB: store.selected.has(439002) };
    })()`);
    assert(rB.selB, 'B: Ctrl+点其他物件 = 加选 (v413 保留)');
    assert(rB.pts === 2, `B: 其他物件上不生成锚点 (curvePoints 仍 ${rB.pts})`);

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

console.log(failures ? `\nVERIFIER_V439_FAILED: ${failures} 处失败` : '\nVERIFIER_V439_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

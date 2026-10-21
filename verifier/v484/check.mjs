// 验证器 v484: 移动滑条点后旋转没效果 (soulten, 截图标题「旋轉 (1 個選中)」)
//   根因: 按下锚点拖动会把节点选区收敛成被拖的 1 个锚点 (v410 语义), 此时开旋转/缩放浮窗
//   进节点模式, 原点 = 单点包围盒中心 = 点自身 → 绕自身旋转/缩放是恒等变换 = 「没效果」。
//   修复: TransformDialog nodeMode 要求 ≥2 锚点; 单锚点+物件在选区 → 回落物件模式,
//   旋转整条滑条 (与不移动时的基线一致)。
// 运行: npm run build 后 node verifier/v484/check.mjs
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
  const td = read('src/components/TransformDialog.tsx');
  assert(/const nodeMode = mode !== 'symmetry' && store\.nodeSelectionCount > 1;/.test(td), 'nodeMode 需 ≥2 锚点 (v484)');
  assert(/单锚点选区不进节点模式/.test(td), 'v484 注释记录根因');
}

section('CDP: 拖锚点(选区收敛为1) → 开旋转窗 → 应用旋转几何确实变化');
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
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
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

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const slider = { id: 484001, type: 'slider', x: 200, y: 150, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 350, y: 150 }], slides: 1, length: 220 };
      store.load({ ...base, hitObjects: [slider] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      store.seek(t); store.select([484001]);
      // 1) 真实拖锚点 (v410: 选区收敛为被拖的 1 个锚点)
      const cvs = [...document.querySelectorAll('canvas')].sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      })[0];
      const pt = window.__osuToClient(350, 150);
      cvs.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      cvs.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 40, clientY: pt.y + 25, buttons: 1, bubbles: true }));
      await sleep(150);
      cvs.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 40, clientY: pt.y + 25, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 40, clientY: pt.y + 25, bubbles: true }));
      await sleep(100);
      const nodesAfterDrag = [...(store.selectedNodes.get(484001) || [])];
      const objSelected = store.selected.has(484001);
      // 2) 开旋转窗 — 应回落物件模式 (原点行可见)
      store.openTransformDialog('rotate');
      await sleep(350);
      const dlgOpen = !!document.querySelector('[data-dialog="rotate-dlg"]');
      const hasOrigin = !!document.querySelector('[data-tf="origin-selection"]');
      const geoBefore = JSON.stringify((({ x, y, curvePoints }) => ({ x, y, curvePoints }))(store.beatmap.hitObjects.find(o => o.id === 484001)));
      // 3) 输入 90° 应用旋转
      const angleEl = document.querySelector('[data-dialog="rotate-dlg"] [data-conv="angle"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(angleEl, '90');
      angleEl.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      document.querySelector('[data-dialog="rotate-dlg"] [data-tf="apply-rotate"]').click();
      await sleep(300);
      const o2 = store.beatmap.hitObjects.find(o => o.id === 484001);
      const geoAfter = JSON.stringify((({ x, y, curvePoints }) => ({ x, y, curvePoints }))(o2));
      return { nodesAfterDrag, objSelected, dlgOpen, hasOrigin, geoBefore, geoAfter,
        closedAfterApply: !document.querySelector('[data-dialog="rotate-dlg"]') };
    })()`);

    assert(out.nodesAfterDrag.length === 1, `拖锚点后节点选区收敛为 1 个 (实际 ${JSON.stringify(out.nodesAfterDrag)})`);
    assert(out.objSelected, '物件仍在选区 (v410 语义)');
    assert(out.dlgOpen && out.hasOrigin, '单锚点选区 → 回落物件模式 (原点行可见)');
    assert(out.geoAfter !== out.geoBefore, `应用 90° 旋转后几何确实变化 (前 ${out.geoBefore} 后 ${out.geoAfter})`);
    assert(out.closedAfterApply, '应用旋转后自动关窗 (v463 语义保留)');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V484_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V484_ALL_TESTS_PASSED');

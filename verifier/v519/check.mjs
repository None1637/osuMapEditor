// v519: 批量插入子滑条在窗口内显示/编辑, 捕获改为快照覆盖, 默认两点短直线
// 运行: npm run build 后 node verifier/v519/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v519/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const rawText = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};

console.log('== A: 纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v519/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle, plugins: [rawText] });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally {
  if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle);
}

console.log('== B: 源码契约');
{
  const model = read('src/osu/convert/anchorStamp.ts');
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  const canvas = read('src/components/convert/AnchorStampTemplateCanvas.tsx');
  const app = read('src/App.tsx');
  assert(!/srcId\s*:/.test(model) && !/\.srcId/.test(model) && !/srcId/.test(dlg), '活链接 srcId 字段与读取已移除');
  assert(/defaultAnchorStampTemplate/.test(model) && /x: 64, y: 0/.test(model), '默认两点 64px 直线');
  assert(/normalizeAnchorStampParams/.test(dlg) && /key=\{r\.uid\}/.test(dlg), '旧参数迁移 + 稳定规则键');
  assert(/<AnchorStampTemplateCanvas/.test(dlg), '每条规则嵌入可编辑画布');
  assert(/renderPlayfield/.test(canvas) && /drawSliderControlPoints/.test(canvas), '复用游玩区渲染与控制点');
  assert(/dispatchAnchorStampGeometryCommand/.test(app) && /dispatchAnchorStampMenuCommand/.test(app), '键盘与原生菜单局部作用域');
  assert(/data-menu-bar/.test(canvas), '点击自绘菜单不提前释放模板作用域');
  assert(!/requestAnimationFrame/.test(canvas), '末次模板编辑同步父窗口, 关闭/Apply 不丢帧');
}

console.log('== C: CDP 默认/鼠标编辑/局部 undo/快照覆盖');
{
  const PORT = 9533;
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
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);

    const out = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const main = { id: 519001, type: 'slider', x: 100, y: 192, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      const source = { id: 519002, type: 'slider', x: 100, y: 400, time: t + 1000, newCombo: false, comboSkip: 0, hitSound: 0,
        curveType: 'P', curvePoints: [{ x: 140, y: 360 }, { x: 180, y: 400 }], slides: 1, length: 90 };
      s.load({ ...base, timingPoints: [{ ...red }], hitObjects: [main, source] }, s.audioUrl);
      s.pause(); s.tool = 'select'; s.seek(t); s.select([519001]);
      s.openConversion('anchorStamp'); await sleep(350);
      document.querySelector('[data-conv="add-rule"]').click(); await sleep(350);
      const c = document.querySelector('[data-conv="template-0-canvas"]');
      const label = () => document.querySelector('[data-conv="capture-0"]').textContent;
      const previewLen = () => s.conversionPreview ? s.conversionPreview.objects[0].length : null;
      const out = { hasCanvas: !!c, curve0: document.querySelector('[data-conv="template-0-curve"]').value,
        label0: label(), len0: previewLen(), history0: s.historySeq };
      const r = c.getBoundingClientRect();
      const rad = 54.4 - 4.48 * base.difficulty.cs;
      const scale = Math.max(0.05, Math.min(2, Math.min((r.width - 16) / (64 + 2 * rad), (r.height - 16) / (2 * rad))));
      const tail = { x: r.left + r.width / 2 + 32 * scale, y: r.top + r.height / 2 };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: tail.x, clientY: tail.y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: tail.x + 40, clientY: tail.y, buttons: 1, bubbles: true }));
      await sleep(180);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: tail.x + 40, clientY: tail.y, bubbles: true }));
      await sleep(350);
      out.dragLabel = label(); out.lenDrag = previewLen();
      const add = { x: r.left + r.width / 2, y: r.top + r.height * 0.65 };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: add.x, clientY: add.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: add.x, clientY: add.y, ctrlKey: true, bubbles: true }));
      await sleep(350);
      out.insertLabel = label();
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: add.x, clientY: add.y, button: 2, bubbles: true, cancelable: true }));
      await sleep(350);
      out.rightLabel = label();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(350);
      out.undoLabel = label(); out.historyAfterEdit = s.historySeq;
      out.mainIntact = s.beatmap.hitObjects.some(o => o.id === 519001 && o.curvePoints.length === 1 && o.curvePoints[0].x === 412);

      s.select([519002]); await sleep(80);
      document.querySelector('[data-conv="capture-0"]').click(); await sleep(350);
      out.captureLabel = label(); out.lenCapture = previewLen();
      const src = s.beatmap.hitObjects.find(o => o.id === 519002);
      src.curvePoints = [{ x: 240, y: 260 }, { x: 300, y: 400 }]; s.emit(); await sleep(350);
      out.lenAfterSourceEdit = previewLen();
      const curve = document.querySelector('[data-conv="template-0-curve"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(curve, 'B4'); curve.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(350);
      out.curveLabel = label();
      document.querySelector('[data-conv="apply"]').click(); await sleep(350);
      out.applied = !s.beatmap.hitObjects.some(o => o.id === 519001)
        && s.beatmap.hitObjects.some(o => o.type === 'slider' && o.id !== 519002 && o.curveType === 'B');
      s.undo(); await sleep(200);
      out.undoApply = s.beatmap.hitObjects.some(o => o.id === 519001);
      return out;
    })()`);

    assert(out.hasCanvas && out.curve0 === 'L' && /L\/2/.test(out.label0), `默认两点短直线 (${out.label0}/${out.curve0})`);
    assert(out.len0 !== null, '默认模板即可生成盖章预览');
    assert(/L\/2/.test(out.dragLabel) && Math.abs(out.lenDrag - out.len0) > 1, `拖动尾点实时改预览 (${out.len0}→${out.lenDrag})`);
    assert(/\/3\)/.test(out.insertLabel || ''), `Ctrl 加点 (${out.insertLabel})`);
    assert(/L\/2/.test(out.rightLabel), `右键删点 (${out.rightLabel})`);
    assert(/\/3\)/.test(out.undoLabel || ''), `模板局部 undo 恢复锚点 (${out.undoLabel})`);
    assert(out.historyAfterEdit === out.history0 && out.mainIntact, '模板编辑/undo 不碰主谱面历史与物件');
    assert(/P\/3/.test(out.captureLabel), `捕获覆盖为源滑条锚点 (${out.captureLabel})`);
    assert(out.lenAfterSourceEdit === out.lenCapture, `捕获后源滑条编辑不再联动 (${out.lenCapture}→${out.lenAfterSourceEdit})`);
    assert(/B4\/3/.test(out.curveLabel), `局部曲线类型切换 (${out.curveLabel})`);
    assert(out.applied && out.undoApply, '应用仍替换主滑条且一次 undo 还原');

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V519_FAILED: ${failures} 处失败` : '\nVERIFIER_V519_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

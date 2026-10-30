// v520: 捕获按钮动作文案 + 子滑条编辑区右/下/角拖动联动浮窗尺寸
// 运行: npm run build 后 node verifier/v520/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 源码契约');
{
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  const canvas = read('src/components/convert/AnchorStampTemplateCanvas.tsx');
  assert(/stamp_capture[\s\S]{0,150}tplLabel/.test(dlg), '捕获按钮始终显示动作文案与模板后缀');
  assert(/width=\{dialogWidth\}/.test(dlg) && /canvasHeights/.test(dlg), '浮窗宽度受控 + 规则高度独立');
  assert(/resize-x/.test(canvas) && /resize-y/.test(canvas) && /resize-xy/.test(canvas), '右/下/角三个缩放手柄');
  assert(/ResizeObserver/.test(canvas), '实际尺寸变化后重适配视图');
  assert(/rs\.dialogWidth \+ \(rs\.horizontal/.test(canvas) && /rs\.height \+ \(rs\.vertical/.test(canvas), '目标尺寸按拖拽起点计算');
}

console.log('== B: CDP 文案与边缘缩放');
{
  const PORT = 9534;
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
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);

    const out = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const main = { id: 520001, type: 'slider', x: 100, y: 192, time: 1000, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      s.load({ ...base, timingPoints: [{ ...red }], hitObjects: [main] }, s.audioUrl);
      s.pause(); s.tool = 'select'; s.seek(1000); s.select([520001]); s.openConversion('anchorStamp');
      await sleep(350);
      document.querySelector('[data-conv="add-rule"]').click(); await sleep(350);
      const dlg = document.querySelector('[data-dialog="anchorStamp"]');
      const c = document.querySelector('[data-conv="template-0-canvas"]');
      const size = () => {
        const d = dlg.getBoundingClientRect(), r = c.getBoundingClientRect();
        return { dw: d.width, dh: d.height, cw: r.width, ch: r.height };
      };
      const out = { label: document.querySelector('[data-conv="capture-0"]').textContent, s0: size() };
      const drag = async (id, dx, dy) => {
        const el = document.querySelector('[data-conv="' + id + '"]');
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + dx, clientY: y + dy, buttons: 1, bubbles: true }));
        await sleep(120);
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + dx, clientY: y + dy, bubbles: true }));
        await sleep(300);
      };
      await drag('template-0-resize-x', 120, 0); out.s1 = size();
      await drag('template-0-resize-y', 0, 70); out.s2 = size();
      await drag('template-0-resize-xy', 40, 30); out.s3 = size();
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      await sleep(300);
      out.labelAfterEdit = document.querySelector('[data-conv="capture-0"]').textContent;
      out.preview = !!s.conversionPreview?.objects.length;
      return out;
    })()`);

    assert(/Capture selected slider/.test(out.label) && /L\/2/.test(out.label), `捕获按钮动作明确 (${out.label})`);
    assert(out.s1.dw >= out.s0.dw + 100 && out.s1.cw >= out.s0.cw + 100,
      `右缘拉宽浮窗与画布 (${out.s0.dw.toFixed(0)}→${out.s1.dw.toFixed(0)})`);
    assert(out.s2.ch >= out.s1.ch + 55 && out.s2.dh > out.s1.dh,
      `下缘拉高画布与浮窗 (${out.s1.ch.toFixed(0)}→${out.s2.ch.toFixed(0)})`);
    assert(out.s3.cw >= out.s2.cw + 25 && out.s3.ch >= out.s2.ch + 20, '角手柄双向调整');
    assert(/\/3\)/.test(out.labelAfterEdit) && out.preview, `缩放后仍可编辑且预览正常 (${out.labelAfterEdit})`);

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V520_FAILED: ${failures} 处失败` : '\nVERIFIER_V520_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v523: 长距离拖动不被旧模板回显取消选中 + 单规则折叠保留编辑状态
// 运行: npm run build 后 node verifier/v523/check.mjs
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
  const canvas = read('src/components/convert/AnchorStampTemplateCanvas.tsx');
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  assert(/WeakSet<AnchorStampTemplate>/.test(canvas), 'WeakSet 记录全部本编辑器模板引用');
  assert(!/lastEmittedRef/.test(canvas), '旧单值 lastEmittedRef 已移除');
  assert(/collapsed\.has\(r\.uid\)/.test(dlg) && /hidden=\{collapsed\.has\(r\.uid\)\}/.test(dlg), '单规则按 uid 折叠且配置仅隐藏');
  assert(/ChevronRight|ChevronDown/.test(dlg), '折叠/展开 lucide 图标');
}

console.log('== B: CDP 长拖动选区 + 折叠状态');
{
  const PORT = 9537;
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
      const main = { id: 523001, type: 'slider', x: 100, y: 192, time: 1000, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      s.load({ ...base, timingPoints: [{ ...red }], hitObjects: [main] }, s.audioUrl);
      s.pause(); s.tool = 'select'; s.seek(1000); s.select([523001]); s.openConversion('anchorStamp');
      await sleep(300);
      document.querySelector('[data-conv="add-rule"]').click(); await sleep(300);
      const c = document.querySelector('[data-conv="template-0-canvas"]');
      const len = () => s.conversionPreview ? s.conversionPreview.objects[0].length : null;
      const out = { len0: len() };
      const r = c.getBoundingClientRect(), rad = 54.4 - 4.48 * base.difficulty.cs;
      const scale = Math.max(0.05, Math.min(2, Math.min((r.width - 16) / (64 + 2 * rad), (r.height - 16) / (2 * rad))));
      const tx = r.left + r.width / 2 + 32 * scale, ty = r.top + r.height / 2;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: tx, clientY: ty, button: 0, bubbles: true, cancelable: true }));
      for (let i = 1; i <= 40; i++) {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: tx + i * 5, clientY: ty, buttons: 1, bubbles: true }));
        await sleep(0); // 让每帧父组件回显都有机会与下一次编辑交错
      }
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: tx + 200, clientY: ty, bubbles: true }));
      await sleep(200);
      out.lenLong = len();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(120);
      out.lenNudge = len(); // 选区仍在 = 只延长尾点; 若被清空 = 整件平移且长度不变
      const key = (key, code, ctrlKey) => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey, bubbles: true, cancelable: true }));
      key('z', 'KeyZ', true); await sleep(60); key('z', 'KeyZ', true); await sleep(100);
      out.lenUndo = len();
      key('y', 'KeyY', true); await sleep(60); key('y', 'KeyY', true); await sleep(100);
      out.lenRedo = len();

      document.querySelector('[data-conv="collapse-0"]').click(); await sleep(120);
      const config = document.querySelector('[data-conv="config-0"]');
      out.fold = { hidden: config.hidden, display: getComputedStyle(config).display,
        canvasMounted: !!document.querySelector('[data-conv="template-0-canvas"]'),
        captureVisible: document.querySelector('[data-conv="capture-0"]').getBoundingClientRect().width > 0 };
      document.querySelector('[data-conv="collapse-0"]').click(); await sleep(120);
      out.expanded = !config.hidden;
      c.focus();
      key('ArrowRight', 'ArrowRight', true); await sleep(120);
      out.lenAfterExpand = len();
      return out;
    })()`);

    assert(out.lenLong > out.len0, `长拖动生效 (${out.len0}→${out.lenLong})`);
    assert(out.lenNudge > out.lenLong + 0.5, `长拖动后原锚点选区仍保留 (${out.lenLong}→${out.lenNudge})`);
    assert(out.lenUndo === out.len0 && out.lenRedo === out.lenNudge, `局部 undo/redo 完整 (${out.lenUndo}/${out.lenRedo})`);
    assert(out.fold.hidden && out.fold.display === 'none' && out.fold.canvasMounted && out.fold.captureVisible,
      `折叠隐藏配置但不卸载画布/捕获 (${JSON.stringify(out.fold)})`);
    assert(out.expanded && out.lenAfterExpand > out.lenRedo + 0.5, '展开后选区与编辑状态保留');

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V523_FAILED: ${failures} 处失败` : '\nVERIFIER_V523_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

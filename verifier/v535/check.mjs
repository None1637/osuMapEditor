// v535: Timing/Transform/BPM 弹窗业务控件与预览画布布局覆盖
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
  const point = read('src/components/TimingPointDialog.tsx'), batch = read('src/components/TimingBatchDialog.tsx');
  const transform = read('src/components/TransformDialog.tsx'), bpm = read('src/components/BpmDetectDialog.tsx');
  assert(point.includes('localId="sample-set"') && point.includes('uiId="delete"'), 'Timing 单线下拉/删除');
  assert(batch.includes('localId="omit-bar"') && batch.includes('uiId="apply"'), 'Timing 批量效果/应用');
  assert(transform.includes('localId="angle-slider"') && transform.includes('localId="lock-ratio"'), '变换滑条/轴向设置');
  assert(transform.includes('localId="rotate-ccw"') && transform.includes('uiId="apply-stay"'), '旋转图标/连续缩放按钮');
  assert(bpm.includes('localId="mode-variable"') && bpm.includes('localId={`segment.${s.time}.delete`}'), 'BPM 模式/检测段 ID');
  assert(read('src/components/BpmPreview.tsx').includes('localId="preview.canvas"'), 'BPM 预览 Canvas');
}

console.log('== B: CDP Timing 应用文本 + 下拉屏蔽恢复');
{
  const PORT = 9549;
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
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const select = id => {
        const b = [...document.querySelectorAll('[data-ui-editor] button')].find(x => x.textContent.trim() === id);
        if (!b) throw new Error('找不到控件: ' + id); b.click();
      };
      document.querySelector('[data-ui-id="timeline.top.add-red"]').click(); await sleep(150);
      document.querySelector('[data-ui-layout-open]').click(); await sleep(150);
      select('dialog.tpdlg.apply'); await sleep(80);
      const text = document.querySelector('[data-ui-layout="text-en"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(text, 'Insert Timing');
      text.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
      out.text = document.querySelector('[data-ui-id="dialog.tpdlg.apply"]').textContent;
      select('dialog.tpdlg.sample-set'); await sleep(80);
      const visible = document.querySelector('[data-ui-editor] input[type="checkbox"]');
      visible.click(); await sleep(100);
      out.hidden = document.querySelector('[data-ui-id="dialog.tpdlg.sample-set"]').hidden;
      visible.click(); await sleep(80);
      out.shown = !document.querySelector('[data-ui-id="dialog.tpdlg.sample-set"]').hidden;
      out.persisted = (localStorage.getItem('osu-editor:ui-layout:v1') || '').includes('Insert Timing');
      return out;
    })()`);
    assert(out.text === 'Insert Timing', `Timing 应用文本覆盖 (${out.text})`);
    assert(out.hidden && out.shown, 'Timing 下拉屏蔽/恢复');
    assert(out.persisted, 'Timing 弹窗配置持久化');
    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally { await killIsolated(electron, profile); }
}

console.log(failures ? `\nVERIFIER_V535_FAILED: ${failures} 处失败` : '\nVERIFIER_V535_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

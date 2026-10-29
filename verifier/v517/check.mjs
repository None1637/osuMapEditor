// v517: 红线/绿线显式 NaN 输入、保存、undo/redo 与拍点渲染防护
// 运行: npm run build 后 node verifier/v517/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v517/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rawText = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 保存/显示/拍点单测');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v517/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '  ' + l).join('\n'));
} finally {
  if (fs.existsSync(out)) fs.unlinkSync(out);
}

console.log('== B: 源码契约');
{
  const dd = read('src/components/DraggableDialog.tsx');
  assert(/allowNaN\?: boolean/.test(dd) && /raw\.trim\(\)\.toLowerCase\(\) === 'nan'/.test(dd), 'DraftNum 显式 NaN opt-in');
  const tp = read('src/components/TimingPanel.tsx');
  assert((tp.match(/allowNaN/g) ?? []).length >= 4 && /Number\.isNaN\(v\) \? NaN/.test(tp), 'TimingPanel 行内/批量入口均保留 NaN');
  const td = read('src/components/TimingPointDialog.tsx');
  assert((td.match(/allowNaN/g) ?? []).length === 2, '红绿弹窗均允许 NaN');
  assert(/structuredClone\(v\)/.test(read('src/osu/store.ts')), 'undo/剪贴板深拷贝保留 NaN');
  assert(/__nonFinite/.test(read('src/osu/dirtyFingerprint.ts')), '脏指纹区分 NaN 与 null');
}

console.log('== C: CDP 弹窗/Timing 表格/undo/渲染');
{
  const PORT = 9531;
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);

    const result = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
      const green = { time: 1000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 };
      s.load({ ...base, hitObjects: [], timingPoints: [red, green] }, s.audioUrl);
      s.pause(); s.seek(0);
      const setInput = (el, text) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const q = async sel => {
        for (let i = 0; i < 40; i++) {
          const el = document.querySelector(sel);
          if (el) return el;
          await sleep(50);
        }
        throw new Error('控件未出现: ' + sel);
      };
      const out = {};
      s.openTimingPointDialog('edit', 0, { ...red });
      setInput(await q('[data-dialog="tpdlg"] [data-conv="bpmOrSv"]'), 'NaN');
      (await q('[data-tpdlg="ok"]')).click();
      await sleep(100);
      out.redApplied = Number.isNaN(s.beatmap.timingPoints[0].beatLength);
      s.undo();
      out.redUndo = s.beatmap.timingPoints[0].beatLength === 500;
      s.redo();
      out.redRedo = Number.isNaN(s.beatmap.timingPoints[0].beatLength);

      s.openTimingPointDialog('edit', 1, { ...green });
      setInput(await q('[data-dialog="tpdlg"] [data-conv="bpmOrSv"]'), 'NaN');
      (await q('[data-tpdlg="ok"]')).click();
      await sleep(100);
      out.greenApplied = Number.isNaN(s.beatmap.timingPoints[1].beatLength);
      s.emit(); // 两条 NaN 同时存在时, 三个拍点生成器都必须正常返回
      await sleep(200);
      out.renderAlive = true;

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true }));
      await sleep(300);
      (await q('[data-tp-row="0"] [data-tp-display="bpm"]')).click();
      setInput(await q('[data-tp-row="0"] [data-tp-input="bpm"]'), 'NaN');
      await sleep(80);
      out.inlineRed = Number.isNaN(s.beatmap.timingPoints[0].beatLength);
      (await q('[data-tp-row="1"] [data-tp-display="sv"]')).click();
      setInput(await q('[data-tp-row="1"] [data-tp-input="sv"]'), 'NaN');
      await sleep(80);
      out.inlineGreen = Number.isNaN(s.beatmap.timingPoints[1].beatLength);

      s.toggleGreenLineSelected(1000); s.emit();
      const batch = await q('[data-tp-batch-input="sv"]');
      out.batchExists = true;
      setInput(batch, 'NaN');
      await sleep(80);
      out.batchGreen = Number.isNaN(s.beatmap.timingPoints[1].beatLength);
      (await q('[data-tp-row="1"] [data-tp-editing]')).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(80);
      out.nanText = (await q('[data-tp-row="1"]')).textContent.includes('NaN');
      return out;
    })()`);

    for (const [key, label] of Object.entries({
      redApplied: '弹窗红线应用 NaN', redUndo: 'undo 恢复 500', redRedo: 'redo 保留 NaN',
      greenApplied: '弹窗绿线应用 NaN', renderAlive: 'NaN 下渲染不卡死',
      inlineRed: 'Timing 行内红线 NaN', inlineGreen: 'Timing 行内绿线 NaN',
      batchExists: '批量 SV 输入存在', batchGreen: '批量 SV 保留 NaN', nanText: '行文本显示 NaN',
    })) assert(result[key] === true, `${label} (${JSON.stringify(result)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V517_FAILED: ${failures} 处失败` : '\nVERIFIER_V517_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

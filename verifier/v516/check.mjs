// v516: 多选滑条锚点的旋转窗口也使用质心，不再使用 AABB 中心
// 运行: npm run build 后 node verifier/v516/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v516/_bundle.mjs');
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

console.log('== A: 锚点直接旋转/预览/提交单测');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v516/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '  ' + l).join('\n'));
} finally {
  if (fs.existsSync(out)) fs.unlinkSync(out);
}

console.log('== B: 源码契约');
{
  const st = read('src/osu/store.ts');
  const backup = st.match(/private nodeBackupCenter\(\): Pt \| null \{[\s\S]*?\n  \}/)?.[0] ?? '';
  const apply = st.match(/private applyNodeTransform\([\s\S]*?\n  \}/)?.[0] ?? '';
  for (const [name, src] of [['nodeBackupCenter', backup], ['applyNodeTransform', apply]]) {
    assert(/sumX \+= p\.x/.test(src) && /sumY \+= p\.y/.test(src), `${name} 使用质心`);
    assert(!/x0 \+ x1/.test(src) && !/minX|maxX/.test(src), `${name} 不再使用 AABB`);
  }
  assert(!/锚点包围盒中心/.test(st), 'store 锚点 AABB 注释已清理');
  const td = read('src/components/TransformDialog.tsx');
  assert(/anchor centroid/.test(td), '旋转窗口节点提示同步为质心');
}

console.log('== C: CDP 真实旋转窗口三锚点 120°');
{
  const PORT = 9530;
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
      const red = base.timingPoints.find(p => p.uninherited);
      const slider = { id: 516001, type: 'slider', x: 100, y: 100, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 200, y: 100 }, { x: 150, y: 187 }], slides: 1, length: 200 };
      s.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
      s.pause(); s.seek(5000); s.select([516001]);
      s.setSelectedNodes([[516001, 0], [516001, 1], [516001, 2]]);
      s.openTransformDialog('rotate');
      await sleep(300);
      const el = document.querySelector('[data-dialog="rotate-dlg"] [data-conv="angle"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '120');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
      const points = () => {
        const o = s.beatmap.hitObjects.find(o => o.id === 516001);
        return [{ x: o.x, y: o.y }, ...o.curvePoints];
      };
      const expected = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 187 }];
      const same = () => expected.every(q => points().some(p => Math.hypot(p.x - q.x, p.y - q.y) <= 1));
      const preview = { same: same(), points: points(), nodeCount: s.nodeSelectionCount,
        originHidden: !document.querySelector('[data-dialog="rotate-dlg"] [data-tf="origin-selection"]'),
        hint: document.querySelector('[data-dialog="rotate-dlg"]').textContent.includes('anchor centroid') };
      document.querySelector('[data-tf="apply-rotate"]').click();
      await sleep(250);
      return { preview, afterApply: { same: same(), points: points(), closed: !document.querySelector('[data-dialog="rotate-dlg"]'), undo: s.undoStack.length } };
    })()`);
    assert(result.preview.same && result.preview.nodeCount === 3 && result.preview.originHidden && result.preview.hint,
      `窗口预览确实走锚点质心 (${JSON.stringify(result.preview)})`);
    assert(result.afterApply.same && result.afterApply.closed && result.afterApply.undo === 1,
      `应用旋转仍保持等边三角形且一次 undo (${JSON.stringify(result.afterApply)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V516_FAILED: ${failures} 处失败` : '\nVERIFIER_V516_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

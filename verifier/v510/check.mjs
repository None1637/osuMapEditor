// v510: 对称滑条窗口取消/换选后绑定当前滑条（selected Set 原地修改，memo 必须依赖 id）
// 运行: npm run build 后 node verifier/v510/check.mjs
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
  const src = read('src/components/convert/SymSliderDialog.tsx');
  assert(/const selectedId = store\.selected\.size === 1/.test(src), '从 Set 提取单选 selectedId');
  assert(/\[bm, selectedId, store\.conversionDialog, store\.historySeq\]/.test(src), 'obj memo 依赖 selectedId + historySeq');
  assert(!/\[bm, store\.selected, store\.conversionDialog/.test(src), '不再依赖原地修改的 Set 引用');
}

console.log('== B: CDP A→空→B→A→B 预览与应用');
{
  const PORT = 9525;
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

    const state = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = (id, x, y) => ({ id, type: 'slider', x, y, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: x + 100, y }], slides: 1, length: 100 });
      s.load({ ...base, hitObjects: [mk(510001, 100, 100), mk(510002, 300, 300)], timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
      s.pause(); s.tool = 'select'; s.seek(5000); s.select([510001]);
      s.openConversion('symSlider');
      await sleep(350);
      const snap = () => ({
        hide: s.conversionPreview?.hideIds ?? null,
        first: s.conversionPreview?.objects[0] ? { id: s.conversionPreview.objects[0].id, x: s.conversionPreview.objects[0].x, y: s.conversionPreview.objects[0].y } : null,
        disabled: document.querySelector('[data-conv="apply"]')?.disabled,
        need: !!document.querySelector('[data-conv="apply"]'),
      });
      const a0 = snap();
      s.clearSelection(); await sleep(250);
      const empty = snap();
      s.select([510002]); await sleep(250);
      const b1 = snap();
      s.select([510001]); await sleep(250);
      const a1 = snap();
      s.select([510002]); await sleep(250);
      const b2 = snap();
      document.querySelector('[data-conv="apply"]').click();
      await sleep(300);
      const objs = s.beatmap.hitObjects;
      const replacement = objs.find(o => o.id !== 510001 && o.id !== 510002);
      return {
        a0, empty, b1, a1, b2,
        aKept: objs.some(o => o.id === 510001),
        bRemoved: !objs.some(o => o.id === 510002),
        replacement: replacement ? { x: replacement.x, y: replacement.y, type: replacement.type } : null,
        count: objs.length,
      };
    })()`);

    assert(state.a0.hide?.length === 1 && state.a0.hide[0] === 510001, `初始预览绑定 A (${JSON.stringify(state.a0)})`);
    assert(state.empty.hide === null && state.empty.disabled, `取消选择清预览且禁用 Apply (${JSON.stringify(state.empty)})`);
    for (const [name, snap, id, x, y] of [['重选 B', state.b1, 510002, 300, 300], ['直接回选 A', state.a1, 510001, 100, 100], ['直接再选 B', state.b2, 510002, 300, 300]]) {
      assert(snap.hide?.length === 1 && snap.hide[0] === id && snap.first?.x === x && snap.first?.y === y && !snap.disabled,
        `${name} 预览与 Apply 状态刷新 (${JSON.stringify(snap)})`);
    }
    assert(state.aKept && state.bRemoved && state.count === 2, `应用只替换 B、保留 A (${JSON.stringify(state)})`);
    assert(state.replacement?.type === 'slider' && state.replacement.x === 300 && state.replacement.y === 300,
      `拼接结果来自 B 而非旧 A (${JSON.stringify(state.replacement)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V510_FAILED: ${failures} 处失败` : '\nVERIFIER_V510_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

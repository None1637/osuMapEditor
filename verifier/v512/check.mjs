// v512: note 可视外缘命中；滑条身体只命中轨道，头尾圈仍按 note 外缘
// 运行: npm run build 后 node verifier/v512/check.mjs
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
  const src = read('src/components/EditorCanvas.tsx');
  assert(/sliderTailPoint\(bm, o\)/.test(src) && /r \* 0\.8125/.test(src), '滑条身体=轨道 0.8125r，最终尾圈保留');
  assert(/<= r\) hits\.push\(o\); \/\/ v512: note 不再外扩 10%/.test(src), 'note 命中 r，不再 r*1.1');
  assert(!/<= r \* 1\.1\) hits\.push/.test(src), '旧 note 外扩已移除');
}

console.log('== B: CDP 两种缩放下的边界真值表');
{
  const PORT = 9526;
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

    const rows = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const slider = { id: 512002, type: 'slider', x: 100, y: 100, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 };
      const circle = { id: 512001, type: 'circle', x: 400, y: 300, time: 5000, newCombo: false, comboSkip: 0, hitSound: 0 };
      s.load({ ...base, hitObjects: [slider, circle], timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
      s.pause(); s.tool = 'select'; s.seek(5000);
      s.playfieldPanEnabled = true; s.playfieldPanX = 0; s.playfieldPanY = 0; s.playfieldRotation = 0;
      const c = document.querySelector('canvas.cursor-crosshair');
      const r = 54.4 - 4.48 * s.beatmap.difficulty.cs;
      const track = r * 0.8125;
      const out = [];
      const click = async (name, x, y, expected) => {
        s.clearSelection(); s.setSelectedNodes([]);
        const pt = window.__osuToClient(x, y);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true }));
        await sleep(30);
        out.push({ name, expected, actual: [...s.selected], scale: s.playfieldScale });
      };
      for (const scale of [1, 1.6]) {
        s.playfieldScale = scale; s.emit(); await sleep(100);
        await click('note 内 r-1', 400 + r - 1, 300, 512001);
        await click('note 外 r+2 (旧 1.1r 内)', 400 + r + 2, 300, 0);
        await click('滑条身体内 track-1', 200, 100 + track - 1, 512002);
        await click('滑条身体边框 track+2', 200, 100 + track + 2, 0);
        await click('滑条头圈 0.9r (身体半径外)', 100 + r * 0.9, 100, 512002);
        await click('滑条头圈外 r+2', 100 - r - 2, 100, 0);
        await click('滑条尾圈 0.9r (身体半径外)', 300 + r * 0.9, 100, 512002);
        await click('滑条尾圈外 r+2', 300 + r + 2, 100, 0);
      }
      return out;
    })()`);

    for (const row of rows) {
      const ok = row.expected === 0 ? row.actual.length === 0 : row.actual.length === 1 && row.actual[0] === row.expected;
      assert(ok, `scale=${row.scale} ${row.name}: 期望 ${row.expected || '不选中'}，实际 ${JSON.stringify(row.actual)}`);
    }
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V512_FAILED: ${failures} 处失败` : '\nVERIFIER_V512_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

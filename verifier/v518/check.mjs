// v518: 上方时间轴按可视像素选中，非堆叠空白/圆外/零宽 Shift 单击不误选
// 运行: npm run build 后 node verifier/v518/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v518/_bundle.mjs');
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

console.log('== A: 纯函数像素边界');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v518/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '  ' + l).join('\n'));
} finally {
  if (fs.existsSync(out)) fs.unlinkSync(out);
}

console.log('== B: 源码契约');
{
  const th = read('src/osu/timelineHit.ts');
  assert(!/or \+ 3/.test(th), '头尾/repeat 去掉 rad+3 容差');
  const tl = read('src/components/Timelines.tsx');
  assert(!/si\.count <= 1/.test(tl), '非堆叠也提供显示几何');
  assert(/if \(mq\.moved\) \{[\s\S]{0,500}?marqueeObjectIds/.test(tl), '零宽单击不触发框选更新');
}

console.log('== C: CDP 两档缩放下空白/中心/右键/Shift');
{
  const PORT = 9532;
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
    // 曲库关闭/语言切换会移动时间轴；等 zoomRect 的 2s 缓存过期再换算点击坐标。
    await sleep(2100);

    const rows = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const circle = { id: 518001, type: 'circle', x: 100, y: 100, time: 3000, newCombo: true, comboSkip: 0, hitSound: 0 };
      const slider = { id: 518002, type: 'slider', x: 100, y: 200, time: 4000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 500, y: 200 }], slides: 2, length: 400 };
      s.load({ ...base, hitObjects: [circle, slider], timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
      s.pause(); s.beatmap.difficulty.sliderMultiplier = 1;
      const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('h-[92px]'));
      const z = Math.max(0.6, Math.min(1, Math.min(innerWidth / 2560, innerHeight / 1440)));
      const P = (ms, py) => {
        const r = c.getBoundingClientRect();
        const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
        const t0 = s.currentTime - win / 2;
        return { x: r.left + (ms - t0) / win * r.width, y: r.top + py * z };
      };
      const click = async (ms, py, opts = {}) => {
        const pt = P(ms, py);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true, ...opts }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, ...opts }));
        await sleep(60);
      };
      const out = [];
      for (const zoom of [1, 2]) {
        s.beatmap.editor.timelineZoom = zoom; s.seek(4000); s.clearSelection(); s.emit(); await sleep(80);
        await click(3000, 1);
        out.push({ zoom, case: '圆圈上方空白', sel: [...s.selected], count: s.beatmap.hitObjects.length });
        await click(3000, 30);
        out.push({ zoom, case: '圆圈中心', sel: [...s.selected] });
        s.clearSelection();
        await click(5000, 1);
        out.push({ zoom, case: 'repeat 上方空白', sel: [...s.selected] });
        await click(5000, 30);
        out.push({ zoom, case: 'repeat 中心', sel: [...s.selected] });
        s.clearSelection();
        const before = s.beatmap.hitObjects.length;
        const pt = P(3000, 1);
        c.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true }));
        await sleep(60);
        out.push({ zoom, case: '空白右键不删', before, after: s.beatmap.hitObjects.length, sel: [...s.selected] });
        s.clearSelection(); await click(3000, 30);
        await click(3000, 1, { shiftKey: true });
        out.push({ zoom, case: 'Shift 零宽空白保留原选区', sel: [...s.selected] });
      }
      return out;
    })()`);

    for (const row of rows) {
      if (row.case.includes('空白') && !row.case.includes('Shift')) assert(row.sel.length === 0, `zoom=${row.zoom} ${row.case}: ${JSON.stringify(row.sel)}`);
      else if (row.case === '圆圈中心') assert(row.sel.length === 1 && row.sel[0] === 518001, `zoom=${row.zoom} 圆圈中心: ${row.sel}`);
      else if (row.case === 'repeat 中心') assert(row.sel.includes(518002), `zoom=${row.zoom} repeat 中心: ${row.sel}`);
      else if (row.case === '空白右键不删') assert(row.before === row.after && row.sel.length === 0, `zoom=${row.zoom} 空白右键: ${row.before}→${row.after}`);
      else if (row.case.includes('Shift')) assert(row.sel.length === 1 && row.sel[0] === 518001, `zoom=${row.zoom} Shift 零宽: ${row.sel}`);
    }
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V518_FAILED: ${failures} 处失败` : '\nVERIFIER_V518_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

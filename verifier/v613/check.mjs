// v613: 拖动滑条中 Ctrl+G — 松手不回滚反转, 后续拖动/黄色包围框不再使用旧几何
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const canvas = read('src/components/EditorCanvas.tsx');
const store = read('src/osu/store.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(store.includes('transformSeq = 0') && store.includes('this.transformSeq++'), 'Ctrl+G 发布反转代数');
ok(canvas.includes('d.transformSeq !== store.transformSeq') && canvas.includes('rebaseObjectDragAfterTransform(d, d.lastP, store.transformSeq, d.objs)'), '拖拽应用旧位移前检测并重建反转基准');
ok(canvas.indexOf('rebaseObjectDragAfterTransform(d, d.lastP, store.transformSeq, d.objs)') < canvas.indexOf('let dx = Math.round(p.x - d.startX)'), '重建基准先于 orig+delta 写回, 黄色框不会拿到旧几何');

const out = path.join(root, 'verifier/v613/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v613/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

const PORT = 9501;
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result?.result?.value;
  };
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
  }
  if (!ready) throw new Error('应用未就绪');
  await normalizeEnv(evalJs);
  await sleep(500);

  const result = await evalJs(`(async () => {
    const store = window.__osuStore;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const run = async continueDrag => {
      const bm = store.beatmap;
      store.load({ ...bm, hitObjects: [{ id: 990001, type: 'slider', x: 100, y: 100, time: 0,
        curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100,
        hitSound: 0, newCombo: false, comboSkip: 0 }] }, store.audioUrl);
      store.pause(); store.seek(0); store.tool = 'select';
      store.gridSnap = false; store.objectSnapEnabled = false; store.geoEnabled = false;
      store.distanceLock = false; store.limitToPlayfield = false;
      store.select([990001]); store.emit();
      document.activeElement?.blur();
      await sleep(100);
      const c = document.querySelector('canvas.cursor-crosshair');
      const p = window.__osuToClient(150, 110), p1 = window.__osuToClient(170, 110), p2 = window.__osuToClient(190, 110);
      const fire = (type, q) => c.dispatchEvent(new MouseEvent(type, { clientX: q.x, clientY: q.y, button: 0, bubbles: true, cancelable: true }));
      fire('mousemove', p); fire('mousedown', p); fire('mousemove', p1); await sleep(120);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(80);
      const o = store.beatmap.hitObjects[0];
      const afterReverse = { x: o.x, tail: o.curvePoints[0].x };
      if (continueDrag) { fire('mousemove', p2); await sleep(120); }
      const afterContinue = { x: o.x, tail: o.curvePoints[0].x, dragging: store.canvasDragging, transformSeq: store.transformSeq };
      fire('mouseup', continueDrag ? p2 : p1); await sleep(80);
      return { afterReverse, afterContinue, final: { x: o.x, tail: o.curvePoints[0].x } };
    };
    return { stop: await run(false), continued: await run(true) };
  })()`);
  ok(result.stop.afterReverse.x === 220 && result.stop.final.x === 220 && result.stop.final.tail === 120,
    `拖动后 Ctrl+G 直接松手保留反转 (${JSON.stringify(result.stop)})`);
  ok(result.continued.afterReverse.x === 220 && result.continued.final.x === 240 && result.continued.final.tail === 140,
    `反转后继续拖动使用新基准 (${JSON.stringify(result.continued)})`);
  ws.close();
} catch (e) {
  failures++;
  console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
} finally {
  await killIsolated(electron, profile);
}

execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
console.log('  ok: tsc -b 通过');
console.log(failures ? `VERIFIER_V613_FAILED: ${failures}` : 'VERIFIER_V613_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

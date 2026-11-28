// v614: 拖动中旋转/镜像/方向键微调与 Ctrl+G 一样重建物件拖拽几何基准
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const store = read('src/osu/store.ts');
const canvas = read('src/components/EditorCanvas.tsx');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const seqWrites = store.match(/this\.transformSeq\+\+/g) ?? [];
ok(seqWrites.length >= 5, `反转/旋转镜像缩放/节点变换/微调/对称均发布统一变换代数 (${seqWrites.length})`);
ok(canvas.includes('d.transformSeq !== store.transformSeq') && canvas.includes('rebaseObjectDragAfterTransform(d, d.lastP, store.transformSeq, d.objs)'), '物件拖拽统一响应全部离散几何变换');
ok(!canvas.includes('reverseSeq') && !store.includes('reverseSeq'), '不再只监听 Ctrl+G 专用代数');

const PORT = 9502;
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
    const run = async (key, code) => {
      const bm = store.beatmap;
      store.load({ ...bm, hitObjects: [{ id: 990001, type: 'slider', x: 100, y: 100, time: 0,
        curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100,
        hitSound: 0, newCombo: false, comboSkip: 0 }] }, store.audioUrl);
      store.pause(); store.seek(0); store.tool = 'select';
      store.gridSnap = false; store.objectSnapEnabled = false; store.geoEnabled = false;
      store.distanceLock = false; store.limitToPlayfield = false;
      store.select([990001]); store.emit(); document.activeElement?.blur(); await sleep(80);
      const c = document.querySelector('canvas.cursor-crosshair');
      const p = window.__osuToClient(150, 110), p1 = window.__osuToClient(170, 110), p2 = window.__osuToClient(190, 110);
      const fire = (type, q) => c.dispatchEvent(new MouseEvent(type, { clientX: q.x, clientY: q.y, button: 0, bubbles: true, cancelable: true }));
      fire('mousemove', p); fire('mousedown', p); fire('mousemove', p1); await sleep(100);
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(60);
      const o = store.beatmap.hitObjects[0];
      const transformed = { x: o.x, y: o.y, tailX: o.curvePoints[0].x, tailY: o.curvePoints[0].y };
      fire('mousemove', p2); await sleep(100); fire('mouseup', p2); await sleep(60);
      return { transformed, final: { x: o.x, y: o.y, tailX: o.curvePoints[0].x, tailY: o.curvePoints[0].y } };
    };
    return {
      flip: await run('h', 'KeyH'),
      rotate: await run(',', 'Comma'),
      nudge: await run('ArrowRight', 'ArrowRight'),
    };
  })()`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(same(result.flip.transformed, { x: 392, y: 100, tailX: 292, tailY: 100 }) && same(result.flip.final, { x: 412, y: 100, tailX: 312, tailY: 100 }),
    `Ctrl+H 镜像后继续拖动不还原 (${JSON.stringify(result.flip)})`);
  ok(same(result.rotate.transformed, { x: 164, y: 328, tailX: 164, tailY: 228 }) && same(result.rotate.final, { x: 184, y: 328, tailX: 184, tailY: 228 }),
    `Ctrl+, 旋转后继续拖动不还原 (${JSON.stringify(result.rotate)})`);
  ok(same(result.nudge.transformed, { x: 121, y: 100, tailX: 221, tailY: 100 }) && same(result.nudge.final, { x: 141, y: 100, tailX: 241, tailY: 100 }),
    `Ctrl+方向键微调后继续拖动不还原 (${JSON.stringify(result.nudge)})`);
  ws.close();
} catch (e) {
  failures++;
  console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
} finally {
  await killIsolated(electron, profile);
}

execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
console.log('  ok: tsc -b 通过');
console.log(failures ? `VERIFIER_V614_FAILED: ${failures}` : 'VERIFIER_V614_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// v514: 时间轴滚轮短手势补步 + 播放中显式 seek 清防闪回下限
// 运行: npm run build 后 node verifier/v514/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v514/_bundle.mjs');
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

console.log('== A: 手势计时单测');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v514/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '  ' + l).join('\n'));
} finally {
  if (fs.existsSync(out)) fs.unlinkSync(out);
}

console.log('== B: 源码契约');
{
  const st = read('src/osu/store.ts');
  assert(/WHEEL_GESTURE_END_MS = 90/.test(st) && /wheelGestureHadSteps/.test(st), '90ms 手势结束与已出刻度状态');
  assert(/!this\.wheelGestureHadSteps && this\.wheelAccum\.acc !== 0/.test(st), '仅未出刻度的短手势补步');
  assert((st.match(/this\.resetWheelGesture\(\); \/\/ v514/g) ?? []).length >= 3, '显式 seek/播放 seek/换谱取消旧补步');
  assert(/this\.resumeFloorMs = null; \/\/ v514: 显式重定位/.test(st), '播放 seek 清旧防闪回下限');
}

console.log('== C: CDP 上下时间轴 + 播放向后滚');
{
  const PORT = 9528;
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
    const ready = await evalJs(`(async () => { const s = window.__osuStore; for (let i = 0; i < 120 && !s.audioBuffer; i++) await new Promise(r => setTimeout(r, 250)); return !!s.audioBuffer; })()`);
    assert(ready, '音频解码完成（播放中回归）');

    const result = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const top = [...document.querySelectorAll('canvas')].find(c => c.className.includes('h-[92px]'));
      const bottom = [...document.querySelectorAll('canvas')].find(c => c.className.includes('flex-1') && c.className.includes('cursor-pointer'));
      const wheel = (c, dy, mode = 0) => c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: mode, bubbles: true, cancelable: true }));
      const out = { topFound: !!top, bottomFound: !!bottom };
      const red = s.beatmap.timingPoints.find(p => p.uninherited);
      s.beatmap.timingPoints = [{ ...red, time: 0, beatLength: 500 }];
      s.beatSnap = 4; s.emit();
      s.pause(); s.seek(5000);
      wheel(top, 40); wheel(top, 40);
      out.topImmediate = s.currentTime;
      await sleep(140);
      out.topAfter = s.currentTime;
      s.seek(5000);
      wheel(bottom, 40); wheel(bottom, 40);
      await sleep(140);
      out.bottomAfter = s.currentTime;

      s.pause(); s.seek(10000); s.playbackRate = 1; s.play();
      wheel(top, -120);
      await sleep(160);
      out.playAfter = { position: s.positionMs(), current: s.currentTime, floor: s.resumeFloorMs };
      s.pause();
      return out;
    })()`);
    assert(result.topFound && result.bottomFound, '上下时间轴 canvas 均找到');
    assert(result.topImmediate === 5000 && result.topAfter === 5125, `上时间轴 40+40 静默后补一步 (${result.topImmediate}→${result.topAfter})`);
    assert(result.bottomAfter === 5125, `下时间轴 40+40 静默后补一步 (${result.bottomAfter})`);
    assert(result.playAfter.position < 9900 && result.playAfter.current < 10000 && result.playAfter.floor === null,
      `恢复播放立即向后滚不被旧暂停点钳回 (${JSON.stringify(result.playAfter)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V514_FAILED: ${failures} 处失败` : '\nVERIFIER_V514_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

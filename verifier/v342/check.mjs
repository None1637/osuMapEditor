// CDP check v342 (Electron / production): hover 滑条点预览消失时机对齐 stable
//   修复前: 暂留模式 (打击动画关) 下 hover 预览按 isVisibleAt 的 HIT_LINGER(800ms) 残留,
//     滑条结束后 ~800ms 仍能看到控制点连线 (soulten: 00:16.861 结束的滑条 00:17.639 还有线)
//   修复后: hover 预览/Alt 锚点环门控收紧到 滑条身消失时机 (end+HIT_FADE=240ms)
//   验证: end+100ms hover 有预览 (控制点手柄像素差), end+500ms hover 无预览
// 运行: npm run build 后 node verifier/v342/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9442;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'none', clickCount: 0, buttons: 0,
});

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 单滑条场景 + 暂留模式 (hitAnimation 关 → 滑条残留窗 800ms, 只有这种模式下旧门控才露馅)
  const info = await evalJs(`(() => {
    const store = window.__osuStore;
    store.setDisplayFlag('hitAnimation', false);
    store.setDisplayFlag('hitExplosion', true);
    const base = store.beatmap;
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const red = base.timingPoints.find(p => p.uninherited);
    const LEN = 300;
    const slider = { ...ts, id: 424242, time: 5000, x: 200, y: 192,
      curvePoints: [{ x: 260, y: 130 }, { x: 340, y: 192 }], curveType: 'B', slides: 1, length: LEN };
    store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.select([]); store.setSelectedNodes([]);
    // duration = length/(SM*100*SV) * beatLength * slides (SV=1: 仅一条红线)
    const dur = LEN / (base.difficulty.sliderMultiplier * 100) * red.beatLength;
    return { end: 5000 + dur };
  })()`);
  const end = info.end;
  console.log('  滑条结束时间 end =', end.toFixed(0));

  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  // hover 落点: 滑条路径起点附近 (确保 hover 命中); 采样区: 控制点 cp1 (260,130) 周边 (不在路径身体上)
  const pHover = await toPage(206, 192);
  const pCp1 = await toPage(260, 130);

  // hover 状态与无 hover 状态各截一次采样区, 统计差异像素 (>30 通道差)
  const diffAt = async () => {
    await mouse('mouseMoved', pHover.x, pHover.y);
    await sleep(250);
    const hoverShot = await evalJs(`(() => {
      const c = document.querySelector('canvas'); const g = c.getContext('2d');
      const r = c.getBoundingClientRect(); const sx = c.width / r.width;
      const cx = ${pCp1.x} - r.left, cy = ${pCp1.y} - r.top;
      return Array.from(g.getImageData(Math.floor(cx * sx) - 14, Math.floor(cy * sx) - 14, 28, 28).data);
    })()`);
    await mouse('mouseMoved', 4, 4); // 移出画布 (左上角工具栏区) → hover 清除
    await sleep(250);
    const diff = await evalJs(`(() => {
      const c = document.querySelector('canvas'); const g = c.getContext('2d');
      const r = c.getBoundingClientRect(); const sx = c.width / r.width;
      const cx = ${pCp1.x} - r.left, cy = ${pCp1.y} - r.top;
      const b = g.getImageData(Math.floor(cx * sx) - 14, Math.floor(cy * sx) - 14, 28, 28).data;
      const a = ${JSON.stringify(hoverShot)};
      let n = 0;
      for (let i = 0; i < b.length; i += 4)
        if (Math.abs(a[i] - b[i]) > 30 || Math.abs(a[i + 1] - b[i + 1]) > 30 || Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
      return n;
    })()`);
    return diff;
  };

  // tA = end+100 (< HIT_FADE 240): 预览应存在
  await evalJs(`window.__osuStore.seek(${end + 100})`);
  await sleep(300);
  const dA = await diffAt();
  console.log('  end+100ms 预览差异像素:', dA);
  assert(dA > 20, `end+100ms hover 预览仍可见 (差异像素 ${dA})`);

  // tB = end+500 (> HIT_FADE 240, < HIT_LINGER 800): 预览应消失 (修复前仍在)
  await evalJs(`window.__osuStore.seek(${end + 500})`);
  await sleep(300);
  const dB = await diffAt();
  console.log('  end+500ms 预览差异像素:', dB);
  assert(dB <= 20, `end+500ms hover 预览已消失 (差异像素 ${dB}, 修复前 >20)`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v342 全部通过');
process.exit(failures ? 1 : 0);

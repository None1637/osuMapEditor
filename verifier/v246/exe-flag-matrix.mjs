// v246 exe flag 矩阵: 逐个尝试 Chromium 开关, 找让 exe 恢复高帧率的组合
// 用法: node verifier/v246/exe-flag-matrix.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const FOLDER = 'beatmap-639217845366573336-audio';
const FILE = 'cygnus - Book of Dark Magic (None1637) [Magic].osu';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FLAGS = [
  ['基线', []],
  ['disable-frame-rate-limit + disable-gpu-vsync', ['--disable-frame-rate-limit', '--disable-gpu-vsync']],
  ['enable-gpu-rasterization', ['--enable-gpu-rasterization']],
  ['disable-features=DynamicParams', ['--disable-features=DynamicParams']],
];

const MEASURE_JS = `(async () => new Promise(resolve => {
  const deltas = []; let last = 0; const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    else {
      const s = [...deltas].sort((a, b) => a - b);
      resolve({ fps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1),
        p50: +s[Math.floor(s.length * 0.5)].toFixed(2) });
    }
  };
  requestAnimationFrame(tick);
}))()`;

for (const [label, flags] of FLAGS) {
  const port = 9450 + FLAGS.indexOf([label, flags]);
  const exe = spawn(EXE, [`--remote-debugging-port=${port}`, ...flags], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
      } catch { /* not ready */ }
      if (!target) await sleep(400);
    }
    if (!target) { console.log(label, ': CONNECT_FAILED'); continue; }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => {
      const id = ++msgId;
      return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    };
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    for (let i = 0; i < 40; i++) {
      if (await evalJs('!!window.__osuMenuCmd').catch(() => false)) break;
      await sleep(400);
    }
    await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: ${JSON.stringify(FOLDER)}, file: ${JSON.stringify(FILE)} }).then(() => 1).catch(() => 0)`);
    await sleep(1200);
    await evalJs(`(() => { const s = window.__osuStore; if (!s.beatmap) return 0;
      const ts = s.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b); s.seek(ts[Math.floor(ts.length/2)]); return 1; })()`);
    await sleep(800);
    console.log(label, ':', JSON.stringify(await evalJs(MEASURE_JS)));
  } finally {
    try { exe.kill(); } catch { /* noop */ }
    // portable 壳杀不干净, 兜底按调试端口找残留主进程杀掉
    await sleep(800);
  }
}
// 清理: 杀掉本次矩阵测试残留的全部 exe 实例 (通过命令行里的 remote-debugging-port 945x 识别)
const { execSync } = await import('child_process');
try {
  const out = execSync(`powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='osu! Map Editor.exe'\\" | Where-Object { \\$_.CommandLine -match 'remote-debugging-port=945' } | ForEach-Object { \\$_.ProcessId }"`).toString();
  for (const pid of out.split(/\s+/).filter(Boolean)) {
    try { execSync(`taskkill /PID ${pid} /T /F`); } catch { /* noop */ }
  }
} catch { /* noop */ }
process.exit(0);

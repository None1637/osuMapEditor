// v246 GPU 对比: Electron vs headed Edge 的 chrome://gpu 关键项
// 用法: node verifier/v246/gpu-compare.mjs
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function dumpGpu(name, bin, args, cwd) {
  const port = name === 'electron' ? 9470 : 9471;
  const proc = spawn(bin, [...args, `--remote-debugging-port=${port}`], { cwd, stdio: 'ignore' });
  const kill = () => { try { process.kill(proc.pid); } catch { /* noop */ } };
  try {
    let ver;
    for (let i = 0; i < 40 && !ver; i++) {
      try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(500); }
    }
    if (!ver) { console.log(name + ': CONNECT_FAILED'); return null; }
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pend.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const gi = await send('SystemInfo.getInfo');
    ws.close();
    const g = gi.result?.gpu;
    if (!g) { console.log(name + ': no gpu info'); return null; }
    return {
      browser: ver['Browser'],
      device: g.devices?.[0]?.deviceString,
      driver: g.driverVersion,
      featureStatus: g.featureStatus?.featureStatus ?? g.featureStatus,
      workarounds: (g.driverBugWorkarounds ?? []).length,
    };
  } finally { kill(); await sleep(500); }
}

const edgeExe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const edgeBin = fs.existsSync(edgeExe) ? edgeExe : 'C:/Program Files/Microsoft/Edge/Application/msedge.exe';

const el = await dumpGpu('electron', path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.'], root);
const ed = await dumpGpu('edge', edgeBin, ['--user-data-dir=' + path.join(root, 'verifier', 'v246', '.edge-profile-gpu'), 'about:blank'], root);

console.log('== electron ==');
console.log(JSON.stringify(el, null, 1));
console.log('== edge ==');
console.log(JSON.stringify(ed, null, 1));
if (el && ed) {
  console.log('== feature diff (electron vs edge) ==');
  const keys = new Set([...Object.keys(el.featureStatus ?? {}), ...Object.keys(ed.featureStatus ?? {})]);
  for (const k of keys) {
    if (el.featureStatus?.[k] !== ed.featureStatus?.[k]) console.log(`  ${k}: electron=${el.featureStatus?.[k]} edge=${ed.featureStatus?.[k]}`);
  }
}
process.exit(0);

// CDP v46 端到端: 皮肤目录 followpoint 读取 — 序列帧命名 (followpoint-0.png) / @2x 半尺寸
// 页面内构造 mock FsDirLike 直调 window.__osuSkin.applySkinFromDir (与皮肤面板/服务器直读同管线)
// 注意: 长 Promise 走「同步启动 + 轮询 window.__skinJob」, 不用 awaitPromise (V8 inspector 会偶发
//       "Promise was collected" 把跨动态 import 的 promise 提前回收)
// 运行: node verifier/v46/cdp-v46.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9377;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v46-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
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
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function waitJob() {
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const v = await evalJs('window.__skinJob');
    if (v) return v;
  }
  throw new Error('__skinJob 超时未完成');
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas && window.__osuSkin)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 布景: c2(200,100)@1500 -> c3(300,100)@2000, follow point 在 (248,100); seek(1700) 到位
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.hitObjects = [
        { id: 98102, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98103, type: 'circle', x: 300, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.clearSelection();
      s.seek(1700);
      s.emit();
      window.__pfPixel = (ox, oy) => {
        const p = window.__osuToCanvas(ox, oy);
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const d = c.getContext('2d').getImageData(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] + d[i + 1] + d[i + 2] > 60) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        }
        return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)].join(',') : '0,0,0';
      };
      // mock 皮肤目录: 内存生成指定文件名的纯色 PNG, 其余文件名 reject (模拟缺失)
      window.__mockSkin = (name, size, color) => new Promise(res => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, size, size);
        c.toBlob(blob => {
          const file = new File([blob], name);
          res({
            kind: 'directory', name: 'mock',
            entries: (async function* () { }),
            getFileHandle: (n) => n === name
              ? Promise.resolve({ kind: 'file', name: n, getFile: () => Promise.resolve(file) })
              : Promise.reject(new Error('不存在: ' + n)),
          });
        }, 'image/png');
      });
      // 同步启动皮肤加载, 结果落 __skinJob (轮询读取, 避开 awaitPromise 的 Promise-collected 坑)
      window.__loadSkin = (name, size, color) => {
        window.__skinJob = null;
        window.__mockSkin(name, size, color)
          .then(dir => window.__osuSkin.applySkinFromDir(dir, 'mock'))
          .then(r => {
            const fp = window.__osuSkin.getSkin().followpoint;
            window.__skinJob = { loaded: r.loaded, w: fp.width, adj: window.__osuSkin.skinScaleAdjust.get(fp) ?? 1 };
            window.__osuStore.emit();
          })
          .catch(e => { window.__skinJob = { error: String(e) }; });
        return 'started';
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 皮肤目录只有序列帧 followpoint-0.png (无 followpoint.png) 也能读到');
  {
    await evalJs(`window.__loadSkin('followpoint-0.png', 16, '#ff0000')`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    assert(job.loaded === 1, `加载到 1 张贴图 (实际 ${job.loaded})`);
    assert(job.w === 16 && job.adj === 1, `followpoint = 序列帧图 (16px, adj=1; 实际 ${job.w}/${job.adj})`);
    await sleep(400);
    const px = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = px.split(',').map(Number);
    assert(r > 150 && r > g * 2 && r > b * 2, `follow point 显示皮肤目录的红色序列帧 (${px})`);
  }

  console.log('== B) @2x 高清贴图按半尺寸绘制 (ScaleAdjust=2, 不放大)');
  {
    await evalJs(`window.__loadSkin('followpoint@2x.png', 64, '#00ff00')`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    assert(job.loaded === 1 && job.w === 64, `加载 @2x 贴图 (64px, 实际 ${job.loaded}/${job.w})`);
    assert(job.adj === 2, `ScaleAdjust=2 (实际 ${job.adj})`);
    await sleep(400);
    const px = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = px.split(',').map(Number);
    assert(g > 120 && g > r * 1.5 && g > b * 1.5, `@2x follow point 显示绿色 (${px})`);
    // 半尺寸: 绘制宽 = 64/2 * (36.5/64) ≈ 18px, 中心 248 → 边缘 ~257; 若未半尺寸则宽 ~36px 会盖到 264
    const far = await evalJs('window.__pfPixel(264, 100)');
    const [r2, g2] = far.split(',').map(Number);
    assert(!(g2 > 120 && g2 > r2 * 1.5), `264px 处已无绿色 (按半尺寸绘制, 实际 ${far})`);
  }

  console.log('== C) 恢复默认皮肤后 followpoint 回退正常');
  {
    await evalJs(`window.__osuSkin.resetSkinToDefault(); window.__osuStore.emit(); 'ok'`);
    await sleep(600);
    const bright = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = bright.split(',').map(Number);
    assert(r + g + b > 200, `默认皮肤 follow point 仍绘制 (${bright})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V46_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V46_CDP_PASSED');

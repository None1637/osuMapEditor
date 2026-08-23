// CDP v47 端到端: followpoint 序列帧动画 (followpoint-0..9.png, 空白帧 0-3/7-9 + 红帧 4-6, 仿用户皮肤)
// 帧时长: 无 skin.ini -> 1000/10=100ms (lazer getFrameLength); 有 AnimationFramerate: 20 -> 50ms
// 运行: node verifier/v47/cdp-v47.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9379;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v47-'));
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

  // 布景: c2(200,100)@1500 -> c3(300,100)@2000; c2->c3 follow point 在 (248,100), animStart=fadeInTime=940
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.hitObjects = [
        { id: 98202, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98203, type: 'circle', x: 300, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.clearSelection();
      s.seek(1400);
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
      // mock 皮肤目录: files = { 文件名: { size, color } | { text } }
      window.__loadSkinMap = (files) => {
        window.__skinJob = null;
        const png = (size, color) => new Promise(res => {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const g = c.getContext('2d');
          g.fillStyle = color; g.fillRect(0, 0, size, size);
          c.toBlob(blob => res(new File([blob], 'x.png')), 'image/png');
        });
        Promise.all(Object.entries(files).map(async ([name, spec]) => [name, spec.text !== undefined
          ? new File([spec.text], name)
          : await png(spec.size, spec.color)])).then(entries => {
          const map = new Map(entries);
          const dir = {
            kind: 'directory', name: 'mock',
            entries: (async function* () { }),
            getFileHandle: (n) => map.has(n)
              ? Promise.resolve({ kind: 'file', name: n, getFile: () => Promise.resolve(map.get(n)) })
              : Promise.reject(new Error('不存在: ' + n)),
          };
          return window.__osuSkin.applySkinFromDir(dir, 'mock-frames');
        }).then(r => {
          const sk = window.__osuSkin.getSkin();
          window.__skinJob = { loaded: r.loaded, frames: sk.followpointFrames.length, frameMs: sk.followpointFrameMs };
          window.__osuStore.emit();
        }).catch(e => { window.__skinJob = { error: String(e) }; });
        return 'started';
      };
      // 仿用户皮肤: followpoint-0..9, 空白帧 0-3/7-9 (1x1), 红帧 4-6 (128x128)
      window.__frameFiles = (ini) => {
        const files = {};
        for (let i = 0; i <= 9; i++) {
          const arrow = i >= 4 && i <= 6;
          files['followpoint-' + i + '.png'] = { size: arrow ? 128 : 1, color: arrow ? '#ff0000' : '#ffffff' };
        }
        if (ini) files['skin.ini'] = { text: ini };
        return files;
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 10 帧动画, 无 skin.ini -> 整圈 1s (frameMs=100)');
  {
    await evalJs('window.__loadSkinMap(window.__frameFiles(null))');
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    assert(job.frames === 10, `加载 10 帧 (实际 ${job.frames})`);
    assert(job.frameMs === 100, `frameMs = 1000/10 = 100 (实际 ${job.frameMs})`);
    // t=1400: 帧 floor((1400-940)/100)=4 -> 红箭头帧 (alpha 淡入中 ~0.575)
    await evalJs('window.__osuStore.seek(1400); "ok"');
    await sleep(400);
    const px = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = px.split(',').map(Number);
    assert(r > 100 && r > g * 2 && r > b * 2, `t=1400 显示红帧 4 (${px})`);
    // t=1700: 帧 7 -> 空白帧 (不可见)
    await evalJs('window.__osuStore.seek(1700); "ok"');
    await sleep(400);
    const blank = await evalJs('window.__pfPixel(248, 100)');
    const [r2, g2, b2] = blank.split(',').map(Number);
    assert(!(r2 > 100 && r2 > g2 * 2), `t=1700 空白帧 7, 红箭头消失 (${blank})`);
  }

  console.log('== B) skin.ini AnimationFramerate: 20 -> frameMs=50, 同时刻帧不同');
  {
    await evalJs(`window.__loadSkinMap(window.__frameFiles('[General]\\nAnimationFramerate: 20\\n'))`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    assert(job.frames === 10 && job.frameMs === 50, `frameMs = 1000/20 = 50 (实际 ${job.frames}/${job.frameMs})`);
    // t=1700: 帧 floor((1700-940)/50)=15%10=5 -> 红箭头帧
    await evalJs('window.__osuStore.seek(1700); "ok"');
    await sleep(400);
    const px = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = px.split(',').map(Number);
    assert(r > 100 && r > g * 2 && r > b * 2, `frameMs=50 时 t=1700 显示红帧 5 (${px})`);
  }

  console.log('== C) 单帧 followpoint-0.png 仍兼容 (frames=1, 静态显示)');
  {
    await evalJs(`window.__loadSkinMap({ 'followpoint-0.png': { size: 16, color: '#0000ff' } })`);
    const job = await waitJob();
    assert(!job.error && job.frames === 1, `单帧组加载 (实际 ${JSON.stringify(job)})`);
    await sleep(400);
    const px = await evalJs('window.__pfPixel(248, 100)');
    const [r, g, b] = px.split(',').map(Number);
    assert(b > 120 && b > r * 1.5 && b > g * 1.5, `蓝色单帧静态显示 (${px})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V47_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V47_CDP_PASSED');

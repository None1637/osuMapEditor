// CDP v48 端到端: followpoint 尺寸对齐 lazer WithMaximumSize 居中裁剪 (128x64 上限, 非等比缩放)
// 布景: c2(200,100)@1500 -> c3(300,100)@2000, CS4 (k = 36.48/64 = 0.57)
//   follow point 在 (248,100); 128x128 帧 -> 裁 128x64 -> 绘制 73x36.5 osu px (半宽 36.5 / 半高 18.2)
//   v47 错误实现: 等比缩 64x64 -> 绘制 36.5x36.5 -> 视觉间距偏宽
// 运行: node verifier/v48/cdp-v48.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9380;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v48-'));
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

  // 布景: c2(200,100)@1500 -> c3(300,100)@2000; follow point 在 (248,100), fadeIn 940, fadeOut 1740
  // t=1800: 缩放动画已完成 (aIn=1 -> scale=1), alpha~0.93; 单点 (distance=100 只有 d=48 一个点)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.difficulty.ar = 5; s.beatmap.difficulty.cs = 4; s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.hitObjects = [
        { id: 98302, type: 'circle', x: 200, y: 100, time: 1500, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 98303, type: 'circle', x: 300, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.clearSelection();
      s.seek(1800);
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
      // mock 皮肤目录: spec = { size, color } 纯色 | { size, left, right } 左右半色
      window.__loadSkinMap = (files) => {
        window.__skinJob = null;
        const png = (spec) => new Promise(res => {
          const c = document.createElement('canvas');
          c.width = c.height = spec.size;
          const g = c.getContext('2d');
          if (spec.left) {
            g.fillStyle = spec.left; g.fillRect(0, 0, spec.size / 2, spec.size);
            g.fillStyle = spec.right; g.fillRect(spec.size / 2, 0, spec.size / 2, spec.size);
          } else {
            g.fillStyle = spec.color; g.fillRect(0, 0, spec.size, spec.size);
          }
          c.toBlob(blob => res(new File([blob], 'x.png')), 'image/png');
        });
        Promise.all(Object.entries(files).map(async ([name, spec]) => [name, await png(spec)])).then(entries => {
          const map = new Map(entries);
          const dir = {
            kind: 'directory', name: 'mock',
            entries: (async function* () { }),
            getFileHandle: (n) => map.has(n)
              ? Promise.resolve({ kind: 'file', name: n, getFile: () => Promise.resolve(map.get(n)) })
              : Promise.reject(new Error('不存在: ' + n)),
          };
          return window.__osuSkin.applySkinFromDir(dir, 'mock-crop');
        }).then(r => {
          window.__skinJob = { loaded: r.loaded };
          window.__osuStore.seek(1800);
          window.__osuStore.emit();
        }).catch(e => { window.__skinJob = { error: String(e) }; });
        return 'started';
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 128x128 左蓝右红单图: 裁 128x64 -> 宽 73 osu px (非等比缩 36.5)');
  {
    await evalJs(`window.__loadSkinMap({ 'followpoint.png': { size: 128, left: '#0000ff', right: '#ff0000' } })`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    await sleep(400);
    // 左侧无遮挡 (c2 已消失): 左半蓝延伸到 -28 osu px (等比缩放半宽只有 18.2, 这里会是背景)
    const pl = await evalJs('window.__pfPixel(220, 100)');
    const [rl, gl, bl] = pl.split(',').map(Number);
    assert(bl > 100 && bl > rl * 2 && bl > gl * 2, `左侧 -28 osu px 为蓝 (${pl})`);
    // 右半红也绘制 (裁剪只切上下, 全宽内容保留)
    const pr = await evalJs('window.__pfPixel(260, 100)');
    const [rr, gr, br] = pr.split(',').map(Number);
    assert(rr > 100 && rr > gr * 2 && rr > br * 2, `右侧 +12 osu px 为红 (${pr})`);
    // 宽度上限: -40 osu px 超出半宽 36.5 -> 背景
    const po = await evalJs('window.__pfPixel(208, 100)');
    const [ro, go, bo] = po.split(',').map(Number);
    assert(!(bo > 100 && bo > ro * 1.5), `-40 osu px 超出绘制宽度 (${po})`);
    // 高度上限: 半高 18.2 -> +25 osu px 为背景
    const pv = await evalJs('window.__pfPixel(248, 125)');
    const [rv, gv, bv] = pv.split(',').map(Number);
    assert(!(rv > 100 && rv > bv * 1.5) && !(bv > 100 && bv > rv * 1.5), `垂直 +25 osu px 超出半高 (${pv})`);
    // 中心仍绘制
    const pc = await evalJs('window.__pfPixel(248, 100)');
    assert(pc !== '0,0,0', `中心有绘制 (${pc})`);
  }

  console.log('== B) @2x 256x256 绿单图: ScaleAdjust=2, 同样裁到显示 128x64');
  {
    await evalJs(`window.__loadSkinMap({ 'followpoint@2x.png': { size: 256, color: '#00cc00' } })`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    await sleep(400);
    const pr = await evalJs('window.__pfPixel(220, 100)');
    const [rr, gr, br] = pr.split(',').map(Number);
    assert(gr > 80 && gr > rr * 1.5 && gr > br * 1.5, `@2x 左侧 -28 osu px 为绿 (${pr})`);
    const po = await evalJs('window.__pfPixel(208, 100)');
    const [ro, go, bo] = po.split(',').map(Number);
    assert(!(go > 80 && go > ro * 1.5), `@2x -40 osu px 超出绘制宽度 (${po})`);
  }

  console.log('== C) 32x32 小黄图: 未超限不裁不放, 绘制 18.2x18.2 osu px');
  {
    await evalJs(`window.__loadSkinMap({ 'followpoint.png': { size: 32, color: '#cccc00' } })`);
    const job = await waitJob();
    assert(!job.error, `加载无错误 (${job.error ?? 'ok'})`);
    await sleep(400);
    const pc = await evalJs('window.__pfPixel(253, 100)');
    const [rc, gc, bc] = pc.split(',').map(Number);
    assert(rc > 80 && gc > 80 && bc < rc / 2, `中心 +5 osu px 为黄 (${pc})`);
    const po = await evalJs('window.__pfPixel(268, 100)');
    const [ro, go, bo] = po.split(',').map(Number);
    assert(!(ro > 80 && go > 80 && bo < ro / 2), `+20 osu px 超出小图半宽 9.1 (${po})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V48_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V48_CDP_PASSED');

// CDP v38 端到端: F3 多个物件合并为滑条 — 多选 -> 点按钮直接应用 (无窗口) -> 结构断言 -> 像素探针 -> undo
//   A) 多选 (圆+B滑条+圆) -> Inspector「合并为滑条」按钮出现 -> 点击 -> 无参数窗口直接应用 (一次 undo)
//   B) 谱面结构: 源物件删除/未选中保留/新滑条 head/时间/curveType B/slides=1/控制点 (接缝红锚点+原滑条形状)/hitsound 仅首物件
//   C) 像素探针: 合并后滑条身经过两段接缝中点与贝塞尔中段 (形状经过各物件位置)
//   D) undo 一步还原; 纯圆多选 (无滑条) 按钮同样出现
// 运行: node verifier/v38/cdp-merge.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9364;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v38-'));
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 圆(100,100) + B 滑条(200,200)->(260,140)->(320,200) + 圆(420,200), 外加一个未选中圆
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96300, type: 'circle', x: 100, y: 100, time: 2000, hitSound: 10, newCombo: true, comboSkip: 0, hitSampleRaw: '1:2:0:80:' },
        { id: 96301, type: 'slider', x: 200, y: 200, time: 3000, hitSound: 4, newCombo: false, comboSkip: 0,
          curveType: 'B', curvePoints: [{ x: 260, y: 140 }, { x: 320, y: 200 }], slides: 1, length: 130,
          edgeSoundsRaw: '0|2', edgeSetsRaw: '0:0|1:0' },
        { id: 96302, type: 'circle', x: 420, y: 200, time: 4000, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 96303, type: 'circle', x: 100, y: 320, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([96300, 96301, 96302]);
      s.seek(2100);
      window.__objs = () => JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o =>
        [o.id, o.type, o.x, o.y, o.time, o.curveType ?? '', o.slides ?? 0, Math.round(o.length ?? 0), o.hitSound ?? 0,
         JSON.stringify(o.curvePoints ?? null), o.hitSampleRaw ?? '', o.edgeSoundsRaw ?? '', String(!!o.newCombo)]));
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A) 按钮出现 -> 点击直接应用 (无窗口) ----
  console.log('== A) 多选 -> 按钮 -> 直接应用 (无窗口)');
  assert(await evalJs(`!!document.querySelector('[data-conv-apply="merge"]')`), '多选 (含滑条) 出现「合并为滑条」按钮');
  await evalJs(`document.querySelector('[data-conv-apply="merge"]').click(); 'ok'`);
  await sleep(400);
  assert((await evalJs('window.__osuStore.conversionDialog')) === null, '无参数窗口 (conversionDialog 保持 null)');
  assert(await evalJs(`!document.querySelector('[data-dialog]')`), '页面无任何转换对话框');

  // ---- B) 谱面结构 ----
  console.log('== B) 谱面结构断言');
  let objs = JSON.parse(await evalJs('window.__objs()'));
  assert(!objs.some(o => o[0] === 96300 || o[0] === 96301 || o[0] === 96302), '三个源物件已删除');
  assert(objs.some(o => o[0] === 96303), '未选中物件保留');
  const merged = objs.filter(o => o[1] === 'slider');
  assert(merged.length === 1, `合并成 1 条滑条 (实际 ${merged.length})`);
  const m = merged[0];
  assert(m[2] === 100 && m[3] === 100 && m[4] === 2000, 'head/时间 = 第一个物件');
  assert(m[5] === 'B' && m[6] === 1, "curveType 'B' slides=1");
  assert(m[8] === 10 && m[10] === '1:2:0:80:' && m[12] === 'true', 'hitsound/hitSample/newCombo 仅首物件');
  assert(m[11] === '', '源滑条边缘音丢弃');
  // 控制点: 接缝红锚点 (200,200)x2 + 原 B 滑条控制点 (260,140),(320,200) + 接缝 (320,200)x2 + 末圆 (420,200)
  assert(m[9] === JSON.stringify([{ x: 200, y: 200 }, { x: 200, y: 200 }, { x: 260, y: 140 }, { x: 320, y: 200 }, { x: 320, y: 200 }, { x: 420, y: 200 }]),
    `控制点 = 红锚点接缝 + 原滑条形状 (实际 ${m[9]})`);
  assert(m[7] > 250 && m[7] < 450, `长度 = 几何全长吸附 (实际 ${m[7]}, 几何约 366)`);
  assert((await evalJs('window.__osuStore.selected.size')) === 1
    && (await evalJs('window.__osuStore.selected.has(' + m[0] + ')')), '应用后选中新滑条');

  // ---- C) 像素探针: 滑条身经过各物件位置 ----
  console.log('== C) 像素探针 (滑条身经过接缝/贝塞尔中段)');
  await evalJs(`
    (() => {
      const cv = document.querySelector('canvas.cursor-crosshair');
      const g = cv.getContext('2d');
      window.__probe = (x, y) => {
        const p = window.__osuToCanvas(x, y);
        const d = g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        return Math.max(d[0], d[1], d[2]);
      };
      return 'ok';
    })()
  `);
  const seam1 = await evalJs('window.__probe(150, 150)');   // 接缝1 中点 (圆->滑条头 直线)
  const bez = await evalJs('window.__probe(260, 170)');     // 原 B 滑条贝塞尔中段
  const seam2 = await evalJs('window.__probe(370, 200)');   // 接缝2 中点 (滑条尾->末圆 直线)
  const bg = await evalJs('window.__probe(450, 80)');       // 空白背景
  console.log(`  探针: 接缝1=${seam1} 贝塞尔=${bez} 接缝2=${seam2} 背景=${bg}`);
  // 轨道纯黑实验样式: 滑条身中心线比背景暗 (0.7 alpha 纯黑), 亮于背景 = 白边, 暗于背景 = 黑轨道
  const hasBody = (v) => v > bg + 40 || v < bg - 8;
  assert(hasBody(seam1), `接缝1 中点有滑条身 (${seam1} vs 背景 ${bg})`);
  assert(hasBody(bez), `贝塞尔中段有滑条身 形状保留 (${bez} vs 背景 ${bg})`);
  assert(hasBody(seam2), `接缝2 中点有滑条身 (${seam2} vs 背景 ${bg})`);

  // 截图存档 (人工复核形状)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v38-merge.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v38-merge.png');

  // ---- D) undo 还原 + 纯圆多选按钮 ----
  console.log('== D) undo 还原 / 纯圆多选');
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  await sleep(300);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(objs.length === 4 && [96300, 96301, 96302, 96303].every(id => objs.some(o => o[0] === id)), 'undo 一步还原 4 个原物件');
  assert(objs.filter(o => o[1] === 'slider').length === 1 && objs.some(o => o[0] === 96301 && o[5] === 'B'), '原 B 滑条恢复');
  await evalJs(`window.__osuStore.select([96300, 96302]); 'ok'`); // undo 后选中集是失效 id, 需重选 (v36 坑)
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv-apply="merge"]')`), '纯圆多选 (无滑条) 按钮同样出现');
  assert(await evalJs(`!document.querySelector('[data-conv-open="stream"]')`), '无滑条时不显示转连打按钮 (v36 行为保留)');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V38_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V38_CDP_PASSED');

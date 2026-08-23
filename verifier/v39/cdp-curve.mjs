// CDP v39 端到端: F4 卡特姆(C)<->贝塞尔(B) 滑条互转
//   A) C->B 无参数直接应用: 无窗口, 类型/控制点/字段/选中/形状像素探针/undo
//   B) B->C 参数窗口: 开窗预览, 改密度实时预览点数变化, 应用后类型与字段, undo, localStorage 持久化, 取消
//   C) 带红锚点的 C 滑条渲染正常 (lazer 语义: 整条链不分段) + 截图
// 运行: node verifier/v39/cdp-curve.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9366;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v39-'));
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
const setNum = (testid, v) => `(() => {
  const inp = document.querySelector('[data-conv="${testid}"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '${v}');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
})(); 'ok'`;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(s.result.data, 'base64'));
  console.log('  截图: verifier/runs/' + name);
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

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96400, type: 'slider', x: 100, y: 150, time: 2000, hitSound: 10, newCombo: true, comboSkip: 0,
          curveType: 'C', curvePoints: [{ x: 200, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 150 }],
          slides: 1, length: 300, hitSampleRaw: '1:2:0:80:', edgeSoundsRaw: '0|2', edgeSetsRaw: '0:0|1:0' },
        { id: 96401, type: 'slider', x: 100, y: 280, time: 6000, hitSound: 4, newCombo: false, comboSkip: 0,
          curveType: 'B', curvePoints: [{ x: 160, y: 210 }, { x: 260, y: 350 }, { x: 360, y: 280 }],
          slides: 1, length: 250, edgeSoundsRaw: '2|0' },
        { id: 96402, type: 'circle', x: 460, y: 60, time: 10000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([96400, 96402]);
      s.seek(2500);
      window.__objs = () => JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o =>
        [o.id, o.type, o.curveType ?? '', o.time, o.hitSound, o.length ?? 0, o.slides ?? 0, o.edgeSoundsRaw ?? '', o.curvePoints?.length ?? 0]));
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify({ hide: p.hideIds, objs: p.objects.map(o => [o.curveType, 1 + (o.curvePoints?.length ?? 0)]) }) : 'null';
      };
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
  await sleep(400);

  // ---- A) C->B 无参数直接应用 ----
  console.log('== A) C->B 直接应用 (无窗口)');
  assert(await evalJs(`!!document.querySelector('[data-conv-apply="c2b"]')`), '选区含 C 滑条 -> c2b 按钮出现');
  assert(await evalJs(`!document.querySelector('[data-conv-open="curve"]')`), '选区无 B 滑条 -> curve 按钮不出现');
  // 应用前: 像素探针记录 C 滑条身上的点 (catmull 过锚点 (200,100)/(300,200))
  await evalJs(`window.__osuStore.select([]); 'ok'`); // 选中高亮会干扰探针 (v27 教训)
  await sleep(300);
  const bgA = await evalJs('window.__probe(60, 40)');
  const cAnchor1 = await evalJs('window.__probe(200, 100)');
  const cAnchor2 = await evalJs('window.__probe(300, 200)');
  // 轨道纯黑实验样式: 滑条身 = 比背景亮 (白边) 或明显暗 (黑轨道)
  const hasBodyA = (v) => v > bgA + 40 || v < bgA - 8;
  assert(hasBodyA(cAnchor1) && hasBodyA(cAnchor2), `应用前 C 滑条身过锚点 (探针 ${cAnchor1}/${cAnchor2} vs 背景 ${bgA})`);
  await shot('v39-c2b-before.png');
  await evalJs(`window.__osuStore.select([96400, 96402]); 'ok'`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-conv-apply="c2b"]').click(); 'ok'`);
  await sleep(300);
  assert((await evalJs('window.__osuStore.conversionDialog')) === null, 'C->B 不开窗口 (conversionDialog 保持 null)');
  let objs = JSON.parse(await evalJs('window.__objs()'));
  assert(!objs.some(o => o[0] === 96400), '源 C 滑条已删除');
  assert(objs.some(o => o[0] === 96402), '未选中的圆保留 (也从 removeIds 排除)');
  assert(objs.some(o => o[0] === 96401), '未选中的 B 滑条不动');
  const c2b = objs.find(o => o[2] === 'B' && o[3] === 2000);
  assert(!!c2b, '生成 B 滑条 (time 2000)');
  assert(c2b[8] === 11, `4 点 C -> 3 条贝塞尔 -> 11 控制点 (实际 ${c2b[8]})`);
  assert(c2b[4] === 10 && c2b[5] === 300 && c2b[6] === 1 && c2b[7] === '0|2', 'hitSound/length/slides/edgeSounds 原样保留');
  assert((await evalJs('window.__osuStore.selected.size')) === 1, '应用后选中结果滑条');
  // 形状像素探针: 转换后同位置仍有滑条身 (精确变换)
  await evalJs(`window.__osuStore.select([]); 'ok'`);
  await sleep(300);
  const bAnchor1 = await evalJs('window.__probe(200, 100)');
  const bAnchor2 = await evalJs('window.__probe(300, 200)');
  assert(hasBodyA(bAnchor1) && hasBodyA(bAnchor2), `C->B 后滑条身仍过原锚点 (探针 ${bAnchor1}/${bAnchor2})`);
  await shot('v39-c2b-after.png');
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  await sleep(300);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(objs.some(o => o[0] === 96400 && o[2] === 'C'), 'undo 还原 C 滑条');

  // ---- B) B->C 参数窗口 ----
  console.log('== B) B->C 参数窗口 (预览/密度/应用/undo/持久化/取消)');
  await evalJs(`window.__osuStore.select([96401, 96402]); window.__osuStore.seek(6500); 'ok'`);
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv-open="curve"]')`), '选区含 B 滑条 -> curve 按钮出现');
  assert(await evalJs(`!document.querySelector('[data-conv-apply="c2b"]')`), '选区无 C 滑条 -> c2b 按钮不出现');
  await evalJs(`document.querySelector('[data-conv-open="curve"]').click(); 'ok'`);
  await sleep(400);
  assert(await evalJs(`!!document.querySelector('[data-dialog="curve"]')`), '参数窗口出现');
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.hide.includes(96401) && prev.objs.length === 1 && prev.objs[0][0] === 'C', '预览: 源 B 隐藏 + C 结果');
  assert(prev.objs[0][1] === 8, `默认密度 8 -> 预览 8 锚点 (实际 ${prev.objs[0][1]})`);
  await evalJs(setNum('density', 16));
  await sleep(300);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.objs[0][1] === 16, `改密度 16 -> 预览实时变 16 锚点 (实际 ${prev.objs[0][1]})`);
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(300);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(!objs.some(o => o[0] === 96401), '源 B 滑条已删除');
  assert(objs.some(o => o[0] === 96402), '未选中的圆保留');
  const b2c = objs.find(o => o[2] === 'C' && o[3] === 6000);
  assert(!!b2c, '生成 C 滑条 (time 6000)');
  assert(b2c[8] === 15, `density 16 -> 15 控制点 (实际 ${b2c[8]})`);
  assert(b2c[4] === 4 && b2c[5] === 250 && b2c[6] === 1 && b2c[7] === '2|0', 'hitSound/length/slides/edgeSounds 原样保留');
  assert((await evalJs('window.__prev()')) === 'null', '应用后预览清除');
  assert(await evalJs(`!document.querySelector('[data-dialog="curve"]')`), '应用后窗口关闭');
  // 形状探针: 贝塞尔中点 (215,280) 附近 B->C 后仍有滑条身
  await evalJs(`window.__osuStore.select([]); 'ok'`);
  await sleep(300);
  const mid = await evalJs('window.__probe(215, 280)');
  const bgB = await evalJs('window.__probe(60, 40)');
  assert(mid > bgB + 40 || mid < bgB - 8, `B->C 后滑条身过贝塞尔中段附近 (探针 ${mid} vs 背景 ${bgB})`);
  await shot('v39-b2c-after.png');
  // 持久化
  const saved = await evalJs(`localStorage.getItem('osu-editor:conv:curve')`);
  assert(saved && JSON.parse(saved).density === 16, `localStorage 记录 density=16 (${saved})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  await sleep(300);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(objs.some(o => o[0] === 96401 && o[2] === 'B'), 'undo 还原 B 滑条');
  // 重开窗口恢复参数 + 取消
  await evalJs(`window.__osuStore.select([96401, 96402]); 'ok'`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-conv-open="curve"]').click(); 'ok'`);
  await sleep(300);
  assert((await evalJs(`document.querySelector('[data-conv="density"]').value`)) === '16', '重开窗口恢复 density=16');
  const before = await evalJs('window.__objs()');
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="curve"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);
  await sleep(300);
  assert((await evalJs('window.__objs()')) === before, '取消后谱面不变');
  assert((await evalJs('window.__prev()')) === 'null', '取消后预览清除');

  // ---- C) 带红锚点的 C 滑条渲染正常 ----
  console.log('== C) 带红锚点的 C 滑条渲染 (lazer: 整条链不分段)');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96410, type: 'slider', x: 100, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'C', curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 150 }],
          slides: 1, length: 350 },
      ];
      s.select([]);
      s.seek(2500);
      return 'ok';
    })()
  `);
  await sleep(400);
  const redMid = await evalJs('window.__probe(200, 100)');   // 红锚点处 (catmull 过锚点)
  const redTail = await evalJs('window.__probe(350, 184)');  // 末段中点 (catmull 公式理论值)
  const bgC = await evalJs('window.__probe(60, 40)');
  const hasBodyC = (v) => v > bgC + 40 || v < bgC - 8;
  assert(hasBodyC(redMid), `带红锚点 C 滑条身过红锚点 (探针 ${redMid} vs 背景 ${bgC})`);
  assert(hasBodyC(redTail), `末段渲染正常 (探针 ${redTail})`);
  await shot('v39-cat-red.png');

  // ---- D) 单选滑条也显示 转连打/曲线互转 按钮 (v39 补充需求) ----
  console.log('== D) 单选滑条: 拆分 + 转连打 + 曲线互转按钮');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96420, type: 'slider', x: 100, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'B', curvePoints: [{ x: 200, y: 100 }, { x: 300, y: 200 }], slides: 1, length: 250 },
      ];
      s.select([96420]);
      s.seek(1500);
      return 'ok';
    })()
  `);
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv-open="split"]')`), '单选: 拆分按钮');
  assert(await evalJs(`!!document.querySelector('[data-conv-open="stream"]')`), '单选: 转连打按钮');
  assert(await evalJs(`!!document.querySelector('[data-conv-open="curve"]')`), '单选(B): 贝塞尔→卡特姆按钮');
  assert(await evalJs(`!document.querySelector('[data-conv-apply="c2b"]')`), '单选(B): 无卡特姆→贝塞尔按钮');
  // 单选开转连打窗口 -> 预览 -> 取消
  await evalJs(`document.querySelector('[data-conv-open="stream"]').click(); 'ok'`);
  await sleep(400);
  assert(await evalJs(`!!document.querySelector('[data-dialog="stream"]')`), '单选: 转连打窗口打开');
  const prevD = JSON.parse(await evalJs('window.__prev()'));
  assert(prevD.hide.includes(96420) && prevD.objs.length > 0, `单选: 转连打预览 (${prevD.objs.length} 点)`);
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="stream"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);
  await sleep(200);
  // 单选 C 滑条 -> c2b 直接应用
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96421, type: 'slider', x: 100, y: 200, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'C', curvePoints: [{ x: 200, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 150 }], slides: 1, length: 350 },
      ];
      s.select([96421]);
      return 'ok';
    })()
  `);
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv-apply="c2b"]')`), '单选(C): 卡特姆→贝塞尔按钮');
  await evalJs(`document.querySelector('[data-conv-apply="c2b"]').click(); 'ok'`);
  await sleep(300);
  const convD = await evalJs(`window.__osuStore.beatmap.hitObjects.find(o => o.type === 'slider')?.curveType`);
  assert(convD === 'B', `单选: c2b 应用成功 (curveType=${convD})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V39_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V39_CDP_PASSED');

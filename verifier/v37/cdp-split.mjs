// CDP v37 端到端: F2 滑条等时间拆分 — 开窗/实时预览/应用/undo/参数持久化/非法参数/取消
//   A) 单选滑条 -> Inspector 拆分按钮 -> 开窗 -> 预览 2 段 (源滑条隐藏); 改拆分数 -> 预览实时变 3 段
//   B) 应用 -> 滑条被 3 段小滑条替换 (位置/时间/hitsound/edgeSounds 正确), 选中结果, 窗口关闭; undo 还原
//   C) 参数持久化: localStorage 记录, 重开窗口恢复上次值
//   D) 非法参数 (距离间隙过大) -> 错误提示 + 无预览 + 应用禁用
//   E) 取消 -> 谱面不变, 预览清除
// 运行: node verifier/v37/cdp-split.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9363;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v37-'));
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  // 直线滑条 (100,100)->(400,100) length 300 time 2000, slides=1, 带 edge sounds; 加一个未选中单点
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96200, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 10, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 400, y: 100 }], slides: 1, length: 300,
          hitSampleRaw: '1:2:0:80:', edgeSoundsRaw: '0|2', edgeSetsRaw: '0:0|1:0' },
        { id: 96201, type: 'circle', x: 420, y: 300, time: 9000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([96200]);
      s.seek(1500);
      window.__objs = () => JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o =>
        [o.id, o.type, o.x, o.y, o.time, o.curveType ?? '', o.slides ?? 0, Math.round(o.length ?? 0), o.hitSound ?? 0, o.edgeSoundsRaw ?? '']));
      window.__prev = () => {
        const p = window.__osuStore.conversionPreview;
        return p ? JSON.stringify({ hide: p.hideIds, n: p.objects.length, objs: p.objects.map(o => [o.x, o.time]) }) : 'null';
      };
      return 'ok';
    })()
  `);
  await sleep(300);
  const sm = await evalJs('window.__osuStore.beatmap.difficulty.sliderMultiplier');
  const vel = 100 * sm / 500; // px/ms (红线 1000/500 的 demo 图; 用页面实际 sm)
  const dur3 = 100 / vel;     // 三等分每段时长

  // ---- A) 打开窗口 + 实时预览 ----
  console.log('== A) 打开窗口 + 实时预览');
  await evalJs(`document.querySelector('[data-conv-open="split"]').click(); 'ok'`);
  await sleep(400);
  assert(await evalJs(`!!document.querySelector('[data-dialog="split"]')`), '参数窗口出现');
  let prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.hide.includes(96200) && prev.n === 2, `默认预览 2 段 (源隐藏, 实际 ${prev.n})`);
  // 改拆分数 3 -> 预览 3 段, 段头 1/3, 2/3
  await evalJs(setNum('count', 3));
  await sleep(300);
  prev = JSON.parse(await evalJs('window.__prev()'));
  assert(prev.n === 3, `改参数后预览实时变 3 段 (实际 ${prev.n})`);
  assert(prev.objs.map(o => o[0]).join(',') === '100,200,300', `预览段头位置 (${prev.objs.map(o => o[0]).join(',')})`);
  assert(prev.objs[0][1] === 2000 && Math.abs(prev.objs[1][1] - (2000 + dur3)) < 2, `预览时间 (${prev.objs.map(o => o[1]).join(',')})`);

  // 截图存档 (预览效果人工复核)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v37-split.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v37-split.png');

  // ---- B) 应用 + undo ----
  console.log('== B) 应用 + undo');
  await evalJs(`document.querySelector('[data-conv="apply"]').click(); 'ok'`);
  await sleep(300);
  let objs = JSON.parse(await evalJs('window.__objs()'));
  const segs = objs.filter(o => o[1] === 'slider');
  assert(!objs.some(o => o[0] === 96200), '源滑条已删除');
  assert(objs.some(o => o[0] === 96201), '未选中的物件保留');
  assert(segs.length === 3, `生成 3 段滑条 (实际 ${segs.length})`);
  assert(segs.map(o => o[2]).join(',') === '100,200,300', '段头位置正确');
  assert(segs.every(o => o[5] === 'B' && o[6] === 1 && o[7] === 100), '每段 B 滑条 slides=1 length=100');
  assert(segs[0][8] === 10 && segs.slice(1).every(o => o[8] === 0), '头部 hitSound 只给第一段');
  assert(segs[2][9] === '0|2', `尾部 edgeSound 落到最后一段 (${segs.map(o => o[9]).join(' / ')})`);
  assert((await evalJs('window.__prev()')) === 'null', '应用后预览清除');
  assert(await evalJs(`!document.querySelector('[data-dialog="split"]')`), '应用后窗口关闭');
  assert((await evalJs('window.__osuStore.selected.size')) === 3, '应用后选中 3 个结果');
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  objs = JSON.parse(await evalJs('window.__objs()'));
  assert(objs.some(o => o[0] === 96200) && objs.filter(o => o[1] === 'slider').length === 1, 'undo 还原滑条');

  // ---- C) 参数持久化 ----
  console.log('== C) 参数持久化');
  const saved = await evalJs(`localStorage.getItem('osu-editor:conv:split')`);
  assert(saved && JSON.parse(saved).count === 3, `localStorage 记录参数 (${saved})`);
  await evalJs(`window.__osuStore.select([96200]); 'ok'`); // undo 后选中集是失效 id, 需重选 (v36 坑)
  await sleep(200);
  await evalJs(`document.querySelector('[data-conv-open="split"]').click(); 'ok'`);
  await sleep(300);
  assert((await evalJs(`document.querySelector('[data-conv="count"]').value`)) === '3', '重开窗口恢复上次拆分数');

  // ---- D) 非法参数: 距离间隙过大 ----
  console.log('== D) 非法参数 (距离间隙过大)');
  await evalJs(setNum('dist-gap', 400));
  await sleep(300);
  assert(await evalJs(`!!document.querySelector('[data-conv="error"]')`), '错误提示出现');
  assert((await evalJs('window.__prev()')) === 'null', '非法参数不生成预览');
  assert(await evalJs(`document.querySelector('[data-conv="apply"]').disabled`), '应用按钮禁用');
  await evalJs(setNum('dist-gap', 0));
  await sleep(300);
  assert(JSON.parse(await evalJs('window.__prev()')).n === 3, '恢复合法参数后预览回来');

  // ---- E) 取消 ----
  console.log('== E) 取消不应用');
  const before = await evalJs('window.__objs()');
  await evalJs(`(() => {
    [...document.querySelectorAll('[data-dialog="split"] button')].find(b => b.textContent === '取消').click();
  })(); 'ok'`);
  await sleep(300);
  assert((await evalJs('window.__objs()')) === before, '取消后谱面不变');
  assert((await evalJs('window.__prev()')) === 'null', '取消后预览清除');

  // ---- F) 形状复核截图: 圆弧滑条拆分预览 (两段同屏可见) ----
  console.log('== F) 形状复核截图 (P 圆弧)');
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 96210, type: 'slider', x: 150, y: 300, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
          curveType: 'P', curvePoints: [{ x: 250, y: 150 }, { x: 350, y: 300 }], slides: 1, length: 300 },
      ];
      s.select([96210]);
      s.seek(2100);
      return 'ok';
    })()
  `);
  await sleep(300);
  await evalJs(`document.querySelector('[data-conv-open="split"]').click(); 'ok'`);
  await sleep(300);
  await evalJs(setNum('count', 2));
  await sleep(400);
  assert(JSON.parse(await evalJs('window.__prev()')).n === 2, '圆弧滑条预览 2 段');
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, 'v37-split-curve.png'), Buffer.from(shot2.result.data, 'base64'));
  console.log('  截图: verifier/runs/v37-split-curve.png');
  await evalJs(`window.__osuStore.closeConversion(); 'ok'`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V37_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V37_CDP_PASSED');

// 验证器 v466: Alt 拖滑条尾红线扩程改 Mapping Tools (SliderVelocityFixer) 同款 1ms 窗口 —
//   旧 (v455): 头处 T0 增/改红线 + 后续滑条头插还原红线 (BPM 泄漏到下一根红线);
//   新 (v466): 变速红线插 T0-1 + 还原红线插 T0 (拷贝拖拽前红线参数 redOldTp, effects|8 省略首小节线)
//   + 滑条与头绿线前移 1ms 落入 [T0-1, T0) 窗口 (同刻红线对滑条生效, 不前移就吃到还原后 BPM);
//   BPM 在 T0 即还原 → 节拍网格锚回 T0 零偏移, 不再泄漏 (bpmRestoreTargetAt 已删);
//   绿线 sv 按本帧实际头时刻反解 (尾落点精确 = 吸附目标); T0 已有红/绿线则利用/还原不搬动;
//   还原红线是窗口收口必要部分, 不受 svTailRestore 门控 (那开关只管后续滑条头 svOld 绿线)。
// 运行: npm run build 后 node verifier/v466/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: MT 1ms 窗口结构');
{
  const tl = read('src/components/Timelines.tsx');
  const fn = tl.match(/function applySvTailDrag[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert(fn.length > 0, 'applySvTailDrag 存在');
  assert(/const headOrig = o\.time \+ \(tr\.boostShifted \? 1 : 0\);/.test(fn), 'headOrig = 原始头时刻 T0 (shift 反推)');
  assert(/svForDurationRaw\([^)]*tr\.redOld[^)]*targetEnd - headOrig\)/.test(fn), 'svReq 判定基准 = redOld + headOrig (防自反馈)');
  assert(/if \(boost && !tr\.boostShifted\) \{ o\.time -= 1; tr\.boostShifted = true; \}/.test(fn)
    && /else if \(!boost && tr\.boostShifted\) \{ o\.time \+= 1; tr\.boostShifted = false; \}/.test(fn), '滑条前移/退回 1ms (一次性, 防逐帧漂移)');
  assert(/targetEnd - o\.time\) \?\? svReq;/.test(fn), 'svReqA 按本帧实际头时刻反解 (尾落点精确)');
  assert(/if \(tr\.headGreen && tr\.headCreated\) \{[\s\S]{0,120}?tr\.headGreen = null; tr\.headCreated = false;/.test(fn), '扩程期摘除本次新建的 T0 绿线');
  assert(/if \(tr\.headGreen\) tr\.headGreen\.beatLength = beatLengthForSv\(tr\.svOld\);/.test(fn), 'T0 已有绿线还原 svOld 不搬动');
  assert(/tr\.boostGreen\.beatLength = beatLengthForSv\(svNew\);/.test(fn), 'boostGreen 跟滑条到 T0-1 承载 svNew');
  assert(/if \(tr\.boostGreenCreated\) \{ const i = tps\.indexOf\(tr\.boostGreen\);/.test(fn)
    && /else tr\.boostGreen\.beatLength = tr\.boostGreenOrig;/.test(fn), '扩程收尾: boostGreen 摘除/还原');
  assert(/tr\.boostRedOn\.beatLength = tr\.redOld \/ boost\.redScale;/.test(fn), '变速红线 beatLength = redOld/2^n');
  assert(/const rp = tr\.redOldTp;[\s\S]{0,260}?time: o\.time, beatLength: rp\.beatLength[\s\S]{0,200}?effects: rp\.effects \| 8/.test(fn), '变速红线插 T0-1 (= 本帧 o.time), 拷贝 redOldTp, effects|8');
  assert(/if \(!tps\.some\(p => p\.uninherited && p\.time === headOrig\)\) \{[\s\S]{0,260}?time: headOrig, beatLength: rp\.beatLength[\s\S]{0,200}?effects: rp\.effects \| 8/.test(fn), '还原红线插 T0 (T0 已有红线则利用), effects|8');
  assert(/else tr\.boostRedOn\.beatLength = tr\.redOnOrig;/.test(fn), '已有变速红线收尾还原其原值 (redOnOrig, 非 redOld)');
  assert(!/bpmRestoreTargetAt|headRed|restoreRed/.test(fn), 'v455 旧落点 (头处改红线/后续头还原红线) 已移除');
  // 摘除在遮挡查询之前 (还原红线 T0 会被 svRestoreTargetAt 误判为遮挡)
  const iRmR = fn.indexOf('if (tr.boostRedRestore) {');
  const iQuery = fn.indexOf('const restoreAt = svRestoreTargetAt');
  assert(iRmR > 0 && iQuery > iRmR, '上一帧还原红线先摘后查 (遮挡查询不被自家线干扰)');
  assert(!/bpmRestoreTargetAt/.test(tl), 'Timelines 不再引入 bpmRestoreTargetAt');
  const ts = read('src/osu/timingSv.ts');
  assert(!/export function bpmRestoreTargetAt/.test(ts), 'timingSv 删除 bpmRestoreTargetAt');
}

section('CDP: Alt 拖尾超界 → 1ms 窗口三件套 + 滑条前移 + 尾落点精确');
{
  const PORT = 9498;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await sleep(500);

    const r = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = { ...base.timingPoints.find(p => p.uninherited), time: 1000, beatLength: 500 }; // v466: 整数拍长 — 拖回可精确还原
      const SM = base.difficulty.sliderMultiplier;
      const B = 500;
      const t = 1000 + B * 8; // 5000
      const L = 100 * SM; // 原始时长恰好 1 拍
      const mk = (id, time) => ({ id, type: 'slider', x: 100, y: 100, time, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: L });
      const t2 = t + 4 * B; // 后续滑条头 (还原绿线落点)
      const loadMap = () => {
        store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk(966001, t), mk(966002, t2)] }, store.audioUrl);
        store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 16;
        store.seek(t + 200); store.select([966001]);
      };
      const c = [...document.querySelectorAll('canvas')].find(cv => Math.abs(cv.getBoundingClientRect().height - 92) < 2);
      const xOf = (ms) => {
        const r = c.getBoundingClientRect();
        const win = 6000 / (store.beatmap.editor.timelineZoom || 1);
        return r.left + ((ms - (store.currentTime - win / 2)) / win) * r.width;
      };
      const dragTail = async (targetMs) => { // 一次完整拖拽: 尾把手按下 → 移到 targetMs → 松开
        const y = c.getBoundingClientRect().top + 10;
        const endMs0 = store.beatmap.hitObjects.find(x => x.id === 966001).time + L / (100 * SM / B);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: xOf(endMs0), clientY: y, button: 0, altKey: true, bubbles: true, cancelable: true }));
        await sleep(60);
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(targetMs), clientY: y, altKey: true, bubbles: true }));
        await sleep(150);
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: xOf(targetMs), clientY: y, altKey: true, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: xOf(targetMs), clientY: y, bubbles: true }));
        await sleep(100);
      };
      const snap = () => {
        const bm2 = store.beatmap;
        const o = bm2.hitObjects.find(x => x.id === 966001);
        const reds = bm2.timingPoints.filter(p => p.uninherited).map(p => ({ time: p.time, bl: Math.round(p.beatLength * 100) / 100, fx: p.effects }));
        const greens = bm2.timingPoints.filter(p => !p.uninherited).map(p => ({ time: p.time, sv: Math.round(-10000 / p.beatLength) / 100 }));
        return { oTime: o.time, reds, greens };
      };
      const out = {};

      // A: boost 开, 拖尾到 t+B/16 (svReq≈16 > 10 → 扩程) 后保持, 检查落盘状态
      store.setEditorPref('svRedlineBoost', true);
      loadMap(); await sleep(200);
      const target = t + B / 16; // 31.25ms — snap 后 31 (1/16 网格)
      await dragTail(target);
      const A = snap();
      // 尾落点: 变速红线 (t-1, B/2) + 绿线 sv 下 duration = L·(B/2)/(100·SM·sv)
      const gA = store.beatmap.timingPoints.find(p => !p.uninherited && p.time === A.oTime);
      const svA = gA ? -100 / gA.beatLength : 1;
      const endA = A.oTime + L / (100 * SM * svA / (B / 2));
      A.endErr = Math.round((endA - Math.round(target)) * 1000) / 1000;
      // 撤销 → 原状
      store.undo(); await sleep(150);
      A.undo = snap();
      out.A = A;

      // B: boost 开, 扩程中拖回原尾 (同一拖拽内) → 全部还原
      loadMap(); await sleep(200);
      {
        const y = c.getBoundingClientRect().top + 10;
        const endMs0 = t + L / (100 * SM / B);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: xOf(endMs0), clientY: y, button: 0, altKey: true, bubbles: true, cancelable: true }));
        await sleep(60);
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(target), clientY: y, altKey: true, bubbles: true }));
        await sleep(150);
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(endMs0), clientY: y, altKey: true, bubbles: true }));
        await sleep(150);
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: xOf(endMs0), clientY: y, altKey: true, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: xOf(endMs0), clientY: y, bubbles: true }));
        await sleep(100);
      }
      out.B = snap();

      // C: boost 关 (对照) — 钳制 10x, 无红线, 滑条不前移
      store.setEditorPref('svRedlineBoost', false);
      loadMap(); await sleep(200);
      await dragTail(target);
      const C = snap();
      const gC = store.beatmap.timingPoints.find(p => !p.uninherited && p.time === C.oTime);
      C.sv = gC ? Math.round(-1000 / gC.beatLength) / 10 : 1;
      out.C = C;
      store.setEditorPref('svRedlineBoost', false);
      return out;
    })()`);

    // A: 扩程终态
    const redOn = r.A.reds.find(x => x.time === r.A.oTime);     // T0-1
    const redRe = r.A.reds.find(x => x.time === r.A.oTime + 1); // T0
    assert(!!redOn, `变速红线在 T0-1 = 滑条新头 (${JSON.stringify(r.A)})`);
    assert(redOn && redOn.bl === 250 && (redOn.fx & 8) !== 0, `变速红线 beatLength=250 (BPM×2) 且 effects|8 (${JSON.stringify(r.A.reds)})`);
    assert(redRe && redRe.bl === 500 && (redRe.fx & 8) !== 0, `还原红线在 T0 beatLength=500 且 effects|8 (${JSON.stringify(r.A.reds)})`);
    assert(r.A.reds.length === 3 && r.A.reds.some(x => x.time === 1000), `红线共 3 根 (原 red0 + 变速 + 还原; 无后续滑条头还原红线): ${JSON.stringify(r.A.reds)}`);
    const gBoost = r.A.greens.find(g => g.time === r.A.oTime);
    assert(gBoost && gBoost.sv > 5 && gBoost.sv <= 10, `boostGreen 在 T0-1 且 sv 落回 (5,10] (sv=${gBoost?.sv})`);
    assert(Math.abs(r.A.endErr) < 0.51, `尾落点精确 = 吸附目标 (误差 ${r.A.endErr}ms)`);
    assert(r.A.greens.some(g => g.time !== r.A.oTime && Math.abs(g.sv - 1) < 0.05), `后续滑条头有 svOld=1 还原绿线 (svTailRestore 默认开): ${JSON.stringify(r.A.greens)}`);
    assert(r.A.undo.oTime !== r.A.oTime && r.A.undo.reds.length === 1 && r.A.undo.greens.length === 0,
      `撤销还原: 滑条回 T0 + 只剩原红线 (${JSON.stringify(r.A.undo)})`);
    // B: 扩程中拖回原尾 → 全还原
    assert(r.B.reds.length === 1 && r.B.greens.length === 0 && r.B.oTime !== undefined,
      `拖回原尾: 新建线全摘除 (${JSON.stringify(r.B)})`);
    assert(r.B.oTime === r.A.undo.oTime, `拖回原尾: 滑条退回 T0 (${r.B.oTime})`);
    // C: 关 = 钳制
    assert(r.C.reds.length === 1 && r.C.sv === 10 && r.C.oTime === r.A.undo.oTime,
      `boost 关: 钳制 10x 绿线在 T0, 无红线, 滑条不动 (${JSON.stringify(r.C)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V466_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V466_ALL_TESTS_PASSED');

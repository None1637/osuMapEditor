// 验证器 v367: 缩放类数值框精细度 ×10 — 用户反馈「缩放(1个选中)」变换窗口倍率调整精细度不够,
//  要求所有缩放相关 UI 数值精度增加一位 (步进 ÷10, 显示 2 位 → 3 位小数)。
// 改动面 (仅缩放语义框; BPM/SV/距离倍率/偏移等不动):
//  1. TransformDialog 缩放窗口 倍率 x/y (testid factor/factor-y): step 0.05 → 0.005, digits 3
//     — 滚轮/拖动 (5px=1step, DraftNum 共用逻辑) 步进自动同步 ÷10。
//  2. DuplicateDialog / SymSliderDialog 每份递增缩放 (scalePerCopy): step 0.05 → 0.005, digits 3。
//  3. App.tsx 游玩区平移 Zoom (v223/v224 左侧栏): 显示取整 ×100→×1000, step 0.1→0.01, digits 3。
//  4. DraftNum (DraggableDialog) / PanNumInput (App) 新增 digits prop — 非草稿/非聚焦态 toFixed 显示。
//  内部存储本来就是浮点不动; Inspector 变换面板 NumIn 无步进 (step="any" 任意精度输入), 无需改。
//  verifier/v224 的 Zoom 行源码断言同步更新 (注明有意变更)。
// 运行: npm run build 后 node verifier/v367/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 四处缩放框 step ÷10 + digits=3');
{
  const tf = read('src/components/TransformDialog.tsx');
  assert(/testid="factor" min=\{0\.01\} step=\{0\.005\} digits=\{3\}/.test(tf), '缩放窗口 倍率x: step 0.05→0.005, digits 3');
  assert(/testid="factor-y" min=\{0\.01\} step=\{0\.005\} digits=\{3\}/.test(tf), '缩放窗口 倍率y: step 0.05→0.005, digits 3');
  assert(!/testid="factor(-y)?" min=\{0\.01\} step=\{0\.05\}/.test(tf), '缩放窗口旧 0.05 步进已移除');
  const dup = read('src/components/convert/DuplicateDialog.tsx');
  assert(/testid="scalePerCopy" min=\{-0\.99\} max=\{5\} step=\{0\.005\} digits=\{3\}/.test(dup), 'DuplicateDialog 每份递增缩放: step÷10 + digits 3');
  const sym = read('src/components/convert/SymSliderDialog.tsx');
  assert(/testid="scalePerCopy" min=\{-0\.99\} max=\{5\} step=\{0\.005\} digits=\{3\}/.test(sym), 'SymSliderDialog 每份递增缩放: step÷10 + digits 3');
  const app = read('src/App.tsx');
  assert(/label="Zoom" labelKey="app\.playfield_zoom" value=\{Math\.round\(store\.playfieldScale \* 1000\) \/ 1000\} step=\{0\.01\} min=\{0\.1\} max=\{10\} digits=\{3\}/.test(app),
    '游玩区 Zoom: 取整×1000 + step 0.1→0.01 + digits 3');
}

section('源码: digits 显示机制 (DraftNum/PanNumInput), 非缩放框不动');
{
  const dd = read('src/components/DraggableDialog.tsx');
  assert(/digits\?: number;/.test(dd), 'DraftNum 新增 digits prop');
  assert(/value=\{draft \?\? \(digits !== undefined \? value\.toFixed\(digits\) : value\)\}/.test(dd), 'DraftNum 非草稿态按 digits toFixed 显示');
  assert(/\(dx \/ 5\) \* step \* mult/.test(dd), '拖动调值 5px=1step 逻辑不变 (步进随 step prop 自动 ÷10)');
  const app = read('src/App.tsx');
  assert(/digits\?: number; onCommit/.test(app), 'PanNumInput 新增 digits prop');
  assert(/text \?\? \(digits !== undefined \? value\.toFixed\(digits\) : String\(value\)\)/.test(app), 'PanNumInput 非聚焦态按 digits toFixed 显示');
  // 非缩放语义框保持原精度 (勿误改)
  assert(/data-ds-input="number"[\s\S]{0,80}step=\{0\.05\}|step=\{0\.05\} disabled=\{!bm\} data-ds-input="number"/.test(app), '锁定间距倍率 (DistanceSpacing, 非缩放语义) 步进仍 0.05');
  const tpd = read('src/components/TimingPointDialog.tsx');
  assert(/testid="bpmOrSv"[\s\S]{0,10}|step=\{0\.01\} testid="bpmOrSv"/.test(tpd), 'BPM/SV 框步进不变 (0.01)');
  const insp = read('src/components/Inspector.tsx');
  assert(!/digits/.test(insp), 'Inspector 变换面板 NumIn 无步进 (step=any 任意精度), 未改');
}

section('CDP: 缩放窗口步进=原来 1/10 + 显示 3 位小数 / 游玩区 Zoom / 递增缩放框');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
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
    await sleep(800); // 布局稳定

    // A: 缩放变换窗口 — step 属性 / 初始 3 位显示 / 滚轮步进 0.005 (= 原 0.05 的 1/10) / 0.59 显示 0.590
    const rA = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const o = store.beatmap.hitObjects[0];
      if (!o) return { error: '默认谱面无物件可选' };
      store.selected = new Set([o.id]);
      store.openTransformDialog('scale'); // 需非空选区 (store 内部守卫)
      await sleep(300);
      const inp = document.querySelector('input[data-conv="factor"]');
      if (!inp) return { error: 'factor 输入框未渲染' };
      const stepAttr = inp.step;
      const v0 = inp.value;
      inp.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
      await sleep(120);
      const v1 = inp.value; // 滚轮 +1 step (草稿态同步刷新显示)
      inp.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
      await sleep(120);
      const vBack = inp.value; // 滚回 1 (草稿态原始字符串 "1", 步进值可由 v0→v1 差验证)
      store.closeTransformDialog();
      await sleep(120);
      return { stepAttr, v0, v1, vBack };
    })()`);
    if (rA.error) assert(false, `A: ${rA.error}`);
    else {
      assert(rA.stepAttr === '0.005', `A: factor 框 step 属性 = 0.005 (原 0.05; 实际 ${rA.stepAttr})`);
      assert(rA.v0 === '1.000', `A: 初始显示 3 位小数 "1.000" (实际 "${rA.v0}")`);
      assert(rA.v1 === '1.005', `A: 滚轮一格 +0.005 (= 原 0.05 的 1/10), 显示 "1.005" (实际 "${rA.v1}")`);
      assert(parseFloat(rA.vBack) === 1, `A: 滚回后值归 1 (实际 "${rA.vBack}")`);
    }

    // B: 游玩区 Zoom 框 — step 0.01, 3 位显示 (store 值 1.23456 → 显示 1.235)
    const rB = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.playfieldScale = 1.23456; store.emit();
      await sleep(200);
      const inp = document.querySelector('input[data-pan-input="Zoom"]');
      if (!inp) return { error: 'Zoom 输入框未渲染' };
      const out = { stepAttr: inp.step, val: inp.value };
      store.playfieldScale = 1; store.emit();
      await sleep(120);
      out.restored = inp.value;
      return out;
    })()`);
    if (rB.error) assert(false, `B: ${rB.error}`);
    else {
      assert(rB.stepAttr === '0.01', `B: Zoom 框 step 属性 = 0.01 (原 0.1; 实际 ${rB.stepAttr})`);
      assert(rB.val === '1.235', `B: playfieldScale=1.23456 显示 3 位 "1.235" (原 2 位 "1.23"; 实际 "${rB.val}")`);
      assert(rB.restored === '1.000', `B: 还原后显示 "1.000" (实际 "${rB.restored}")`);
    }

    // C: DuplicateDialog 每份递增缩放框 — step 0.005 + 3 位显示
    const rC = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const o = store.beatmap.hitObjects[0];
      if (o) store.selected = new Set([o.id]);
      store.openConversion('duplicate');
      await sleep(300);
      const inp = document.querySelector('input[data-conv="scalePerCopy"]');
      const out = inp ? { stepAttr: inp.step, val: inp.value } : { error: 'scalePerCopy 未渲染' };
      store.closeConversion();
      await sleep(120);
      return out;
    })()`);
    if (rC.error) assert(false, `C: ${rC.error}`);
    else {
      assert(rC.stepAttr === '0.005', `C: DuplicateDialog scalePerCopy step = 0.005 (实际 ${rC.stepAttr})`);
      assert(/^\d+\.\d{3}$|^-?\d+\.\d{3}$/.test(rC.val), `C: scalePerCopy 显示 3 位小数 (实际 "${rC.val}")`);
    }

    // D: SymSliderDialog 同款框 (对称滑条窗口)
    const rD = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const sl = store.beatmap.hitObjects.find(o => o.type === 'slider');
      if (sl) store.selected = new Set([sl.id]);
      store.openConversion('symSlider');
      await sleep(300);
      const inp = document.querySelector('input[data-conv="scalePerCopy"]');
      const out = inp ? { stepAttr: inp.step, val: inp.value, hadSlider: !!sl } : { error: 'scalePerCopy 未渲染', hadSlider: !!sl };
      store.closeConversion();
      await sleep(120);
      return out;
    })()`);
    if (rD.error) assert(false, `D: ${rD.error} (选中滑条=${rD.hadSlider})`);
    else {
      assert(rD.stepAttr === '0.005', `D: SymSliderDialog scalePerCopy step = 0.005 (实际 ${rD.stepAttr})`);
      assert(/^-?\d+\.\d{3}$/.test(rD.val), `D: scalePerCopy 显示 3 位小数 (实际 "${rD.val}")`);
    }

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V367_FAILED: ${failures} 处失败` : '\nVERIFIER_V367_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);

// 验证器 v462: 修复「选中滑条后 Alt 框选明显掉帧」
// 根因 (profile 定位): 框选每次 mousemove 全量重算并无差别 emit — setSelectedNodes/select
//   无论内容是否变化都 bump version → 连锁两处高开销:
//   ① 选中装饰层 (renderer selLayer) 键含 getVersion → 逐帧重建, 选中滑条时 = 滑条路径采样
//     + outline sprite 重画 (装饰内容与框选完全无关);
//   ② React 全树重渲染 (App/Inspector 等 useEditor 订阅者)。
// 修复: ① store.setSelectedNodes/select 内容相同不 emit (nodeSelectionEquals 守卫);
//   ② 框选 (物件/节点) 期间冻结 renderPlayfield cacheKey (marqueeFreezeKeyRef) — 装饰层键不变
//   不再逐帧重建; 节点高亮/框选矩形本来就是主通道逐帧直绘, 不走缓存层, 显示不受影响。
// 运行: npm run build 后 node verifier/v462/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v462/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v462/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('纯函数: nodeSelectionEquals');
await import('file://' + out);
fs.unlinkSync(out);

section('源码: emit 守卫');
{
  const st = read('src/osu/store.ts');
  const sns = st.match(/setSelectedNodes\(entries: Iterable<\[number, number\]>\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(sns.length > 0, 'setSelectedNodes 存在');
  assert(/if \(nodeSelectionEquals\(this\.selectedNodes, m\)\) return;/.test(sns), 'setSelectedNodes: 内容相同不 emit');
  assert(sns.indexOf('nodeSelectionEquals') < sns.indexOf('this.selectedNodes = m'), '守卫在替换之前');
  const sel = st.match(/\n  select\(ids: number\[\], additive = false\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(sel.length > 0, 'select() 存在');
  assert(/v462: 无变化不 emit/.test(sel), 'select: 无变化不 emit (物件框选)');
  // 守卫不能吞掉「清节点/绿线/边选区」语义: 非 additive 且子选区非空时必须放行
  assert(/!this\.selectedGreenLines\.size && !this\.selectedNodes\.size && !this\.selectedEdges\.size/.test(sel), 'select: 子选区非空时仍放行 (清空语义保留)');
}

section('源码: 框选期冻结装饰层键');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/marqueeFreezeKeyRef = useRef<string \| null>\(null\)/.test(ec), 'marqueeFreezeKeyRef 存在');
  assert(/cacheKey: marqueeFreezeKeyRef\.current \?\? String\(store\.getVersion\(\)\)/.test(ec), 'cacheKey 冻结接线');
  assert(/!!\(nodeMarqueeRef\.current \|\| marqueeRef\.current\)/.test(ec), '冻结期 = 物件/节点框选进行中');
  const rd = read('src/osu/renderer.ts');
  assert(/rc\.selected\.size, sig/.test(rd), '装饰层键仍含物件选区签名 (真实选区变化仍重建)');
}

section('CDP: 选中滑条后 Alt 框选不再逐帧 emit');
{
  const PORT = 9499;
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
    await normalizeEnv(evalJs);
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await sleep(800);

    // 462001 (100,100)-(300,100) 选中; 462002 (100,260)-(300,260) 未选中
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = (id, y) => ({ id, type: 'slider', x: 100, y, time: t, newCombo: false, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 300, y }], slides: 1, length: 200 });
      store.load({ ...base, hitObjects: [mk(462001, 100), mk(462002, 260)] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.clearSelection(); store.setSelectedNodes([]);
      store.select([462001]); // 用户场景: 先选中一条滑条
    })()`);
    await sleep(1500); // 等 load 触发的防抖星数重算 (setStarRating emit) 落定, 不混入框选计量
    await evalJs(`(() => {
      const store = window.__osuStore;
      const orig = store.emitSelection.bind(store);
      window.__emitN = 0;
      store.emitSelection = () => { window.__emitN++; orig(); };
      window.__ver0 = store.getVersion();
    })()`);

    // 框选动作: Alt+从 p0 分 steps 步拖到 p1, 返回移动期间 emit 次数
    const drag = `(async (x0, y0, x1, y1, steps) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const p0 = window.__osuToClient(x0, y0), p1 = window.__osuToClient(x1, y1);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      await sleep(50);
      window.__emitN = 0; // 只计移动期间
      for (let i = 1; i <= steps; i++) {
        const px = p0.x + (p1.x - p0.x) * i / steps, py = p0.y + (p1.y - p0.y) * i / steps;
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: px, clientY: py, altKey: true, bubbles: true }));
        await sleep(30);
      }
      const emits = window.__emitN;
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(50);
      const store = window.__osuStore;
      const ids = {};
      for (const [objId, s] of store.selectedNodes) ids[objId] = [...s].sort();
      return { emits, ids, verDelta: store.getVersion() - window.__ver0 };
    })`;

    // A: 空白区域 12 步拖动 (框不到锚点, 节点选区始终为空) — 修复前每次 move 都 emit
    const rA = await evalJs(`(${drag})(420, 330, 500, 380, 12)`);
    assert(rA.emits === 0, `A: 空白框选 12 步移动零 emit (实际 ${rA.emits}; 修复前 ≈12)`);

    // B: 从空白拖进 462001 头部 (100,100) — 只在锚点进框那一瞬间 emit
    const rB = await evalJs(`(${drag})(40, 40, 160, 160, 12)`);
    assert(rB.emits >= 1 && rB.emits <= 3, `B: 锚点进框仅在变化时 emit (实际 ${rB.emits}; 修复前 ≈12)`);
    assert(rB.ids['462001']?.includes(0), `B: 头部锚点被框进 (实际 ${JSON.stringify(rB.ids)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures) { console.error(`\nVERIFIER_V462_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V462_ALL_TESTS_PASSED');

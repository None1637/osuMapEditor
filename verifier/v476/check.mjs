// 验证器 v476: 两件事
//   1) 「地图已保存」横条字体放大且恒定 (用户: 高分辨率下相对 UI 太小; 要求分辨率变化字号不变) —
//      SavedFlash 挂在 v217 zoom 容器外本就恒定, text-xl(20px) → 固定 fontSize: 28, 条高 h-14 → h-16。
//   2) 对称滑条窗口开着 Ctrl+Z 后选不到滑条点 (soulten: 對稱滑條 ctrl+z 之後選不到滑條點) —
//      根因: restore() 就地深拷贝替换 hitObjects, bm 引用不变, 转换窗口 useMemo 依赖
//      [bm, selected, conversionDialog] 感知不到 → obj stale, 幽灵预览停在撤销前位置且 hideIds
//      藏掉真身 (锚点不可见/点击错位)。修复: store.historySeq 撤销/重做自增, 四个转换窗口
//      (SymSlider/Duplicate/Split/Stream) memo 依赖补 store.historySeq。
// 运行: npm run build 后 node verifier/v476/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: historySeq 撤销/重做代数 (v476)');
{
  const st = read('src/osu/store.ts');
  assert(/historySeq = 0;/.test(st), 'store 新增 historySeq 字段');
  const undoAt = st.indexOf('undo() {');
  const redoAt = st.indexOf('redo() {');
  assert(/undo\(\) \{[\s\S]{0,700}this\.historySeq\+\+/.test(st.slice(undoAt, undoAt + 900)), 'undo() 内 historySeq++');
  assert(/redo\(\) \{[\s\S]{0,700}this\.historySeq\+\+/.test(st.slice(redoAt, redoAt + 900)), 'redo() 内 historySeq++');
  for (const f of ['SymSliderDialog', 'DuplicateDialog', 'SplitDialog', 'StreamDialog']) {
    const src = read(`src/components/convert/${f}.tsx`);
    assert(/store\.conversionDialog, store\.historySeq/.test(src), `${f} memo 依赖含 store.historySeq`);
  }
}

section('源码: 「地图已保存」横条 28px 恒定字号 (v476)');
{
  const sf = read('src/components/SavedFlash.tsx');
  assert(/fontSize: 28/.test(sf), '字号固定 28px');
  assert(/h-16 bg-black\/70/.test(sf), '条高 h-16 (JSX)');
  assert(!/text-white text-xl/.test(sf), '旧 text-xl 已从 JSX 移除');
}

section('CDP: 对称滑条开窗拖锚点 → undo → 幽灵预览跟随恢复后几何; redo 对称一致');
{
  const PORT = 9482;
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

    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const slider = { ...(base.hitObjects.find(o => o.type === 'slider')), id: 476001, time: 5000,
        x: 200, y: 192, curveType: 'L', curvePoints: [{ x: 300, y: 192 }, { x: 300, y: 292 }], slides: 1, length: 300 };
      store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      store.seek(4500); store.select([476001]);
      await sleep(200);
      store.openConversion('symSlider');
      await sleep(400);
      const cv = document.querySelector('canvas');
      const toC = (ox, oy) => window.__osuToClient(ox, oy);
      const ev = (type, ox, oy, opt = {}) => {
        const p = toC(ox, oy);
        cv.dispatchEvent(new MouseEvent(type, { clientX: p.x, clientY: p.y, button: 0, bubbles: true, cancelable: true, ...opt }));
      };
      const ghost = () => {
        const p = store.conversionPreview;
        if (!p || !p.objects.length) return null;
        const o = p.objects[0];
        return [o.x, o.y, ...(o.curvePoints || []).flatMap(q => [q.x, q.y])].slice(0, 6);
      };
      const live = () => { const o = store.beatmap.hitObjects.find(x => x.id === 476001);
        return o ? [o.x, o.y, ...(o.curvePoints || []).flatMap(p => [p.x, p.y])] : null; };
      // 拖锚点 (300,292) → (340,332)
      ev('mousedown', 300, 292); await sleep(80);
      ev('mousemove', 340, 332); await sleep(150);
      ev('mouseup', 340, 332);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: toC(340, 332).x, clientY: toC(340, 332).y, bubbles: true }));
      await sleep(200);
      const afterDrag = { ghost: ghost(), live: live(), seq: store.historySeq };
      store.undo(); await sleep(400);
      const afterUndo = { ghost: ghost(), live: live(), seq: store.historySeq };
      // undo 后还能正常选锚点 (Alt+点未选中的节点1 (300,192) 加入选区; 节点2 拖拽时已选中, Alt 会 toggle 故避开)
      ev('mousedown', 300, 192, { altKey: true }); await sleep(60);
      ev('mouseup', 300, 192, { altKey: true }); await sleep(150);
      const nodesAfterUndo = [...(store.selectedNodes.get(476001) ?? [])];
      store.redo(); await sleep(400);
      const afterRedo = { ghost: ghost(), live: live(), seq: store.historySeq };
      store.closeConversion();
      return { afterDrag, afterUndo, afterRedo, nodesAfterUndo };
    })()`);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    assert(r1.afterDrag.live && r1.afterDrag.live[5] === 332, `拖拽生效 (尾节点 y=332, 实际 ${JSON.stringify(r1.afterDrag.live)})`);
    assert(r1.afterDrag.ghost && r1.afterDrag.ghost[5] === 332, `拖拽中幽灵跟随 (实际 ${JSON.stringify(r1.afterDrag.ghost)})`);
    assert(r1.afterUndo.live && r1.afterUndo.live[5] === 292, `undo 恢复真身 (尾节点 y=292, 实际 ${JSON.stringify(r1.afterUndo.live)})`);
    assert(eq(r1.afterUndo.ghost, r1.afterUndo.live.slice(0, 6)),
      `undo 后幽灵预览跟随恢复后几何 (v476 修复点; ghost=${JSON.stringify(r1.afterUndo.ghost)} live=${JSON.stringify(r1.afterUndo.live)})`);
    assert(r1.afterUndo.seq === r1.afterDrag.seq + 1, `undo 后 historySeq 自增 (${r1.afterDrag.seq} → ${r1.afterUndo.seq})`);
    assert(r1.nodesAfterUndo.includes(1), `undo 后仍可 Alt 选锚点 (选中节点 ${JSON.stringify(r1.nodesAfterUndo)})`);
    assert(eq(r1.afterRedo.ghost, r1.afterRedo.live.slice(0, 6)),
      `redo 后幽灵同样一致 (ghost=${JSON.stringify(r1.afterRedo.ghost)} live=${JSON.stringify(r1.afterRedo.live)})`);

    // SavedFlash 28px 恒定字号
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.saveFlashSeq++; store.emit();
      await sleep(200);
      const el = document.querySelector('[data-saved-flash]');
      if (!el) return { found: false };
      return { found: true, fontSize: getComputedStyle(el).fontSize, zoom: getComputedStyle(el).zoom };
    })()`);
    assert(r2.found, 'SavedFlash 横条出现');
    assert(r2.fontSize === '28px', `字号 = 28px 恒定 (实际 ${r2.fontSize}, zoom=${r2.zoom})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V476_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V476_ALL_TESTS_PASSED');

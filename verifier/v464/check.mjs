// 验证器 v464: 贝塞尔 ('B') 滑条转 B4 (B 样条) — v387/v388 的反向
// 算法: 贝塞尔路径密集采样 → IncrementalBSplineBuilder (lazer 移植, 手绘落盘同款) 拟合分段 B 样条,
//   段接缝红锚点重复 (.osu 惯例), 容差 1.0px / 拐角阈值 0.4 / degree 4。
// 入口: 作图菜单「全部贝塞尔滑条转B4」(compose-convert-bezier-b4) + Inspector「贝塞尔→B4」(选中集);
//   store.convertAllBezierSlidersToB4 / convertSelectedBezierSlidersToB4 (一次 undo + 2.6s toast)。
// 运行: npm run build 后 node verifier/v464/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v464/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v464/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 纯函数测试 (保真度/拐角/直线/退化/onlyIds)
await import('file://' + out);
fs.unlinkSync(out);

section('源码: 转换器与入口接线');
{
  const cv = read('src/osu/convert/convertB4.ts');
  assert(/export function bezierAnchorsToBSpline/.test(cv), 'bezierAnchorsToBSpline 导出');
  assert(/SliderPath\.computeRawPath\('B', pts\)/.test(cv), '贝塞尔路径密集采样');
  assert(/new IncrementalBSplineBuilder\(degree, CONVERT_TOLERANCE, CONVERT_CORNER\)/.test(cv), 'lazer builder 拟合');
  assert(/builder\.finish\(\)/.test(cv), 'finish 末段完整优化');
  assert(/export function convertBezierSlidersToBSpline/.test(cv) && /o\.curveType !== 'B'\) continue/.test(cv), 'convert* 只动 B');
  const st = read('src/osu/store.ts');
  assert(/convertAllBezierSlidersToB4\(\)/.test(st) && /convertSelectedBezierSlidersToB4\(\)/.test(st), 'store 两个入口');
  assert(/convert\.bez_b4_none/.test(st) && /convert\.bez_b4_converted/.test(st), 'toast 键');
  const insp = read('src/components/Inspector.tsx');
  assert(/data-conv-apply="btoB4"/.test(insp) && /convertSelectedBezierSlidersToB4/.test(insp), 'Inspector 按钮');
  const mc = read('electron/main.cjs');
  assert(/"menu\.convert_bezier_b4": \{ en: .+, "zh-CN": .+, "zh-TW": .+ \}/.test(mc), '菜单文案三语');
  assert(/e2\("compose-convert-bezier-b4", mT\("menu\.convert_bezier_b4"\), null, editState\.hasMap\)/.test(mc), '作图菜单项');
  const br = read('src/osu/electronBridge.ts');
  assert(/\{ type: 'compose-convert-bezier-b4' \}/.test(br), 'bridge 命令类型');
  const em = read('src/osu/electronMenu.ts');
  assert(/case 'compose-convert-bezier-b4': store\.convertAllBezierSlidersToB4\(\); return;/.test(em), 'menu-cmd handler');
  const dict = read('src/i18n/dicts/zh-CN/convert.ts');
  assert(/'convert\.bez_b4_none':/.test(dict) && /'convert\.bez_b4_converted':/.test(dict), 'zh-CN toast 文案');
  assert(/'inspector\.bezier_to_bspline':/.test(read('src/i18n/dicts/zh-CN/inspector.ts')), 'zh-CN Inspector 文案');
}

section('CDP: Inspector 按钮转换 + 撤销还原 + 全图转换 + 空态提示');
{
  const PORT = 9495;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);
    await evalJs(`window.__osuSetLang && window.__osuSetLang('zh-CN')`);
    await sleep(800);

    const r = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const mk = (id, curveType, curvePoints) => ({ id, type: 'slider', x: 100, y: 200, time: 5000 + id * 500,
        newCombo: false, comboSkip: 0, hitSound: 0, curveType, curvePoints, slides: 1, length: 200 });
      const bez1 = mk(964101, 'B', [{ x: 180, y: 120 }, { x: 260, y: 200 }, { x: 340, y: 280 }]);
      const bez2 = mk(964102, 'B', [{ x: 200, y: 300 }, { x: 300, y: 300 }]);
      const ln = mk(964103, 'L', [{ x: 400, y: 100 }]);
      store.load({ ...base, hitObjects: [bez1, bez2, ln] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      await sleep(300);

      // A: 选中 bez1 → Inspector 出现「贝塞尔→B4 (1 条)」→ 点击 → B4, id/length 不变, toast 出现
      store.select([964101]);
      await sleep(400);
      const btn = document.querySelector('[data-conv-apply="btoB4"]');
      const btnText = btn ? btn.textContent : null;
      const undo0 = store.canUndo;
      btn && btn.click();
      await sleep(300);
      const o1 = store.beatmap.hitObjects.find(x => x.id === 964101);
      const o2 = store.beatmap.hitObjects.find(x => x.id === 964102);
      const afterClick = {
        type1: o1.curveType, len1: o1.length, id1: o1.id, anchors1: (o1.curvePoints || []).length,
        type2: o2.curveType, // 未选中不动
        toast: store.saveMessage,
      };
      // B: 撤销还原 'B'
      store.undo(); await sleep(200);
      const undone = store.beatmap.hitObjects.find(x => x.id === 964101).curveType;
      // C: 全图转换 (菜单 handler 同一 store 方法)
      store.clearSelection();
      store.convertAllBezierSlidersToB4(); await sleep(200);
      const all = store.beatmap.hitObjects.map(o => o.id + ':' + o.curveType).join(',');
      // D: 再次全图转换 — 无 'B' → 空态提示, 不多 undo
      store.convertAllBezierSlidersToB4(); await sleep(200);
      const noneToast = store.saveMessage;
      return { btnText, afterClick, undone, all, noneToast, undo0 };
    })()`);
    assert(r.btnText && /贝塞尔→B4 \(1 条\)/.test(r.btnText), `Inspector 按钮文案 (${r.btnText})`);
    assert(r.afterClick.type1 === 'B4' && r.afterClick.id1 === 964101 && r.afterClick.len1 === 200,
      `点击后转 B4 且 id/length 不变 (${JSON.stringify(r.afterClick)})`);
    assert(r.afterClick.anchors1 >= 3, `B4 控制点数量合理 (${r.afterClick.anchors1})`);
    assert(r.afterClick.type2 === 'B', '未选中的贝塞尔不动');
    assert(r.afterClick.toast && /转为 B4/.test(r.afterClick.toast), `toast 报告 (${r.afterClick.toast})`);
    assert(r.undone === 'B', `撤销还原 'B' (${r.undone})`);
    assert(r.all === '964101:B4,964102:B4,964103:L', `全图转换只动 'B' (${r.all})`);
    assert(r.noneToast && /没有贝塞尔/.test(r.noneToast), `空态提示 (${r.noneToast})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V464_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V464_ALL_TESTS_PASSED');

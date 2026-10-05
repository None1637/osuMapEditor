// 验证器 v351: 左栏配色统一 + 时间轴药丸字号缩放补偿
//   图一 (soulten): 曲库平时无颜色 (跟皮肤一样); 选择工具用曲库原颜色样式 (bg-pink-500/30+border);
//     锁定间距也橘色 (同锁定物件); pattern 绿色 (同波形)。
//   图二: 上方时间轴样本药丸 ($xx) / SV·BPM 药丸 (0.00x) 文字缩放后超小 —
//     按 CSS 同规则 (index.css v225/v339) 布局字号 = max(base×textZoomComp, 12/uiZoom), 视觉 ≥12px;
//     药丸高度随之下限撑高, 绘制与命中测试同字号同高度。
// 运行: npm run build 后 node verifier/v351/check.mjs  (B 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import { spawn, execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

section('A: 源码形态');
{
  const app = read('src/App.tsx');
  const libBtn = app.match(/setShowLibrary\(true\)\}[^\n]*\n/)?.[0] ?? '';
  assert(libBtn.includes('bg-white/10 hover:bg-white/20') && !libBtn.includes('bg-pink'), '曲库按钮平时无颜色 (跟皮肤一样)');
  assert(/store\.tool === tool\.id \? 'bg-pink-500\/30 border border-pink-400\/40 font-bold'/.test(app), '选择工具激活态 = 曲库原颜色样式 (pink-500/30+border)');
  assert(/store\.distanceLock \? 'bg-amber-500\/40 border border-amber-400\/50'/.test(app), '锁定间距高亮橘色 (同锁定物件)');
  assert(/store\.patternPanelOpen \? 'bg-emerald-500\/40 border border-emerald-400\/50'/.test(app), 'pattern 高亮绿色 (同波形)');
  assert(/accent-amber-400/.test(app) && !/accent-cyan-400/.test(app), '锁定间距滑条 accent 同步橘色');
  const tl = read('src/components/Timelines.tsx');
  assert(/const pillFont = \(base: number\) => `bold \$\{Math\.max\(base \* textZoomComp\(\), 12 \/ uiZoom\(\)\)\}px sans-serif`/.test(tl), 'pillFont: max(base×textZoomComp, 12/uiZoom) (视觉 ≥12px)');
  assert((tl.match(/g\.font = pillFont\(10\)/g) ?? []).length === 1, '样本药丸用 pillFont(10)');
  assert((tl.match(/g\.font = pillFont\(9\.5\)/g) ?? []).length === 2, 'timing 药丸绘制与命中测试同用 pillFont(9.5)');
  assert(!/bold 10px sans-serif|bold 9\.5px sans-serif/.test(tl), '旧固定字号移除');
  assert((tl.match(/Math\.max\(13, 12 \/ uiZoom\(\) \+ 2\)/g) ?? []).length === 2, 'timing 药丸高度下限撑高 (绘制+命中同式)');
  assert(/spPh = Math\.max\(14, 12 \/ uiZoom\(\) \+ 2\)/.test(tl), '样本药丸高度下限撑高');
  assert(/py = Math\.min\(py, r\.height - ph - 1\)/.test(tl), '撑高后上抬防裁出画布 (绘制)');
}

section('B: CDP DOM 配色类名');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9458;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    const clsOf = (re) => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => ${re}.test(x.textContent)); return b ? b.className : null; })()`);
    const libCls = await clsOf('/Song Library|曲库|曲庫/');
    assert(libCls && libCls.includes('bg-white/10') && !libCls.includes('pink'), `曲库无粉色 (实得 ${String(libCls).slice(0, 80)})`);
    // 工具激活态: 当前默认 select → 类名含 pink-500/30
    const toolCls = await evalJs(`(() => { const store = window.__osuStore; const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => /Select|选择|選擇/.test(x.textContent) && x.className.includes('rounded')); return b ? b.className : null; })()`);
    assert(toolCls && toolCls.includes('bg-pink-500/30') && toolCls.includes('border-pink-400/40'), `选择工具激活态 pink-500/30 (实得 ${String(toolCls).slice(0, 100)})`);
    // 锁定间距: 开启后橘色
    await evalJs(`(() => { const s = window.__osuStore; s.distanceLock = true; s.emit(); })()`);
    await sleep(300);
    const dsCls = await clsOf('/Distance Snap|锁定间距|鎖定間距/');
    assert(dsCls && dsCls.includes('bg-amber-500/40'), `锁定间距开启橘色 (实得 ${String(dsCls).slice(0, 80)})`);
    await evalJs(`(() => { const s = window.__osuStore; s.distanceLock = false; s.emit(); })()`);
    // pattern: 开面板后绿色
    await evalJs(`(() => { const s = window.__osuStore; s.loadPatternsIfNeeded(); s.setPatternPanelOpen(true); })()`);
    await sleep(300);
    const patCls = await evalJs(`(() => { const b = document.querySelector('[data-pattern-input="panel-toggle"]'); return b ? b.className : null; })()`);
    assert(patCls && patCls.includes('bg-emerald-500/40'), `pattern 开面板绿色 (实得 ${String(patCls).slice(0, 80)})`);
    await evalJs(`window.__osuStore.setPatternPanelOpen(false)`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('C: 编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V351_FAILED: ${failures} 处失败` : '\nVERIFIER_V351_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
